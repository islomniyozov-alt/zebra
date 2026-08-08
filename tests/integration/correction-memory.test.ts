import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import {
  learnAlias,
  noteAliasApplied,
  normalizeAlias,
  recordCorrections,
  resolveBroker,
} from '@/lib/correction-memory'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// §5: "A corrected broker match is applied on the next upload of the same
// string; the correction row records both."
//
// Both halves, against real Postgres. The interesting one is the SECOND upload:
// a memory that is written and never read is a table, not a memory.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let userId = ''
let midwestId = ''
let itsLogisticsId = ''
let itsNationalId = ''
const nonce = Math.random().toString(36).slice(2, 8)

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'correction.test' },
    maxWaitMs: 20_000,
  })

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)

  const organization = await owner.organization.create({
    data: {
      name: `Correction ${nonce}`,
      slug: `correction-${nonce}`,
      maxCompanies: 5,
      companies: { create: [{ name: `Alpha ${nonce}` }] },
    },
  })
  organizationId = organization.id

  const user = await owner.user.create({
    data: {
      email: `correction-${nonce}@example.test`,
      name: 'Correction Tester',
    },
  })
  userId = user.id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })

  midwestId = (
    await owner.customer.create({
      data: { organizationId, name: `Midwest Logistics ${nonce}` },
    })
  ).id
  // THE TWO THAT MUST NOT MERGE. Both are real brokers in this carrier's
  // corpus and they differ by one word.
  itsLogisticsId = (
    await owner.customer.create({
      data: { organizationId, name: `ITS Logistics LLC ${nonce}` },
    })
  ).id
  itsNationalId = (
    await owner.customer.create({
      data: { organizationId, name: `ITS National LLC ${nonce}` },
    })
  ).id
}, 300_000)

afterAll(async () => {
  await owner.organization
    .delete({ where: { id: organizationId } })
    .catch(() => {})
  await owner.user.delete({ where: { id: userId } }).catch(() => {})
  await owner.$disconnect()
})

describe('before anything has been corrected', () => {
  it('resolves a name the customer book already has, without being taught', async () => {
    const found = await inOrg((tx) =>
      resolveBroker(tx, `midwest logistics ${nonce}`),
    )
    expect(found).toMatchObject({ customerId: midwestId, via: 'exact' })
  }, 300_000)

  it('and answers null for a name it has never seen', async () => {
    // Null rather than a best guess: a near-match offered as an answer is how a
    // load gets invoiced to the wrong company.
    expect(
      await inOrg((tx) => resolveBroker(tx, `Mispelled Ltd ${nonce}`)),
    ).toBeNull()
  }, 300_000)
})

