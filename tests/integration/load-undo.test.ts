import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { createBroker } from '@/lib/brokers'
import { createDriver, createTruck } from '@/lib/fleet'
import {
  cancelLoad,
  createLoad,
  LOAD_WRITE_TIMEOUT_MS,
  markDelivered,
  updateLoad,
  type StopInput,
} from '@/lib/loads'
import { addAccessorial, removeAccessorial, setLoadRate } from '@/lib/rates'
import { transitionOperational } from '@/lib/load-status'
import { generateInvoice } from '@/lib/invoices'
import { applyUndo, undoStateFor, type UndoVerdict } from '@/lib/load-undo'
import { duplicateLoad, saveLoadEdit } from '@/lib/load-edit'
import { stopFormValues } from '@/lib/load-form'
import { STORED_STOP_SELECT } from '@/lib/load-edit'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// UNDO'S AGREEMENT TEST (TMS §7.14 part 7, v11.60).
//
// THE FIXTURES ARE THE AUDIT ROWS THE REAL WRITERS PRODUCE. Each case makes a
// change through the function the screen calls — `updateLoad`, `markDelivered`,
// `addAccessorial`, `setLoadRate`, `saveLoadEdit`, `generateInvoice` — then
// asks the menu's question (`undoStateFor`, what the page renders) and does
// the write (`applyUndo`, what the menu item posts). The two must agree: an
// item the menu enables is one the write performs, and an item it disables is
// one the write refuses for the same reason. And where it performs, the load
// is back where it was.
//
// A hand-written audit row would test the predicate against the shape its
// author believed the writers produce; these test it against the shape they
// do.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let app: PrismaClient

let organizationId = ''
let companyId = ''
let userId = ''
let otherUserId = ''
let brokerId = ''
const nonce = Math.random().toString(36).slice(2, 8)

const inOrgAs = <T>(
  who: string,
  fn: Parameters<typeof withOrg<T>>[1],
): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId: who, ip: null, userAgent: 'load-undo.test' },
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
    maxWaitMs: 15_000,
  })
const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]) => inOrgAs(userId, fn)

const day = (d: number, hour = 8) => new Date(Date.UTC(2026, 7, d, hour, 0, 0))
const stops = (): StopInput[] => [
  { type: 'PICKUP', city: 'Chicago', state: 'IL', scheduledAt: day(3) },
  { type: 'DELIVERY', city: 'Dallas', state: 'TX', scheduledAt: day(5) },
]

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
  app = retryingClient(process.env.DATABASE_URL!)

  const organization = await owner.organization.create({
    data: {
      name: `Undo ${nonce}`,
      slug: `undo-${nonce}`,
      companies: { create: [{ name: `Alpha ${nonce}` }] },
    },
    include: { companies: true },
  })
  organizationId = organization.id
  companyId = organization.companies[0]!.id

  for (const [name, set] of [
    ['One', (id: string) => (userId = id)],
    ['Two', (id: string) => (otherUserId = id)],
  ] as const) {
    const user = await owner.user.create({
      data: { email: `undo-${name}-${nonce}@example.test`, name },
    })
    set(user.id)
    await owner.membership.create({
      data: { userId: user.id, organizationId, role: 'OWNER' },
    })
  }

  brokerId = (
    await inOrg((tx) =>
      createBroker(tx, organizationId, { name: `Broker ${nonce}` }),
    )
  ).id
}, 300_000)

afterAll(async () => {
  await owner.organization
    .delete({ where: { id: organizationId } })
    .catch(() => {})
  await owner.user
    .deleteMany({ where: { id: { in: [userId, otherUserId] } } })
    .catch(() => {})
  await app.$disconnect()
  await owner.$disconnect()
})

async function newLoad() {
  return inOrg((tx) =>
    createLoad(
      tx,
      organizationId,
      {
        companyId,
        customerId: brokerId,
        stops: stops(),
        linehaulCents: 100000,
      },
      { byUserId: userId },
    ),
  )
}

/** A live rate con, so truck plus driver dispatches rather than holds. */
async function rateConOn(loadId: string) {
  await owner.document.create({
    data: {
      organizationId,
      companyId,
      loadId,
      type: 'RATE_CONFIRMATION',
      r2Key: `${organizationId}/rc/${loadId}-${Math.random()}`,
      filename: 'rc.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
    },
  })
}

