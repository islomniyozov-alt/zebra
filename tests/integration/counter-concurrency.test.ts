import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { allocateNumber } from '@/lib/counters'
import { dropOrganization, seedOrganization, type OrgFixture } from './fixtures'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// Phase 3 §7: "100 concurrent invoice creations: distinct contiguous numbers
// per authority."
//
// The number series is the one thing in this system that cannot be repaired
// after the fact. A duplicate invoice number is two invoices a broker can
// legitimately refuse to pay twice, and a duplicate load number is two loads
// with one history.
//
// WHAT THIS MEASURES AND WHAT IT DOES NOT. It proves the allocation itself is
// atomic under real concurrency against real Postgres. It does not measure the
// LOCK WINDOW — how long a caller holds the counter row while it does other
// work — because that is a property of the caller, not of allocateNumber. See
// the note in counters.ts and flag 20.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let org: OrgFixture
const nonce = Math.random().toString(36).slice(2, 8)

// Each allocation is its own interactive transaction, and each holds a pooled
// connection for its life. Fifty at once queue behind the pool; the default 2s
// wait is not enough and the refusal would be about the pool, not the counter.
const WAIT = { maxWaitMs: 60_000, timeoutMs: 20_000 } as const

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
  org = await seedOrganization(owner, `counter`, nonce)
}, 180_000)

afterAll(async () => {
  await dropOrganization(owner, org)
  await owner.$disconnect()
})

describe('a number series under concurrency', () => {
  it('hands out distinct contiguous numbers', async () => {
    const CALLERS = 50

    const numbers = await Promise.all(
      Array.from({ length: CALLERS }, () =>
        withOrg(
          org.organizationId,
          (tx) => allocateNumber(tx, org.companyId, 'INVOICE_NUMBER'),
          {
            attribution: {
              userId: org.userId,
              ip: null,
              userAgent: 'counter-concurrency.test',
            },
            ...WAIT,
          },
        ),
      ),
    )

    // DISTINCT — the property that cannot be repaired afterwards.
    expect(new Set(numbers).size).toBe(CALLERS)

    // CONTIGUOUS — sorted, each exactly one more than the last. A gap would
    // mean a number was allocated and lost, which for an invoice series is a
    // question an auditor is entitled to ask.
    const sorted = [...numbers].sort((a, b) => a - b)
    for (let index = 1; index < sorted.length; index++) {
      expect(sorted[index]).toBe(sorted[index - 1]! + 1)
    }

    // And the counter agrees with what it handed out.
    const counter = await owner.counter.findFirst({
      where: { companyId: org.companyId, key: 'INVOICE_NUMBER' },
      select: { value: true },
    })
    expect(counter?.value).toBe(sorted[sorted.length - 1])
  }, 300_000)

  it('keeps each authority on its own series', async () => {
    // RAM's invoice 1043 and Dolphins' invoice 1043 are different invoices,
    // and a broker looking at one has no idea the other exists.
    const second = await owner.company.create({
      data: {
        organizationId: org.organizationId,
        name: `Second ${nonce}`,
        isActive: true,
      },
      select: { id: true },
    })

    const attribution = {
      userId: org.userId,
      ip: null,
      userAgent: 'counter-concurrency.test',
    }
    const [a, b] = await Promise.all([
      withOrg(
        org.organizationId,
        (tx) => allocateNumber(tx, org.companyId, 'SETTLEMENT_NUMBER'),
        { attribution, ...WAIT },
      ),
      withOrg(
        org.organizationId,
        (tx) => allocateNumber(tx, second.id, 'SETTLEMENT_NUMBER'),
        { attribution, ...WAIT },
      ),
    ])

    // Both series start in the same place, independently — which is the point.
    expect(a).toBe(b)

    await owner.counter.deleteMany({ where: { companyId: second.id } })
    await owner.company.delete({ where: { id: second.id } })
  }, 120_000)
})