describe('§5: a corrected broker match is applied on the next upload', () => {
  const printed = `MIDWST LOGISTIC${nonce}`

  it('learns what the dispatcher typed over', async () => {
    expect(
      await inOrg((tx) =>
        learnAlias(tx, {
          organizationId,
          extractedName: printed,
          customerId: midwestId,
          customerName: `Midwest Logistics ${nonce}`,
          userId,
        }),
      ),
    ).toBe('learned')
  }, 300_000)

  it('and applies it to the NEXT upload of the same string', async () => {
    // The half that makes it a memory rather than a table.
    const found = await inOrg((tx) => resolveBroker(tx, printed))
    expect(found).toMatchObject({ customerId: midwestId, via: 'alias' })
  }, 300_000)

  it('including the same string spelled differently', async () => {
    // Case and spacing, which is what two documents differ by.
    const found = await inOrg((tx) =>
      resolveBroker(tx, `  ${printed.toLowerCase()}  `),
    )
    expect(found?.customerId).toBe(midwestId)
  }, 300_000)

  it('counts that it was used', async () => {
    await inOrg((tx) => noteAliasApplied(tx, normalizeAlias(printed)))
    const row = await owner.customerAlias.findFirstOrThrow({
      where: { organizationId, normalized: normalizeAlias(printed) },
      select: { timesApplied: true, alias: true },
    })
    expect(row.timesApplied).toBe(1)
    // The printed form is kept, for a human reading the row.
    expect(row.alias).toBe(printed)
  }, 300_000)

  it('and a second correction REPLACES the answer rather than adding one', async () => {
    // The unique index would refuse a second row; refusing here would fail a
    // save the dispatcher has already made.
    expect(
      await inOrg((tx) =>
        learnAlias(tx, {
          organizationId,
          extractedName: printed,
          customerId: itsLogisticsId,
          customerName: `ITS Logistics LLC ${nonce}`,
          userId,
        }),
      ),
    ).toBe('learned')

    const found = await inOrg((tx) => resolveBroker(tx, printed))
    expect(found?.customerId).toBe(itsLogisticsId)

    expect(
      await owner.customerAlias.count({
        where: { organizationId, normalized: normalizeAlias(printed) },
      }),
    ).toBe(1)
    // The count restarts, because it counts uses of THIS answer.
    const row = await owner.customerAlias.findFirstOrThrow({
      where: { organizationId, normalized: normalizeAlias(printed) },
      select: { timesApplied: true },
    })
    expect(row.timesApplied).toBe(0)
  }, 300_000)

  it('learns nothing when the name already matched', async () => {
    // An alias saying "Midwest Logistics" means the customer called Midwest
    // Logistics teaches nothing and would grow a row per load forever.
    expect(
      await inOrg((tx) =>
        learnAlias(tx, {
          organizationId,
          extractedName: `Midwest Logistics ${nonce}`,
          customerId: midwestId,
          customerName: `Midwest Logistics ${nonce}`,
          userId,
        }),
      ),
    ).toBe('redundant')
  }, 300_000)
})

describe('the two brokers that must never merge', () => {
  it('keeps ITS Logistics and ITS National apart', async () => {
    // Both are in the corpus; they differ by one word. A normalisation clever
    // enough to strip "LLC" and match on the leading token would fold them,
    // and the screen would show a name that looks right.
    const logistics = await inOrg((tx) =>
      resolveBroker(tx, `ITS Logistics LLC ${nonce}`),
    )
    const national = await inOrg((tx) =>
      resolveBroker(tx, `ITS National LLC ${nonce}`),
    )
    expect(logistics?.customerId).toBe(itsLogisticsId)
    expect(national?.customerId).toBe(itsNationalId)
    expect(logistics?.customerId).not.toBe(national?.customerId)
  }, 300_000)
})

describe('the correction log', () => {
  it('records both sides, and only the fields that changed', async () => {
    const written = await inOrg((tx) =>
      recordCorrections(tx, {
        organizationId,
        userId,
        changes: [
          {
            field: 'brokerName',
            extracted: 'Mispelled Logistics',
            corrected: `Midwest Logistics ${nonce}`,
            confidence: 'medium',
          },
          {
            field: 'stops[0].city',
            extracted: 'Chicago',
            corrected: 'Chicago',
            confidence: 'high',
          },
          {
            field: 'poNumber',
            extracted: null,
            corrected: 'PO-4471',
            confidence: null,
          },
        ],
      }),
    )
    // Two of three: the agreement is not a correction.
    expect(written).toBe(2)

    const rows = await owner.extractionCorrection.findMany({
      where: { organizationId },
      orderBy: { field: 'asc' },
      select: {
        field: true,
        extractedValue: true,
        correctedValue: true,
        confidence: true,
        correctedByUserId: true,
      },
    })

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      field: 'brokerName',
      extractedValue: 'Mispelled Logistics',
      confidence: 'medium',
      correctedByUserId: userId,
    })
    // The model MISSING something is a correction too.
    expect(rows[1]).toMatchObject({
      field: 'poNumber',
      extractedValue: null,
      correctedValue: 'PO-4471',
    })
  }, 300_000)

  it('and changes nothing — it is read by the accuracy run and by nobody else', async () => {
    // §3 step 3: "the raw material for §5's accuracy numbers and nothing
    // more." The alias table is what changes behaviour; this asserts the log
    // did not quietly become a second one.
    const before = await inOrg((tx) => resolveBroker(tx, 'Mispelled Logistics'))
    expect(before).toBeNull()
  }, 300_000)
})