const snapshot = (loadId: string) =>
  owner.load.findUniqueOrThrow({
    where: { id: loadId },
    include: {
      stops: { orderBy: { sequence: 'asc' } },
      accessorials: { orderBy: { createdAt: 'asc' } },
    },
  })

/** The menu's question, as the page asks it, for `who`. */
async function asked(loadId: string, who = userId): Promise<UndoVerdict> {
  const load = await snapshot(loadId)
  return inOrgAs(who, (tx) =>
    undoStateFor(
      tx,
      {
        id: loadId,
        childIds: [
          ...load.stops.map((stop) => stop.id),
          ...load.accessorials.map((line) => line.id),
        ],
      },
      who,
    ),
  )
}

/** The menu's question and the write, side by side: they must agree. */
async function askedAndDone(loadId: string, who = userId) {
  const verdict = await asked(loadId, who)
  const outcome = await inOrgAs(who, (tx) => applyUndo(tx, loadId, who))
  expect(outcome.ok).toBe(verdict.ok)
  if (verdict.ok && outcome.ok) expect(outcome.kind).toBe(verdict.kind)
  if (!verdict.ok && !outcome.ok) expect(outcome.reason).toBe(verdict.reason)
  return { verdict, outcome }
}

describe('a change Undo takes back, and the load is where it was', () => {
  it('a field edit', async () => {
    const load = await newLoad()
    const before = await snapshot(load.id)
    await inOrg((tx) =>
      updateLoad(
        tx,
        load.id,
        { referenceNumber: 'REF-9', poNumber: 'PO-1' },
        { byUserId: userId },
      ),
    )

    const { verdict } = await askedAndDone(load.id)
    expect(verdict).toEqual({ ok: true, kind: 'edit' })
    const after = await snapshot(load.id)
    expect(after.referenceNumber).toBe(before.referenceNumber)
    expect(after.poNumber).toBe(before.poNumber)
  }, 300_000)

  it('an assignment, which also dispatched the load', async () => {
    const load = await newLoad()
    await rateConOn(load.id)
    const truck = await inOrg((tx) =>
      createTruck(tx, organizationId, {
        companyId,
        unitNumber: `U-${nonce}`,
      }),
    )
    const driver = await inOrg((tx) =>
      createDriver(tx, organizationId, {
        companyId,
        firstName: 'Undo',
        lastName: `Driver ${nonce}`,
      }),
    )
    await inOrg((tx) =>
      updateLoad(
        tx,
        load.id,
        { truckId: truck.id, driverId: driver.id },
        { byUserId: userId },
      ),
    )
    expect((await snapshot(load.id)).operationalStatus).toBe('DISPATCHED')

    const { verdict } = await askedAndDone(load.id)
    expect(verdict).toEqual({ ok: true, kind: 'assignment' })
    const after = await snapshot(load.id)
    expect(after.truckId).toBeNull()
    expect(after.driverId).toBeNull()
    expect(after.operationalStatus).toBe('BOOKED')
    // Back through the status writer, with a timeline entry of its own.
    const last = await owner.loadStatusEvent.findFirst({
      where: { loadId: load.id, axis: 'OPERATIONAL' },
      orderBy: { occurredAt: 'desc' },
    })
    expect(last).toMatchObject({
      fromStatus: 'DISPATCHED',
      toStatus: 'BOOKED',
      note: 'loads.undo.note',
    })
  }, 300_000)

  it('a status move', async () => {
    const load = await newLoad()
    await inOrg((tx) => markDelivered(tx, load.id, userId))
    expect((await snapshot(load.id)).operationalStatus).toBe('DELIVERED')

    const { verdict } = await askedAndDone(load.id)
    expect(verdict).toEqual({ ok: true, kind: 'status' })
    expect((await snapshot(load.id)).operationalStatus).toBe('BOOKED')
  }, 300_000)

  it('a cancellation', async () => {
    const load = await newLoad()
    await inOrg((tx) =>
      cancelLoad(tx, load.id, 'Broker pulled it', { byUserId: userId }),
    )

    const { verdict } = await askedAndDone(load.id)
    expect(verdict).toEqual({ ok: true, kind: 'status' })
    const after = await snapshot(load.id)
    expect(after.isCancelled).toBe(false)
    expect(after.cancelReason).toBeNull()
  }, 300_000)

  it('an accessorial line added, and one removed', async () => {
    const load = await newLoad()
    await inOrg((tx) =>
      addAccessorial(tx, organizationId, load.id, {
        type: 'DETENTION',
        amount: '150.00',
        isBillable: true,
      }),
    )
    expect((await snapshot(load.id)).totalRevenueCents).toBe(115000)

    const added = await askedAndDone(load.id)
    expect(added.verdict).toEqual({ ok: true, kind: 'accessorial' })
    let after = await snapshot(load.id)
    expect(after.accessorials).toHaveLength(0)
    expect(after.totalRevenueCents).toBe(100000)

    await inOrg((tx) =>
      addAccessorial(tx, organizationId, load.id, {
        type: 'LUMPER',
        amount: '80.00',
        isBillable: true,
        notes: 'gate 4',
      }),
    )
    const line = (await snapshot(load.id)).accessorials[0]!
    await inOrg((tx) => removeAccessorial(tx, load.id, line.id))
    expect((await snapshot(load.id)).accessorials).toHaveLength(0)

    const removed = await askedAndDone(load.id)
    expect(removed.verdict).toEqual({ ok: true, kind: 'accessorial' })
    after = await snapshot(load.id)
    expect(after.accessorials.map((row) => [row.id, row.notes])).toEqual([
      [line.id, 'gate 4'],
    ])
    expect(after.totalRevenueCents).toBe(108000)
  }, 300_000)

  it('a rate', async () => {
    const load = await newLoad()
    await inOrg((tx) =>
      setLoadRate(tx, load.id, { linehaul: '2450', fuelSurcharge: '120' }),
    )
    const { verdict } = await askedAndDone(load.id)
    expect(verdict).toEqual({ ok: true, kind: 'edit' })
    const after = await snapshot(load.id)
    expect(after.linehaulCents).toBe(100000)
    expect(after.fuelSurchargeCents).toBe(0)
    expect(after.totalRevenueCents).toBe(100000)
  }, 300_000)

  it('an Edit load save that moved a stop, and the stops come back', async () => {
    const load = await newLoad()
    const before = await snapshot(load.id)
    const shown = (
      await owner.loadStop.findMany({
        where: { loadId: load.id },
        orderBy: { sequence: 'asc' },
        select: STORED_STOP_SELECT,
      })
    ).map(stopFormValues)
    await inOrg((tx) =>
      saveLoadEdit(
        tx,
        organizationId,
        load.id,
        {
          broker: `Broker ${nonce}`,
          truckId: null,
          driverId: null,
          stops: [shown[0]!, { ...shown[1]!, place: 'Memphis, TN' }],
          bolNumber: null,
          poNumber: null,
          referenceNumber: null,
          miles: null,
        },
        { byUserId: userId },
      ),
    )
    expect((await snapshot(load.id)).stops[1]?.city).toBe('Memphis')

    const { verdict } = await askedAndDone(load.id)
    expect(verdict).toEqual({ ok: true, kind: 'edit' })
    const after = await snapshot(load.id)
    expect(
      after.stops.map((stop) => [stop.id, stop.city, stop.scheduledAt]),
    ).toEqual(
      before.stops.map((stop) => [stop.id, stop.city, stop.scheduledAt]),
    )
  }, 300_000)
})

