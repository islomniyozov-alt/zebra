import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { runInOrg, withOrg, type TxClient } from '@/lib/tenancy'
import { createTruck, createDriver } from '@/lib/fleet'
import { createBroker } from '@/lib/brokers'
import {
  createLoad,
  updateLoad,
  LOAD_WRITE_TIMEOUT_MS,
  type StopInput,
} from '@/lib/loads'
import {
  applyAssignmentStatus,
  dispatchHeld,
  dispatchWithReason,
} from '@/lib/load-status'
import { confirmUpload, mintUpload } from '@/lib/documents'
import { deleteObject, r2ConfigFromEnv } from '@/lib/r2'
import type { DocumentType, PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE RATE-CON GATE IS ON THE MOVE TO DISPATCHED, AND EVERY PATH AGREES
// (TMS §7.14 items 3–4, v11.43; owner's rulings 2026-11-22).
//
// Broker freight with no rate con: the create form, the edit form and the
// board's write each save truck and driver and leave the load at Booked —
// and on each, the page's `dispatchHeld` says the same thing the writer did.
// It moves on the rate con landing (a real R2 confirm) or a written reason,
// and on nothing else. An Amazon load beside it dispatches as it always has.
//
// And a driver's portal photo files into the folder of the stop the load
// stands at when it lands.
// ---------------------------------------------------------------------------

const config = r2ConfigFromEnv()
const keysTouched = new Set<string>()

let owner: PrismaClient
let app: PrismaClient
let organizationId = ''
let companyId = ''
let userId = ''
let brokerId = ''
let amazonId = ''
const nonce = Math.random().toString(36).slice(2, 8)

const attribution = { userId: '', ip: null, userAgent: 'dispatch-hold' }

const inOrg = <T>(fn: (tx: TxClient) => Promise<T>): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { ...attribution, userId },
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
    maxWaitMs: 15_000,
  })

const day = (d: number) => new Date(Date.UTC(2026, 11, d, 8, 0, 0))
const stops = (d: number): StopInput[] => [
  { type: 'PICKUP', city: 'Chicago', state: 'IL', scheduledAt: day(d) },
  { type: 'DELIVERY', city: 'Dallas', state: 'TX', scheduledAt: day(d + 1) },
]

let seq = 0
async function equipment() {
  seq += 1
  const truck = await inOrg((tx) =>
    createTruck(tx, organizationId, {
      companyId,
      unitNumber: `H${seq}-${nonce}`,
    }),
  )
  const driver = await inOrg((tx) =>
    createDriver(tx, organizationId, {
      companyId,
      firstName: 'Hold',
      lastName: `${seq}-${nonce}`,
    }),
  )
  return { truckId: truck.id, driverId: driver.id }
}

const state = (loadId: string) =>
  owner.load.findUniqueOrThrow({
    where: { id: loadId },
    select: {
      operationalStatus: true,
      truckId: true,
      driverId: true,
      isCancelled: true,
    },
  })

const heldNow = async (loadId: string) => {
  const load = await state(loadId)
  return inOrg((tx) => dispatchHeld(tx, loadId, load))
}

const dispatchedEvents = (loadId: string) =>
  owner.loadStatusEvent.findMany({
    where: { loadId, toStatus: 'DISPATCHED', outcome: 'APPLIED' },
    select: { source: true, note: true, changedByUserId: true },
  })

