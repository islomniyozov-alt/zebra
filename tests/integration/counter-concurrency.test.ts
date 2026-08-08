import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg, type TxClient } from '@/lib/tenancy'
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
//
// THE TRANSACTION TIMEOUT IS A QUEUE-DEPTH BUDGET, NOT A LATENCY BUDGET, and
// saying so is the difference between a test and a flake. A hundred callers
// serialise on ONE row lock by design, so the last one's transaction stays open
// for the whole queue. Measured against Neon from a developer machine:
//
//   one transaction, cold   2,178 ms
//   twenty concurrent       5,553 ms  ->  278 ms per caller
//   a hundred, projected   27,765 ms
//
// The original 20,000 was under that projection and had been marginal since the
// day it was written; it finally tipped over and failed with P2028 — a timeout,
// reported as if the counter were broken. 60,000 is the measured queue depth
// with room. It is NOT a licence for the allocation to get slower: at double
// the per-caller latency this fails again, which is the regression signal worth
// keeping.
//
// None of this describes production, where a load allocates one number and
// waits on nobody.
const WAIT = { maxWaitMs: 60_000, timeoutMs: 60_000 } as const

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
    // §7 says 100. Fifty proved the property; a hundred is what the box asks
    // for, and the difference is worth having because contention is the thing
    // being tested.
    const CALLERS = 100

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

  it('holds the row lock for one statement on the warm path', async () => {
    // §7: "counter lock held <= 2 statements (measured)". The lock is taken by
    // the UPDATE ... RETURNING and released at commit, so what the ceiling
    // bounds is how many statements run inside that window.
    //
    // MEASURED, not read off the source. The transaction client is wrapped in
    // a Proxy that records every `$queryRaw` and `$executeRaw` before
    // delegating, so this counts what `allocateNumber` ACTUALLY issues rather
    // than what the function appears to.
    const issued: string[] = []

    const counted = (tx: TxClient): TxClient =>
      new Proxy(tx, {
        get(target, property, receiver) {
          const value = Reflect.get(target, property, receiver)
          if (
            typeof value === 'function' &&
            (property === '$queryRaw' || property === '$executeRaw')
          ) {
            return (...args: unknown[]) => {
              // The tagged-template first argument carries the SQL fragments.
              const strings = args[0]
              issued.push(
                Array.isArray(strings) ? strings.join('?') : String(strings),
              )
              return (value as (...a: unknown[]) => unknown).apply(target, args)
            }
          }
          return value
        },
      }) as TxClient

    const number = await withOrg(
      org.organizationId,
      // Warm path: the series exists by now, so the INSERT ... ON CONFLICT
      // fallback is not reached. That fallback is the two-statement case, and
      // two is exactly the ceiling the brief allows.
      (tx) => allocateNumber(counted(tx), org.companyId, 'INVOICE_NUMBER'),
      {
        attribution: {
          userId: org.userId,
          ip: null,
          userAgent: 'counter-concurrency.test',
        },
        ...WAIT,
      },
    )

    expect(typeof number).toBe('number')
    expect(issued, issued.join(' | ')).toHaveLength(1)
    expect(issued[0]).toContain('UPDATE "Counter"')
    expect(issued[0]).toContain('RETURNING value')
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
