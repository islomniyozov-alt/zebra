import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { txReader, withOrg } from '@/lib/tenancy'
import { LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'
import { recordRenewal } from '@/lib/compliance'
import { readDriverRecordHead } from '@/lib/driver-record-head'
import { mainCdlView } from '@/lib/driver-cdl'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// MAIN'S LICENCE FIELDS AND THE CDL RECORD AGREE (2026-11-18, driver-cdl.ts).
//
// Adzhmal Alimi on dev: a current CDL record and a licence image on Safety,
// Main's number, state and class blank. The agreement asked for is that what
// Main SHOWS from a record — the page's own read, `readDriverRecordHead` then
// `mainCdlView` — is exactly what recording WRITES to the driver row. Both
// halves are asked about the same driver here, through the paths the page and
// the compliance action use, and compared field by field.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let companyId = ''
let userId = ''
const nonce = Math.random().toString(36).slice(2, 8)
const NOW = new Date('2026-11-18T12:00:00Z')

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'driver-cdl.test' },
    maxWaitMs: 20_000,
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
  })

async function driver(
  name: string,
  main: { cdlNumber?: string; cdlState?: string; cdlClass?: string } = {},
) {
  return (
    await owner.driver.create({
      data: {
        organizationId,
        companyId,
        firstName: name,
        lastName: nonce,
        ...main,
      },
      select: { id: true },
    })
  ).id
}

const stored = (id: string) =>
  owner.driver.findUniqueOrThrow({
    where: { id },
    select: { cdlNumber: true, cdlState: true, cdlClass: true },
  })

/** What Main shows, read the way the page reads it. */
async function shown(id: string) {
  const head = (await inOrg((tx) =>
    readDriverRecordHead(txReader(tx), {
      driverId: id,
      organizationId,
      companyScopes: [],
      withSignIn: false,
      now: NOW,
    }),
  ))!
  return mainCdlView(
    {
      cdlNumber: head.driver.cdlNumber,
      cdlState: head.driver.cdlState,
      cdlClass: head.driver.cdlClass,
    },
    head.compliance,
  )
}

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
  const organization = await owner.organization.create({
    data: {
      name: `Driver CDL ${nonce}`,
      slug: `driver-cdl-${nonce}`,
      maxCompanies: 5,
      companies: { create: [{ name: `Alpha ${nonce}` }] },
    },
    include: { companies: true },
  })
  organizationId = organization.id
  companyId = organization.companies[0]!.id
  userId = (
    await owner.user.create({
      data: { email: `driver-cdl-${nonce}@example.test`, name: 'Safety' },
    })
  ).id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })
}, 300_000)

afterAll(async () => {
  await owner.organization
    .delete({ where: { id: organizationId } })
    .catch(() => {})
  await owner.user.delete({ where: { id: userId } }).catch(() => {})
  await owner.$disconnect()
})