/** The office's (or the portal's) upload, through real R2 and the real confirm. */
async function upload(
  loadId: string,
  type: DocumentType,
  options: { photoStageFromLoad?: boolean } = {},
) {
  const bytes = new TextEncoder().encode(`${type} ${loadId} ${Math.random()}`)
  const hash = await crypto.subtle.digest(
    'SHA-256',
    bytes as Uint8Array<ArrayBuffer>,
  )
  const sha256Base64 = btoa(String.fromCharCode(...new Uint8Array(hash)))
  const photo = type === 'PHOTO'
  const minted = await runInOrg(
    app,
    organizationId,
    (tx) =>
      mintUpload(
        tx,
        organizationId,
        {
          entity: 'load',
          entityId: loadId,
          filename: photo ? 'trailer.jpg' : 'rc.pdf',
          mimeType: photo ? 'image/jpeg' : 'application/pdf',
          sizeBytes: bytes.byteLength,
          sha256Base64,
          documentType: type,
        },
        { requestedByUserId: userId },
      ),
    { attribution: { ...attribution, userId } },
  )
  keysTouched.add(minted.key)
  const put = await fetch(minted.url, {
    method: 'PUT',
    headers: minted.headers,
    body: bytes as BodyInit,
  })
  expect(put.status).toBe(200)
  return confirmUpload(
    (fn) =>
      runInOrg(app, organizationId, fn, {
        attribution: { ...attribution, userId },
      }),
    organizationId,
    minted.pendingUploadId,
    { uploadedByUserId: userId, ...options },
  )
}

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
  app = retryingClient(process.env.DATABASE_URL!)
  const organization = await owner.organization.create({
    data: {
      name: `Hold ${nonce}`,
      slug: `hold-${nonce}`,
      companies: { create: { name: `Authority ${nonce}` } },
    },
    include: { companies: true },
  })
  organizationId = organization.id
  companyId = organization.companies[0]!.id
  const user = await owner.user.create({
    data: { email: `hold-${nonce}@example.test`, name: 'Hold Tester' },
  })
  userId = user.id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })
  brokerId = (
    await inOrg((tx) =>
      createBroker(tx, organizationId, { name: `Werner ${nonce}` }),
    )
  ).id
  amazonId = (
    await owner.customer.create({
      data: { organizationId, name: 'Amazon Relay' },
      select: { id: true },
    })
  ).id
}, 180_000)

afterAll(async () => {
  for (const key of keysTouched) {
    await deleteObject(config, key).catch(() => {})
  }
  await owner.organization
    .delete({ where: { id: organizationId } })
    .catch(() => {})
  await owner.user.delete({ where: { id: userId } }).catch(() => {})
  await app.$disconnect()
  await owner.$disconnect()
})

describe('broker freight with no rate con is held on every path', () => {
  it('the create form: truck and driver save, the load stays Booked', async () => {
    const { truckId, driverId } = await equipment()
    const load = await inOrg((tx) =>
      createLoad(tx, organizationId, {
        companyId,
        customerId: brokerId,
        truckId,
        driverId,
        stops: stops(1),
      }),
    )
    const after = await state(load.id)
    expect(after).toMatchObject({
      operationalStatus: 'BOOKED',
      truckId,
      driverId,
    })
    expect(await heldNow(load.id)).toBe(true)
    expect(await dispatchedEvents(load.id)).toEqual([])
  }, 120_000)

  it('the edit form: the same', async () => {
    const load = await inOrg((tx) =>
      createLoad(tx, organizationId, {
        companyId,
        customerId: brokerId,
        stops: stops(4),
      }),
    )
    expect(await heldNow(load.id)).toBe(false) // nothing assigned yet
    const { truckId, driverId } = await equipment()
    await inOrg((tx) => updateLoad(tx, load.id, { truckId, driverId }))
    expect((await state(load.id)).operationalStatus).toBe('BOOKED')
    expect(await heldNow(load.id)).toBe(true)
    expect(await dispatchedEvents(load.id)).toEqual([])
  }, 120_000)

  it('the board: a blank reason holds; a written one dispatches, MANUAL, the reason as the note', async () => {
    const load = await inOrg((tx) =>
      createLoad(tx, organizationId, {
        companyId,
        customerId: brokerId,
        stops: stops(7),
      }),
    )
    const { truckId, driverId } = await equipment()
    // The board's write, as `assignAction` does it: the row, then the writer.
    const board = (reason: string) =>
      inOrg(async (tx) => {
        await tx.load.update({
          where: { id: load.id },
          data: { truckId, driverId },
        })
        return applyAssignmentStatus(tx, load.id, userId, undefined, {
          rateConOverride: reason,
        })
      })

    expect(await board('')).toMatchObject({
      result: 'held',
      reason: 'rate_con_missing',
    })
    expect(await board('   ')).toMatchObject({ result: 'held' })
    expect(await heldNow(load.id)).toBe(true)

    expect(await board('Broker emailing it after pickup')).toMatchObject({
      result: 'moved',
      to: 'DISPATCHED',
    })
    expect(await heldNow(load.id)).toBe(false)
    expect(await dispatchedEvents(load.id)).toEqual([
      {
        source: 'MANUAL',
        note: 'Broker emailing it after pickup',
        changedByUserId: userId,
      },
    ])
  }, 120_000)
})

