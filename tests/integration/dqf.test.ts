import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'
import {
  dqfChecklist,
  dqfFactsForDrivers,
  dqfIncompleteCount,
  DQF_COMPLIANCE_TYPES,
  DQF_DOCUMENT_TYPES,
} from '@/lib/dqf'
import { driverWarningFacts, driverWarnings } from '@/lib/warnings'
import type {
  ComplianceType,
  DocumentType,
  PrismaClient,
} from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE DQF AGAINST REAL ROWS.
//
// `tests/dqf.test.ts` grades the rules against hand-built facts. This grades
// the LOADER: that it finds compliance records and documents in the two tables
// they actually live in, that a soft-deleted one does not count as filed, and
// that twenty drivers cost the same number of statements as one.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let companyId = ''
let userId = ''
let completeId = ''
let emptyId = ''
let terminatedId = ''

const nonce = Math.random().toString(36).slice(2, 8)
const NOW = new Date()
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000)

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'dqf.test' },
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
  })

/** Everything on file and current, written straight through the owner client. */
async function fileEverything(driverId: string) {
  for (const type of DQF_COMPLIANCE_TYPES) {
    await owner.complianceItem.create({
      data: {
        organizationId,
        companyId,
        driverId,
        type: type as ComplianceType,
        expiresAt: days(300),
      },
    })
  }
  let n = 0
  for (const type of DQF_DOCUMENT_TYPES) {
    n += 1
    await owner.document.create({
      data: {
        organizationId,
        companyId,
        driverId,
        type: type as DocumentType,
        r2Key: `${organizationId}/driver/${driverId}/${nonce}-${n}`,
        filename: `${type}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      },
    })
  }
}

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)

  organizationId = (
    await owner.organization.create({
      data: { name: `Dqf ${nonce}`, slug: `dqf-${nonce}` },
    })
  ).id
  companyId = (
    await owner.company.create({
      data: {
        organizationId,
        name: `RAM ${nonce}`,
        addressLine1: '5062 Free Pike',
        city: 'Dayton',
        state: 'OH',
        postalCode: '45426',
      },
    })
  ).id
  userId = (
    await owner.user.create({
      data: { email: `dqf-${nonce}@example.test`, name: 'Dqf' },
    })
  ).id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })

  completeId = (
    await owner.driver.create({
      data: {
        organizationId,
        companyId,
        firstName: 'FULL',
        lastName: 'FILE',
        hireDate: days(-500),
      },
    })
  ).id
  await fileEverything(completeId)

  emptyId = (
    await owner.driver.create({
      data: {
        organizationId,
        companyId,
        firstName: 'NEW',
        lastName: 'HIRE',
        hireDate: days(-10),
      },
    })
  ).id

  terminatedId = (
    await owner.driver.create({
      data: {
        organizationId,
        companyId,
        firstName: 'GONE',
        lastName: 'ALREADY',
        status: 'INACTIVE',
        hireDate: days(-900),
      },
    })
  ).id
})

afterAll(async () => {
  await owner?.$disconnect().catch(() => undefined)
})

describe('the loader finds both kinds of evidence', () => {
  it('reads a complete file as complete', async () => {
    const facts = await inOrg((tx) => dqfFactsForDrivers(tx, [completeId]))
    const entries = dqfChecklist(facts.get(completeId)!, NOW)
    expect(dqfIncompleteCount(entries)).toBe(0)
  })

  it('reads an empty file as eight missing of nine, dated from the hire date', async () => {
    // NINE ROWS since queue item 20 (4): the hire date is the first, and this
    // driver has one — so it reads PRESENT and the other eight are missing,
    // each dated from it. A production-shaped row: a new hire with a date
    // typed and nothing filed yet.
    const facts = await inOrg((tx) => dqfFactsForDrivers(tx, [emptyId]))
    const entries = dqfChecklist(facts.get(emptyId)!, NOW)
    expect(entries[0]!.key).toBe('hire_date')
    expect(entries[0]!.status).toBe('present')
    expect(dqfIncompleteCount(entries)).toBe(8)
    expect(entries[1]!.status).toBe('missing')
    expect(entries[1]!.dueSince?.toISOString().slice(0, 10)).toBe(
      days(-10).toISOString().slice(0, 10),
    )
  })

  it('does not count a REMOVED document as filed', async () => {
    // A document somebody deleted is not evidence. Reading `deletedAt IS NULL`
    // in one of the two queries and not the other is exactly the sort of
    // half-applied predicate that makes a file look complete.
    const document = await owner.document.findFirstOrThrow({
      where: { driverId: completeId, type: 'EMPLOYMENT_APPLICATION' },
      select: { id: true },
    })
    await owner.document.update({
      where: { id: document.id },
      data: { deletedAt: new Date() },
    })

    const facts = await inOrg((tx) => dqfFactsForDrivers(tx, [completeId]))
    const entries = dqfChecklist(facts.get(completeId)!, NOW)
    expect(dqfIncompleteCount(entries)).toBe(1)
    expect(entries.find((e) => e.key === 'application')!.status).toBe('missing')

    await owner.document.update({
      where: { id: document.id },
      data: { deletedAt: null },
    })
  })

  it('does not count a REMOVED compliance record either', async () => {
    const item = await owner.complianceItem.findFirstOrThrow({
      where: { driverId: completeId, type: 'MVR' },
      select: { id: true },
    })
    await owner.complianceItem.update({
      where: { id: item.id },
      data: { deletedAt: new Date() },
    })

    const facts = await inOrg((tx) => dqfFactsForDrivers(tx, [completeId]))
    const entries = dqfChecklist(facts.get(completeId)!, NOW)
    expect(entries.find((e) => e.key === 'mvr')!.status).toBe('missing')

    await owner.complianceItem.update({
      where: { id: item.id },
      data: { deletedAt: null },
    })
  })
})

describe('the warning, from the loader the list uses', () => {
  it('fires for the new hire and is silent for the complete file', async () => {
    const facts = await inOrg((tx) =>
      driverWarningFacts(tx, [completeId, emptyId]),
    )
    const namesFor = (id: string) =>
      driverWarnings(facts.get(id)!, NOW).map((w) => w.name)

    expect(namesFor(emptyId)).toContain('dqf_incomplete')
    expect(namesFor(completeId)).not.toContain('dqf_incomplete')
  })

  it('is SILENT for a terminated driver with nothing on file', async () => {
    // THE GUARD NAMED "closed history drivers counted", against a real row
    // rather than a hand-set boolean: `driverWarningFacts` has to read the
    // roster to know, and reading it wrongly is the failure.
    const facts = await inOrg((tx) => driverWarningFacts(tx, [terminatedId]))
    const entry = facts.get(terminatedId)!
    expect(entry.qualifiable).toBe(false)
    expect(driverWarnings(entry, NOW).map((w) => w.name)).not.toContain(
      'dqf_incomplete',
    )
  })
})

describe('what a roster costs', () => {
  it('asks the same number of questions for twenty drivers as for one', async () => {
    const { PrismaClient } = await import('@/generated/prisma/client')
    const { PrismaNeon } = await import('@prisma/adapter-neon')

    const countFor = async (ids: string[]) => {
      const client = new PrismaClient({
        adapter: new PrismaNeon({
          connectionString: process.env.DIRECT_DATABASE_URL!,
        }),
        log: [{ emit: 'event', level: 'query' }],
      })
      let count = 0
      client.$on('query', () => {
        count += 1
      })
      await client.$queryRaw`select 1`
      const before = count
      await dqfFactsForDrivers(client as never, ids)
      const used = count - before
      await client.$disconnect()
      return used
    }

    const one = await countFor([completeId])
    const twenty = await countFor(Array.from({ length: 20 }, () => completeId))
    expect(twenty).toBe(one)
  })
})