describe('a change Undo refuses, and the menu says so first', () => {
  it('an Undo is not undone: one step back, not a history', async () => {
    const load = await newLoad()
    await inOrg((tx) =>
      updateLoad(tx, load.id, { poNumber: 'PO-2' }, { byUserId: userId }),
    )
    await askedAndDone(load.id)
    const { verdict } = await askedAndDone(load.id)
    expect(verdict).toEqual({ ok: false, reason: 'undo' })
    // And the Undo is its own event, under the person who pressed it.
    const event = await owner.auditLog.findFirst({
      where: { entityType: 'LoadUndo', entityId: load.id },
    })
    expect(event).toMatchObject({ userId, changes: { undo: { to: 'edit' } } })
  }, 300_000)

  it("somebody else's change", async () => {
    const load = await newLoad()
    await inOrgAs(otherUserId, (tx) =>
      updateLoad(tx, load.id, { poNumber: 'PO-3' }, { byUserId: otherUserId }),
    )
    const { verdict } = await askedAndDone(load.id, userId)
    expect(verdict).toEqual({ ok: false, reason: 'notYours' })
    expect((await snapshot(load.id)).poNumber).toBe('PO-3')
    // The person who made it may.
    const theirs = await askedAndDone(load.id, otherUserId)
    expect(theirs.verdict.ok).toBe(true)
  }, 300_000)

  it('an invoice — never undone', async () => {
    const load = await newLoad()
    await inOrg((tx) =>
      transitionOperational(tx, load.id, 'POD_RECEIVED', {
        source: 'AUTOMATIC',
        userId,
      }),
    )
    const invoiced = await inOrg((tx) =>
      generateInvoice(tx, organizationId, {
        loadIds: [load.id],
        labels: {
          linehaul: 'Line haul',
          fuelSurcharge: 'Fuel',
          accessorial: (type: string) => type,
        },
      }),
    )
    expect(invoiced.ok).toBe(true)
    const { verdict } = await askedAndDone(load.id)
    expect(verdict).toEqual({ ok: false, reason: 'never' })
    expect((await snapshot(load.id)).billingStatus).not.toBe('UNINVOICED')
  }, 300_000)

  it('a load changed again since, by the same hands through another path', async () => {
    const load = await newLoad()
    await inOrg((tx) =>
      updateLoad(tx, load.id, { poNumber: 'PO-4' }, { byUserId: userId }),
    )
    // Moved under Undo's feet by a write the audit trail did not see.
    await owner.load.update({
      where: { id: load.id },
      data: { poNumber: 'PO-5' },
    })
    const verdict = await asked(load.id)
    expect(verdict.ok).toBe(true)
    const outcome = await inOrg((tx) => applyUndo(tx, load.id, userId))
    expect(outcome).toEqual({ ok: false, reason: 'stale' })
    expect((await snapshot(load.id)).poNumber).toBe('PO-5')
  }, 300_000)
})

