import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'
import { createTruck, updateTruck, type TruckEdit } from '@/lib/fleet'
import {
  TRUCK_DETAIL_FIELDS,
  TRUCK_FORM_FIELDS,
  truckFormValues,
  type TruckFormField,
} from '@/lib/truck-form'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// EVERY FIELD ON THE TRUCK FORM ROUND-TRIPS THROUGH SAVE AND RELOAD (TMS
// v11.36 §6.5 part 2, owner 2026-11-19).
//
// Owner name and four more were saved and then reloaded blank, because the
// page never loaded them back — and the next Save wrote the blanks. Here every
// field the form offers is changed to a new value, saved through the writer
// the edit action calls, the row reloaded, and the form's values read back
// through the page's own reader (`truckFormValues`). And each tab's Save is
// held to leaving the other tab's fields alone.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let companyId = ''
let userId = ''
const nonce = Math.random().toString(36).slice(2, 8)

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'truck-form.test' },
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
  })

const reload = async (id: string) =>
  truckFormValues(await owner.truck.findUniqueOrThrow({ where: { id } }))

/** What a form posts: strings, as FormData carries them. */
const posted = (
  values: Record<TruckFormField, string>,
  fields: readonly TruckFormField[],
): TruckEdit =>
  Object.fromEntries(fields.map((name) => [name, values[name]])) as TruckEdit

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
  organizationId = (
    await owner.organization.create({
      data: { name: `Truck form ${nonce}`, slug: `truck-form-${nonce}` },
    })
  ).id
  companyId = (
    await owner.company.create({
      data: { organizationId, name: `RAM ${nonce}` },
    })
  ).id
  userId = (
    await owner.user.create({
      data: { email: `truck-form-${nonce}@example.test`, name: 'Fleet' },
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

describe('Save and reload', () => {
  it('every field on the form comes back as it was saved', async () => {
    const truck = await inOrg((tx) =>
      createTruck(
        tx,
        organizationId,
        { companyId, unitNumber: `T1-${nonce}` },
        { byUserId: userId },
      ),
    )
    const next: Record<TruckFormField, string> = {
      unitNumber: `T1b-${nonce}`,
      vin: `1XKAD49X0DJ${nonce}`.slice(0, 17),
      plate: 'P104',
      plateState: 'IL',
      make: 'Kenworth',
      model: 'T680',
      year: '2021',
      status: 'MAINTENANCE',
      ownershipType: 'LEASED',
      currentOdometer: '412000',
      notes: 'washed',
      fuelType: 'Diesel',
      fleetStatus: 'In shop',
      ownerName: 'Karimov Leasing',
      grossWeightLbs: '52000',
      axles: '3',
    }
    // NOT VACUOUS: every field starts somewhere other than where it ends.
    const before = await reload(truck.id)
    for (const name of TRUCK_FORM_FIELDS)
      expect([name, before[name]]).not.toEqual([name, next[name]])

    await inOrg((tx) =>
      updateTruck(tx, truck.id, posted(next, TRUCK_FORM_FIELDS)),
    )
    expect(await reload(truck.id)).toEqual(next)
  }, 300_000)

  it('Details’ Save leaves Main’s fields alone, and Main’s leaves Details’', async () => {
    const truck = await inOrg((tx) =>
      createTruck(
        tx,
        organizationId,
        {
          companyId,
          unitNumber: `T2-${nonce}`,
          make: 'Volvo',
          notes: 'kept',
          ownerName: 'Original Owner LLC',
          axles: 3,
        },
        { byUserId: userId },
      ),
    )
    const start = await reload(truck.id)

    // Details posts its five; Main's are not in the form at all.
    const detailsNext = {
      ...start,
      ownerName: 'New Owner LLC',
      fuelType: 'Diesel',
    }
    await inOrg((tx) =>
      updateTruck(tx, truck.id, posted(detailsNext, TRUCK_DETAIL_FIELDS)),
    )
    expect(await reload(truck.id)).toEqual(detailsNext)

    // Main posts the rest; the Details fields survive it.
    const mainFields = TRUCK_FORM_FIELDS.filter(
      (name) => !(TRUCK_DETAIL_FIELDS as readonly string[]).includes(name),
    )
    const mainNext = { ...detailsNext, make: 'Peterbilt', notes: 'changed' }
    await inOrg((tx) => updateTruck(tx, truck.id, posted(mainNext, mainFields)))
    expect(await reload(truck.id)).toEqual(mainNext)
  }, 300_000)

  it('a field sent empty is cleared — omitted and blank are different', async () => {
    const truck = await inOrg((tx) =>
      createTruck(
        tx,
        organizationId,
        { companyId, unitNumber: `T3-${nonce}`, ownerName: 'Someone' },
        { byUserId: userId },
      ),
    )
    await inOrg((tx) => updateTruck(tx, truck.id, { ownerName: '' }))
    expect((await reload(truck.id)).ownerName).toBe('')
  }, 300_000)
})