describe('what releases the hold', () => {
  it('the rate con landing, through the real confirm', async () => {
    const { truckId, driverId } = await equipment()
    const load = await inOrg((tx) =>
      createLoad(tx, organizationId, {
        companyId,
        customerId: brokerId,
        truckId,
        driverId,
        stops: stops(10),
      }),
    )
    expect(await heldNow(load.id)).toBe(true)

    await upload(load.id, 'RATE_CONFIRMATION')

    expect((await state(load.id)).operationalStatus).toBe('DISPATCHED')
    expect(await heldNow(load.id)).toBe(false)
    expect(await dispatchedEvents(load.id)).toEqual([
      {
        source: 'AUTOMATIC',
        note: 'status.note.assigned',
        changedByUserId: userId,
      },
    ])
  }, 180_000)

  it('Dispatch without rate con: blank refused, a reason moves it, a second press is not held', async () => {
    const { truckId, driverId } = await equipment()
    const load = await inOrg((tx) =>
      createLoad(tx, organizationId, {
        companyId,
        customerId: brokerId,
        truckId,
        driverId,
        stops: stops(13),
      }),
    )
    expect(
      await inOrg((tx) => dispatchWithReason(tx, load.id, userId, '  ')),
    ).toEqual({ ok: false, reason: 'reason_required' })
    expect((await state(load.id)).operationalStatus).toBe('BOOKED')

    expect(
      await inOrg((tx) =>
        dispatchWithReason(tx, load.id, userId, 'Driver has the paper copy'),
      ),
    ).toEqual({ ok: true })
    expect((await state(load.id)).operationalStatus).toBe('DISPATCHED')
    expect(await dispatchedEvents(load.id)).toEqual([
      {
        source: 'MANUAL',
        note: 'Driver has the paper copy',
        changedByUserId: userId,
      },
    ])

    expect(
      await inOrg((tx) => dispatchWithReason(tx, load.id, userId, 'again')),
    ).toEqual({ ok: false, reason: 'not_held' })
  }, 120_000)

  it('an Amazon load is never held', async () => {
    const { truckId, driverId } = await equipment()
    const load = await inOrg((tx) =>
      createLoad(tx, organizationId, {
        companyId,
        customerId: amazonId,
        truckId,
        driverId,
        stops: stops(16),
      }),
    )
    expect((await state(load.id)).operationalStatus).toBe('DISPATCHED')
    expect(await heldNow(load.id)).toBe(false)
  }, 120_000)
})

describe('a portal photo files by where the load stands', () => {
  it('At pickup → Pickup, At delivery → Delivery, In transit → none, office upload → none', async () => {
    const load = await inOrg((tx) =>
      createLoad(tx, organizationId, {
        companyId,
        customerId: brokerId,
        stops: stops(19),
      }),
    )
    const at = (
      operationalStatus: 'AT_PICKUP' | 'AT_DELIVERY' | 'IN_TRANSIT',
    ) =>
      owner.load.update({ where: { id: load.id }, data: { operationalStatus } })
    const stageOf = async (documentId: string) =>
      (
        await owner.document.findUniqueOrThrow({
          where: { id: documentId },
          select: { photoStage: true },
        })
      ).photoStage

    await at('AT_PICKUP')
    const pickup = await upload(load.id, 'PHOTO', { photoStageFromLoad: true })
    expect(await stageOf(pickup.documentId)).toBe('PICKUP')
    const office = await upload(load.id, 'PHOTO')
    expect(await stageOf(office.documentId)).toBeNull()

    await at('IN_TRANSIT')
    const moving = await upload(load.id, 'PHOTO', { photoStageFromLoad: true })
    expect(await stageOf(moving.documentId)).toBeNull()

    await at('AT_DELIVERY')
    const delivery = await upload(load.id, 'PHOTO', {
      photoStageFromLoad: true,
    })
    expect(await stageOf(delivery.documentId)).toBe('DELIVERY')
  }, 240_000)
})
