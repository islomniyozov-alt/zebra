import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { txReader, withOrg, type TxClient } from '@/lib/tenancy'
import { createBroker } from '@/lib/brokers'
import { LOAD_WRITE_TIMEOUT_MS, createLoad } from '@/lib/loads'
import { createTruck, updateDriver, updateTruck } from '@/lib/fleet'
import { readDriverRecordHead } from '@/lib/driver-record-head'
import { readDriversHead } from '@/lib/drivers-page'
import { readTruckListData } from '@/lib/truck-list-page'
import { readTruckListParams } from '@/lib/truck-list'
import { readLoadListExport } from '@/lib/load-list-page'
import { readLoadListParams } from '@/lib/load-list'
import { truckFormValues } from '@/lib/truck-form'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// A SAVED VALUE IS THE ONE EVERY SCREEN READS (TMS v11.37 §0 rule 13, owner
// 2026-11-19).
//
// Per entity: change a field through the writer its form calls, then read the
// RECORD, the LIST and one DOWNSTREAM screen — the loads export, which names
// the driver and the truck of every load — each through the reader that
// screen uses, and find the new value in all three. The old value is checked
// present first in each, so a reader that shows nothing cannot pass by
// showing nothing new.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let companyId = ''
let userId = ''
let truckId = ''
let driverId = ''
const nonce = Math.random().toString(36).slice(2, 8)
const NOW = new Date()

const inOrg = <T>(fn: (tx: TxClient) => Promise<T>): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'saved-value.test' },
    maxWaitMs: 20_000,
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
  })

/** The driver record, as the driver page reads it. */
const driverRecord = () =>
  inOrg(async (tx) => {
    const head = await readDriverRecordHead(txReader(tx), {
      driverId,
      organizationId,
      companyScopes: [],
      withSignIn: false,
      now: NOW,
    })
    return `${head!.driver.firstName} ${head!.driver.lastName}`
  })

/** The drivers list's row for this driver, as /drivers reads it. */
const driverListRow = () =>
  inOrg(async (tx) => {
    const head = await readDriversHead(txReader(tx), {
      userId,
      base: { companyScopes: [] },
      healthCompanyIds: [],
      now: NOW,
      includeRemoved: false,
      list: { tab: 'active', missing: null, cap: 500 },
    })
    return head.drivers.find((row) => row.id === driverId)
  })

/** The trucks list's row for this truck, as /trucks reads it. */
const truckListRow = () =>
  inOrg(async (tx) => {
    const data = await readTruckListData(
      txReader(tx),
      [],
      readTruckListParams({}),
      {
        now: NOW,
        take: 500,
        userId,
        healthCompanyIds: [companyId],
      },
    )
    return data.rows.find((row) => row.id === truckId)
  })

/** The loads export, as the Export button produces it. */
const exported = () =>
  inOrg((tx) =>
    readLoadListExport(
      tx,
      { userId, companyScopes: [] },
      readLoadListParams({}),
      NOW,
    ),
  ).then((file) => file.body)

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
  const organization = await owner.organization.create({
    data: {
      name: `Saved value ${nonce}`,
      slug: `saved-value-${nonce}`,
      companies: { create: [{ name: `RAM ${nonce}`, isDefault: true }] },
    },
    include: { companies: true },
  })
  organizationId = organization.id
  companyId = organization.companies[0]!.id
  userId = (
    await owner.user.create({
      data: { email: `saved-value-${nonce}@example.test`, name: 'Saved' },
    })
  ).id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })

  truckId = (
    await inOrg((tx) =>
      createTruck(
        tx,
        organizationId,
        { companyId, unitNumber: `U${nonce}` },
        { byUserId: userId },
      ),
    )
  ).id
  driverId = (
    await owner.driver.create({
      data: {
        organizationId,
        companyId,
        firstName: 'Adzhmal',
        lastName: `Before${nonce}`,
        assignedTruckId: truckId,
      },
    })
  ).id
  const brokerId = (
    await inOrg((tx) =>
      createBroker(tx, organizationId, { name: `Broker ${nonce}` }),
    )
  ).id
  const load = await inOrg((tx) =>
    createLoad(
      tx,
      organizationId,
      {
        companyId,
        customerId: brokerId,
        stops: [
          {
            type: 'PICKUP',
            state: 'IL',
            city: 'Chicago',
            name: null,
            scheduledAt: NOW,
          },
          {
            type: 'DELIVERY',
            state: 'OH',
            city: 'Dayton',
            name: null,
            scheduledAt: new Date(NOW.getTime() + 86_400_000),
          },
        ],
      },
      { byUserId: userId },
    ),
  )
  // The crew is a fixture: dispatching is not what this file tests.
  await owner.load.update({
    where: { id: load.id },
    data: { driverId, truckId },
  })
}, 300_000)

afterAll(async () => {
  await owner.organization
    .delete({ where: { id: organizationId } })
    .catch(() => {})
  await owner.user.delete({ where: { id: userId } }).catch(() => {})
  await owner.$disconnect()
})

describe('a saved value is the one every screen reads', () => {
  it('drivers: a renamed driver reads renamed on the record, the list and the loads export', async () => {
    // NOT VACUOUS: the old name is on all three first.
    expect(await driverRecord()).toBe(`Adzhmal Before${nonce}`)
    expect((await driverListRow())?.lastName).toBe(`Before${nonce}`)
    expect(await exported()).toContain(`Before${nonce}`)

    // The form's writer, with what the form posts — the truck seat included,
    // as the Main form sends it.
    await inOrg((tx) =>
      updateDriver(tx, driverId, {
        firstName: 'Adzhmal',
        lastName: `After${nonce}`,
        assignedTruckId: truckId,
      }),
    )

    expect(await driverRecord()).toBe(`Adzhmal After${nonce}`)
    expect((await driverListRow())?.lastName).toBe(`After${nonce}`)
    const file = await exported()
    expect(file).toContain(`After${nonce}`)
    expect(file).not.toContain(`Before${nonce}`)
  }, 300_000)

  it('trucks: a renumbered truck reads renumbered on the record, the list and the loads export', async () => {
    const before = `U${nonce}`
    const after = `V${nonce}`
    expect(
      truckFormValues(
        await owner.truck.findUniqueOrThrow({ where: { id: truckId } }),
      ).unitNumber,
    ).toBe(before)
    expect((await truckListRow())?.unitNumber).toBe(before)
    expect(await exported()).toContain(before)

    // The edit form's writer, Main's field only (omitted means unchanged).
    await inOrg((tx) => updateTruck(tx, truckId, { unitNumber: after }))

    expect(
      truckFormValues(
        await owner.truck.findUniqueOrThrow({ where: { id: truckId } }),
      ).unitNumber,
    ).toBe(after)
    expect((await truckListRow())?.unitNumber).toBe(after)
    // And the driver list, which names the driver's truck by its unit.
    expect((await driverListRow())?.assignedTruck?.unitNumber).toBe(after)
    const file = await exported()
    expect(file).toContain(after)
    expect(file).not.toContain(before)
  }, 300_000)
})