describe('Edit load and Duplicate load write through the load writers', () => {
  it('an Edit load save with nothing changed rewrites no stop', async () => {
    const load = await newLoad()
    const before = await snapshot(load.id)
    const shown = (
      await owner.loadStop.findMany({
        where: { loadId: load.id },
        orderBy: { sequence: 'asc' },
        select: STORED_STOP_SELECT,
      })
    ).map(stopFormValues)
    await inOrg((tx) =>
      saveLoadEdit(
        tx,
        organizationId,
        load.id,
        {
          broker: `Broker ${nonce}`,
          truckId: null,
          driverId: null,
          stops: shown,
          bolNumber: 'BOL-7',
          poNumber: null,
          referenceNumber: null,
          miles: '640',
        },
        { byUserId: userId },
      ),
    )
    const after = await snapshot(load.id)
    expect(after.stops.map((stop) => stop.id)).toEqual(
      before.stops.map((stop) => stop.id),
    )
    expect(after.bolNumber).toBe('BOL-7')
    expect(after.dispatchedMiles).toBe(640)
  }, 300_000)

  it('a duplicate: new number, Booked, no crew, the plan and the rate', async () => {
    const load = await newLoad()
    await rateConOn(load.id)
    await inOrg((tx) =>
      updateLoad(
        tx,
        load.id,
        { referenceNumber: 'RC-11', bolNumber: 'B-1', poNumber: 'P-1' },
        { byUserId: userId },
      ),
    )
    await owner.loadStop.updateMany({
      where: { loadId: load.id, sequence: 1 },
      data: { arrivedAt: day(3, 9), contactName: 'Dana' },
    })
    const source = await snapshot(load.id)

    const copy = await inOrg((tx) =>
      duplicateLoad(tx, organizationId, load.id, { byUserId: userId }),
    )
    const made = await snapshot(copy.id)
    expect(made.loadNumber).not.toBe(source.loadNumber)
    expect(made.operationalStatus).toBe('BOOKED')
    expect([made.truckId, made.driverId, made.trailerId]).toEqual([
      null,
      null,
      null,
    ])
    expect(made).toMatchObject({
      customerId: source.customerId,
      companyId: source.companyId,
      referenceNumber: 'RC-11',
      bolNumber: 'B-1',
      poNumber: 'P-1',
      linehaulCents: source.linehaulCents,
      paymentType: source.paymentType,
    })
    expect(made.stops.map((stop) => [stop.city, stop.scheduledAt])).toEqual(
      source.stops.map((stop) => [stop.city, stop.scheduledAt]),
    )
    // The plan, never what happened.
    expect(made.stops[0]?.arrivedAt).toBeNull()
    expect(made.stops[0]?.contactName).toBe('Dana')
    expect(await owner.document.count({ where: { loadId: copy.id } })).toBe(0)
  }, 300_000)
})
