import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'
import { findAuthorityDrift } from '@/lib/asset-transfer'
import { setRosterStatus, updateDriver } from '@/lib/fleet'
import { dropOrganization, seedOrganization, type OrgFixture } from './fixtures'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// LEAVING TERMINATED OPENS THE PERIOD, AGAINST REAL POSTGRES (TMS §6.4 part 1
// v11.39; owner's ruling 2026-11-20, GAPS 48).
//
// The shape of 2026-11-19 on dev, reproduced: a driver terminated by an
// import — INACTIVE, a `companyId`, NO period — set back to work through each
// of the two writers, under row-level security as the app runs them. After
// it each has exactly one open period under its own authority, and the drift
// check that failed the production gate finds neither of them.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let org: OrgFixture
let byBulkBar = ''
let byForm = ''

const nonce = Math.random().toString(36).slice(2, 8)

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(org.organizationId, fn, {
    attribution: {
      userId: org.userId,
      ip: null,
      userAgent: 'reactivation-period.test',
    },
    maxWaitMs: 15_000,
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
  })

async function terminatedWithNoPeriod(label: string): Promise<string> {
  const row = await owner.driver.create({
    data: {
      organizationId: org.organizationId,
      companyId: org.companyId,
      firstName: label,
      lastName: `Returned ${nonce}`,
      status: 'INACTIVE',
      terminationDate: new Date('2026-01-15T00:00:00Z'),
    },
    select: { id: true },
  })
  ;(org.ids['driver'] ??= []).push(row.id)
  return row.id
}

const openPeriods = (driverId: string) =>
  owner.assetAssignment.findMany({
    where: { driverId, effectiveTo: null },
    select: { companyId: true },
  })

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
  org = await seedOrganization(owner, 'react', nonce)
  byBulkBar = await terminatedWithNoPeriod('Bulk')
  byForm = await terminatedWithNoPeriod('Form')
}, 180_000)

afterAll(async () => {
  await owner.assetAssignment.deleteMany({
    where: { driverId: { in: [byBulkBar, byForm].filter(Boolean) } },
  })
  await dropOrganization(owner, org)
  await owner.$disconnect()
})

describe('a terminated driver brought back to work', () => {
  it('starts with no period, and is not drift while INACTIVE', async () => {
    expect(await openPeriods(byBulkBar)).toEqual([])
    expect(await openPeriods(byForm)).toEqual([])
    const drift = await inOrg((tx) => findAuthorityDrift(tx))
    const ids = drift.map((row) => row.assetId)
    expect(ids).not.toContain(byBulkBar)
    expect(ids).not.toContain(byForm)
  })

  it('the bulk bar opens one period under the driver’s own authority', async () => {
    const outcome = await inOrg((tx) =>
      setRosterStatus(tx, byBulkBar, 'AVAILABLE'),
    )
    expect(outcome.ok).toBe(true)
    expect(await openPeriods(byBulkBar)).toEqual([{ companyId: org.companyId }])
  })

  it('the record form opens one period under the driver’s own authority', async () => {
    await inOrg((tx) =>
      updateDriver(tx, byForm, {
        firstName: 'Form',
        lastName: `Returned ${nonce}`,
        status: 'AVAILABLE',
      }),
    )
    expect(await openPeriods(byForm)).toEqual([{ companyId: org.companyId }])
  })

  it('the drift check finds neither, and a second save opens no second period', async () => {
    await inOrg((tx) => setRosterStatus(tx, byBulkBar, 'VACATION'))
    expect(await openPeriods(byBulkBar)).toHaveLength(1)
    const drift = await inOrg((tx) => findAuthorityDrift(tx))
    const ids = drift.map((row) => row.assetId)
    expect(ids).not.toContain(byBulkBar)
    expect(ids).not.toContain(byForm)
  })
})