describe('Main reads the CDL record, and recording fills Main', () => {
  it('a record on a blank Main is SHOWN before it is written, and the write agrees', async () => {
    const id = await driver('Blank')
    // A record written around recordRenewal — the seed's way — so Main is
    // still blank on the row and only the read can supply the values.
    await owner.complianceItem.create({
      data: {
        organizationId,
        companyId,
        type: 'CDL',
        driverId: id,
        identifier: 'A123-456-78',
        issuer: 'il',
        expiresAt: new Date('2028-07-11T00:00:00Z'),
      },
    })

    const before = await shown(id)
    expect(await stored(id)).toEqual({
      cdlNumber: null,
      cdlState: null,
      cdlClass: null,
    })
    expect(before.values).toEqual({
      cdlNumber: 'A123-456-78',
      cdlState: 'IL',
      cdlClass: null,
    })
    expect(before.fromRecord.sort()).toEqual(['cdlNumber', 'cdlState'])

    // A renewal of that licence, with a class from the reading.
    const outcome = await inOrg((tx) =>
      recordRenewal(tx, {
        subject: 'driver',
        subjectId: id,
        type: 'CDL',
        expiresAt: new Date('2032-07-11T00:00:00Z'),
        identifier: 'A123-456-78',
        issuer: 'IL',
        cdlClass: 'a',
      }),
    )
    expect(outcome).toMatchObject({ ok: true })

    // THE AGREEMENT: what Main showed from the record is what recording wrote.
    const after = await stored(id)
    expect(after.cdlNumber).toBe(before.values.cdlNumber)
    expect(after.cdlState).toBe(before.values.cdlState)
    expect(after.cdlClass).toBe('A')
    const now = await shown(id)
    expect(now.values).toEqual(after)
    expect(now.fromRecord).toEqual([])
  }, 300_000)

  it('Main’s own value is never overwritten, by the read or by recording', async () => {
    const id = await driver('Kept', {
      cdlNumber: 'MAIN-1',
      cdlState: 'TX',
      cdlClass: 'B',
    })
    const outcome = await inOrg((tx) =>
      recordRenewal(tx, {
        subject: 'driver',
        subjectId: id,
        type: 'CDL',
        expiresAt: new Date('2030-01-01T00:00:00Z'),
        identifier: 'RECORD-2',
        issuer: 'FL',
        cdlClass: 'A',
      }),
    )
    expect(outcome).toMatchObject({ ok: true })
    expect(await stored(id)).toEqual({
      cdlNumber: 'MAIN-1',
      cdlState: 'TX',
      cdlClass: 'B',
    })
    expect((await shown(id)).values).toEqual({
      cdlNumber: 'MAIN-1',
      cdlState: 'TX',
      cdlClass: 'B',
    })
  }, 300_000)

  it('the same card read again completes the seed’s expiry-only record instead of refusing it', async () => {
    // ADZHMAL'S SHAPE: the seed filed expiry 2028-07-11 and nothing else.
    const id = await driver('Seeded')
    const expiresAt = new Date('2028-07-11T00:00:00Z')
    const seeded = await owner.complianceItem.create({
      data: { organizationId, companyId, type: 'CDL', driverId: id, expiresAt },
      select: { id: true },
    })

    const outcome = await inOrg((tx) =>
      recordRenewal(tx, {
        subject: 'driver',
        subjectId: id,
        type: 'CDL',
        expiresAt,
        identifier: 'D555-0101',
        issuer: 'IL',
        cdlClass: 'A',
      }),
    )
    expect(outcome).toEqual({ ok: true, recordId: seeded.id })

    const records = await owner.complianceItem.findMany({
      where: { driverId: id, type: 'CDL', deletedAt: null },
      select: { id: true, identifier: true, issuer: true },
    })
    expect(records).toEqual([
      { id: seeded.id, identifier: 'D555-0101', issuer: 'IL' },
    ])
    expect(await stored(id)).toEqual({
      cdlNumber: 'D555-0101',
      cdlState: 'IL',
      cdlClass: 'A',
    })
  }, 300_000)

  it('the same expiry with a DIFFERENT number is still a duplicate, and nothing moves', async () => {
    const id = await driver('Clash')
    const expiresAt = new Date('2029-03-01T00:00:00Z')
    await owner.complianceItem.create({
      data: {
        organizationId,
        companyId,
        type: 'CDL',
        driverId: id,
        expiresAt,
        identifier: 'FIRST-1',
      },
    })
    const outcome = await inOrg((tx) =>
      recordRenewal(tx, {
        subject: 'driver',
        subjectId: id,
        type: 'CDL',
        expiresAt,
        identifier: 'OTHER-2',
        issuer: 'IL',
      }),
    )
    expect(outcome).toEqual({ ok: false, reason: 'duplicate' })
    const records = await owner.complianceItem.findMany({
      where: { driverId: id },
      select: { identifier: true, issuer: true },
    })
    expect(records).toEqual([{ identifier: 'FIRST-1', issuer: null }])
    expect(await stored(id)).toEqual({
      cdlNumber: null,
      cdlState: null,
      cdlClass: null,
    })
  }, 300_000)

  it('a medical card fills nothing on Main, and its duplicate is still refused', async () => {
    const id = await driver('Med')
    const expiresAt = new Date('2027-05-01T00:00:00Z')
    await owner.complianceItem.create({
      data: {
        organizationId,
        companyId,
        type: 'MEDICAL_CARD',
        driverId: id,
        expiresAt,
      },
    })
    const outcome = await inOrg((tx) =>
      recordRenewal(tx, {
        subject: 'driver',
        subjectId: id,
        type: 'MEDICAL_CARD',
        expiresAt,
        identifier: 'EXAMINER-9',
        issuer: 'IL',
      }),
    )
    expect(outcome).toEqual({ ok: false, reason: 'duplicate' })
    expect(await stored(id)).toEqual({
      cdlNumber: null,
      cdlState: null,
      cdlClass: null,
    })
  }, 300_000)
})
