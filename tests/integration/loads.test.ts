import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { createTruck, createDriver, transferAsset } from '@/lib/fleet'
import { createBroker, updateBroker } from '@/lib/brokers'
import {
  cancelLoad,
  createLoad,
  markDelivered,
  podConfirmed,
  uncancelLoad,
  LOAD_WRITE_TIMEOUT_MS,
  updateLoad,
  type StopInput,
} from '@/lib/loads'
import { transitionOperational } from '@/lib/load-status'
import { DispatchConflictError } from '@/lib/dispatch'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// Step 3: the load service, the status engine (§7) and the conflict rules (§8).
//
// The status tests REPLAY transitions deliberately — the same call twice, and
// out of order — because that is not a hypothetical. A document confirm
// retried after a timeout fires POD twice; a driver marks Delivered while a
// POD upload from ten minutes ago is still landing, so POD arrives first. An
// engine that is only correct when its inputs arrive once, in order, is an
// engine that is correct in tests and wrong at 6am.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let app: PrismaClient

let organizationId = ''
let alphaId = ''
let bravoId = ''
let userId = ''
let brokerId = ''
const nonce = Math.random().toString(36).slice(2, 8)

// LOAD_WRITE_TIMEOUT_MS, for the reason recorded on it: a create sends ~31
// statements and a round trip from here is 200ms, so Prisma's 5s default
// aborts mid-transaction. The failure surfaces as an opaque "expired
// transaction" from whichever statement happened to be in flight, which is
// exactly the kind of error that gets blamed on the code under test.
//
// `maxWaitMs` for a different reason, and one worth separating: Prisma gives
// up waiting for a POOLED CONNECTION after 2s. Run alone this suite never
// notices; run after seven other integration files it failed three tests with
// "Unable to start a transaction in the given time" — the ceiling
// src/lib/counters.ts already documents, reached by suite congestion rather
// than by concurrency. It is a wait, not a deadlock, so waiting longer is the
// honest fix here.
const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'loads.test' },
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
    maxWaitMs: 15_000,
  })

const day = (d: number, hour = 8) => new Date(Date.UTC(2026, 7, d, hour, 0, 0))

const stops = (from: Date, to: Date): StopInput[] => [
  { type: 'PICKUP', city: 'Chicago', state: 'IL', scheduledAt: from },
  { type: 'DELIVERY', city: 'Dallas', state: 'TX', scheduledAt: to },
]

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
  app = retryingClient(process.env.DATABASE_URL!)

  const organization = await owner.organization.create({
    data: {
      name: `Loads ${nonce}`,
      slug: `loads-${nonce}`,
      maxCompanies: 5,
      companies: {
        create: [{ name: `Alpha ${nonce}` }, { name: `Bravo ${nonce}` }],
      },
    },
    include: { companies: { orderBy: { name: 'asc' } } },
  })
  organizationId = organization.id
  alphaId = organization.companies[0]!.id
  bravoId = organization.companies[1]!.id

  const user = await owner.user.create({
    data: { email: `loads-${nonce}@example.test`, name: 'Loads Tester' },
  })
  userId = user.id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })

  brokerId = (
    await inOrg((tx) =>
      createBroker(tx, organizationId, { name: `Broker ${nonce}` }),
    )
  ).id
})

afterAll(async () => {
  await owner.organization
    .delete({ where: { id: organizationId } })
    .catch(() => {})
  await owner.user.delete({ where: { id: userId } }).catch(() => {})
  await app.$disconnect()
  await owner.$disconnect()
})

/** A truck and driver under Alpha, fresh per test that assigns. */
async function equipment(tag: string, companyId = alphaId) {
  const truck = await inOrg((tx) =>
    createTruck(tx, organizationId, {
      companyId,
      unitNumber: `${tag}-${nonce}`,
    }),
  )
  const driver = await inOrg((tx) =>
    createDriver(tx, organizationId, {
      companyId,
      firstName: 'Test',
      lastName: `${tag}-${nonce}`,
    }),
  )
  return { truckId: truck.id, driverId: driver.id }
}

describe('creating a load', () => {
  it('takes its number from the counter, contiguously', async () => {
    const first = await inOrg((tx) =>
      createLoad(tx, organizationId, {
        companyId: alphaId,
        customerId: brokerId,
        stops: stops(day(1), day(3)),
      }),
    )
    const second = await inOrg((tx) =>
      createLoad(tx, organizationId, {
        companyId: alphaId,
        customerId: brokerId,
        stops: stops(day(1), day(3)),
      }),
    )

    expect(Number(second.loadNumber)).toBe(Number(first.loadNumber) + 1)
    expect(first.operationalStatus).toBe('BOOKED')
    expect(first.billingStatus).toBe('UNINVOICED')
  })

  it('numbers each authority on its own series', async () => {
    // §10: RAM Haulage's load 1043 and Dolphins Transport's 1043 are different
    // loads, and a broker looking at one has no idea the other exists.
    const alpha = await inOrg((tx) =>
      createLoad(tx, organizationId, {
        companyId: alphaId,
        customerId: brokerId,
        stops: stops(day(1), day(3)),
      }),
    )
    const bravo = await inOrg((tx) =>
      createLoad(tx, organizationId, {
        companyId: bravoId,
        customerId: brokerId,
        stops: stops(day(1), day(3)),
      }),
    )
    expect(Number(bravo.loadNumber)).toBeLessThan(Number(alpha.loadNumber))
  })

  it('writes stops as rows, in the order given', async () => {
    // §2 decision 3: multi-stop in the data, single-stop in the UI. The
    // service takes a list; nothing here assumes two.
    const load = await inOrg((tx) =>
      createLoad(tx, organizationId, {
        companyId: alphaId,
        customerId: brokerId,
        stops: [
          { type: 'PICKUP', city: 'Chicago', state: 'il', scheduledAt: day(1) },
          {
            type: 'INTERMEDIATE',
            city: 'Memphis',
            state: 'tn',
            scheduledAt: day(2),
          },
          {
            type: 'DELIVERY',
            city: 'Dallas',
            state: 'tx',
            scheduledAt: day(3),
          },
        ],
      }),
    )

    const written = await inOrg((tx) =>
      tx.loadStop.findMany({
        where: { loadId: load.id },
        orderBy: { sequence: 'asc' },
      }),
    )
    expect(written.map((s) => [s.sequence, s.type, s.state])).toEqual([
      [1, 'PICKUP', 'IL'],
      [2, 'INTERMEDIATE', 'TN'],
      [3, 'DELIVERY', 'TX'],
    ])
  })

  it('opens the status log at BOOKED', async () => {
    const load = await inOrg((tx) =>
      createLoad(tx, organizationId, {
        companyId: alphaId,
        customerId: brokerId,
        stops: stops(day(1), day(3)),
      }),
    )
    const events = await inOrg((tx) =>
      tx.loadStatusEvent.findMany({ where: { loadId: load.id } }),
    )
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      fromStatus: null,
      toStatus: 'BOOKED',
      axis: 'OPERATIONAL',
    })
  })

  it('refuses fewer than two stops, and accepts two', async () => {
    await expect(
      inOrg((tx) =>
        createLoad(tx, organizationId, {
          companyId: alphaId,
          customerId: brokerId,
          stops: [{ type: 'PICKUP', city: 'Chicago' }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'required', field: 'stops' })

    const ok = await inOrg((tx) =>
      createLoad(tx, organizationId, {
        companyId: alphaId,
        customerId: brokerId,
        stops: stops(day(1), day(3)),
      }),
    )
    expect(ok.id).toBeTruthy()
  })

  it('refuses a BLOCKED broker, and accepts the same broker once unblocked', async () => {
    // BIG M II again: booking against a blocked broker is the exact thing
    // blocking exists to prevent.
    const blocked = await inOrg((tx) =>
      createBroker(tx, organizationId, {
        name: `Blocked ${nonce}`,
        status: 'BLOCKED',
        blockedReason: 'Ninety days past due',
      }),
    )

    await expect(
      inOrg((tx) =>
        createLoad(tx, organizationId, {
          companyId: alphaId,
          customerId: blocked.id,
          stops: stops(day(1), day(3)),
        }),
      ),
    ).rejects.toMatchObject({ field: 'customerId' })

    await inOrg((tx) =>
      updateBroker(tx, blocked.id, { name: blocked.name, status: 'ACTIVE' }),
    )
    const ok = await inOrg((tx) =>
      createLoad(tx, organizationId, {
        companyId: alphaId,
        customerId: blocked.id,
        stops: stops(day(1), day(3)),
      }),
    )
    expect(ok.customerId).toBe(blocked.id)
  })

  it('does not burn a load number on a refused create', async () => {
    // Everything refusable is refused before the counter moves, so the series
    // stays contiguous. A gap in load numbers is a question nobody can answer.
    const before = await inOrg((tx) =>
      tx.counter.findUnique({
        where: { companyId_key: { companyId: alphaId, key: 'LOAD_NUMBER' } },
      }),
    )

    await expect(
      inOrg((tx) =>
        createLoad(tx, organizationId, {
          companyId: alphaId,
          customerId: brokerId,
          stops: [{ type: 'PICKUP', city: 'Nowhere' }],
        }),
      ),
    ).rejects.toBeTruthy()

    const after = await inOrg((tx) =>
      tx.counter.findUnique({
        where: { companyId_key: { companyId: alphaId, key: 'LOAD_NUMBER' } },
      }),
    )
    expect(after?.value).toBe(before?.value)
  })
})

describe('the status engine', () => {
  let loadId = ''

  beforeEach(async () => {
    const load = await inOrg((tx) =>
      createLoad(tx, organizationId, {
        companyId: alphaId,
        customerId: brokerId,
        stops: stops(day(10), day(12)),
      }),
    )
    loadId = load.id
  })

  const statusOf = () =>
    inOrg((tx) =>
      tx.load
        .findUniqueOrThrow({ where: { id: loadId } })
        .then((l) => l.operationalStatus),
    )

  const eventCount = () =>
    inOrg((tx) => tx.loadStatusEvent.count({ where: { loadId } }))

  it('sets Dispatched automatically when truck AND driver are assigned', async () => {
    const { truckId, driverId } = await equipment('disp')
    await inOrg((tx) => updateLoad(tx, loadId, { truckId, driverId }))
    expect(await statusOf()).toBe('DISPATCHED')
  })

  it('does NOT dispatch on a truck alone', async () => {
    // The pairing for the test above: half an assignment is not an assignment.
    const { truckId, driverId } = await equipment('half')
    await inOrg((tx) => updateLoad(tx, loadId, { truckId }))
    expect(await statusOf()).toBe('BOOKED')

    await inOrg((tx) => updateLoad(tx, loadId, { driverId }))
    expect(await statusOf()).toBe('DISPATCHED')
  })

  it('reverts to Booked when the assignment is removed', async () => {
    const { truckId, driverId } = await equipment('revert')
    await inOrg((tx) => updateLoad(tx, loadId, { truckId, driverId }))
    expect(await statusOf()).toBe('DISPATCHED')

    await inOrg((tx) => updateLoad(tx, loadId, { driverId: null }))
    expect(await statusOf()).toBe('BOOKED')
  })

  it('does NOT revert once the load has moved past Dispatched', async () => {
    // §7: "reverts if the assignment is removed BEFORE any later state". A
    // delivered load does not go back to Booked because somebody cleared the
    // driver field.
    const { truckId, driverId } = await equipment('norevert')
    await inOrg((tx) => updateLoad(tx, loadId, { truckId, driverId }))
    await inOrg((tx) => markDelivered(tx, loadId, userId))
    expect(await statusOf()).toBe('DELIVERED')

    await inOrg((tx) => updateLoad(tx, loadId, { driverId: null }))
    expect(await statusOf()).toBe('DELIVERED')
  })

  it('is IDEMPOTENT: the same transition twice writes one event', async () => {
    // A document confirm retried after a timeout fires this twice.
    await inOrg((tx) => markDelivered(tx, loadId, userId))
    const afterFirst = await eventCount()

    const second = await inOrg((tx) => markDelivered(tx, loadId, userId))
    expect(second).toEqual({ result: 'unchanged', at: 'DELIVERED' })
    expect(await eventCount()).toBe(afterFirst)
  })

  it('is IDEMPOTENT under a POD confirm replayed three times', async () => {
    await inOrg((tx) => markDelivered(tx, loadId, userId))
    const first = await inOrg((tx) => podConfirmed(tx, loadId, userId))
    expect(first).toMatchObject({ result: 'moved', to: 'POD_RECEIVED' })

    const before = await eventCount()
    for (let replay = 0; replay < 3; replay++) {
      expect(await inOrg((tx) => podConfirmed(tx, loadId, userId))).toEqual({
        result: 'unchanged',
        at: 'POD_RECEIVED',
      })
    }
    expect(await eventCount()).toBe(before)
    expect(await statusOf()).toBe('POD_RECEIVED')
  })

  it('is ORDER-TOLERANT: a POD that lands before Delivered still wins', async () => {
    // The real sequence this protects against: a driver marks Delivered on
    // their phone while a POD photo uploaded ten minutes earlier is still
    // being confirmed, and the confirm lands first.
    const podFirst = await inOrg((tx) => podConfirmed(tx, loadId, userId))
    expect(podFirst).toMatchObject({ result: 'moved', to: 'POD_RECEIVED' })

    const lateDelivered = await inOrg((tx) => markDelivered(tx, loadId, userId))
    expect(lateDelivered).toEqual({
      result: 'stale',
      at: 'POD_RECEIVED',
      attempted: 'DELIVERED',
    })

    // The load did NOT go backwards. A late Delivered must never undo a POD
    // that already landed.
    expect(await statusOf()).toBe('POD_RECEIVED')
  })

  it('refuses a backwards move without an explicit rewind, and allows it with one', async () => {
    await inOrg((tx) => markDelivered(tx, loadId, userId))

    expect(
      await inOrg((tx) =>
        transitionOperational(tx, loadId, 'BOOKED', { source: 'MANUAL' }),
      ),
    ).toMatchObject({ result: 'stale' })
    expect(await statusOf()).toBe('DELIVERED')

    // The pairing. `allowRewind` is what unassignment uses, and it is the only
    // thing that moves a load down the ladder.
    expect(
      await inOrg((tx) =>
        transitionOperational(tx, loadId, 'BOOKED', {
          source: 'MANUAL',
          allowRewind: true,
        }),
      ),
    ).toMatchObject({ result: 'moved', to: 'BOOKED' })
    expect(await statusOf()).toBe('BOOKED')
  })

  it('records MANUAL and AUTOMATIC on the right events', async () => {
    // §13: "Status timeline shows correct source per event."
    const { truckId, driverId } = await equipment('source')
    await inOrg((tx) => updateLoad(tx, loadId, { truckId, driverId }))
    await inOrg((tx) => markDelivered(tx, loadId, userId))
    await inOrg((tx) => podConfirmed(tx, loadId, userId))

    const events = await inOrg((tx) =>
      tx.loadStatusEvent.findMany({
        where: { loadId },
        orderBy: { occurredAt: 'asc' },
        select: { toStatus: true, source: true },
      }),
    )
    expect(events).toEqual([
      { toStatus: 'BOOKED', source: 'MANUAL' },
      { toStatus: 'DISPATCHED', source: 'AUTOMATIC' },
      { toStatus: 'DELIVERED', source: 'MANUAL' },
      { toStatus: 'POD_RECEIVED', source: 'AUTOMATIC' },
    ])
  })

  it('will not advance a cancelled load', async () => {
    await inOrg((tx) =>
      cancelLoad(tx, loadId, 'Broker cancelled', { byUserId: userId }),
    )
    expect(
      await inOrg((tx) => markDelivered(tx, loadId, userId)),
    ).toMatchObject({ result: 'cancelled' })

    // ...and does again once uncancelled. Cancelled is a flag, not a rung.
    await inOrg((tx) => uncancelLoad(tx, loadId, { byUserId: userId }))
    expect(
      await inOrg((tx) => markDelivered(tx, loadId, userId)),
    ).toMatchObject({ result: 'moved', to: 'DELIVERED' })
  })
})

describe('cancelling', () => {
  it('never deletes, keeps the operational status, and is idempotent', async () => {
    const load = await inOrg((tx) =>
      createLoad(tx, organizationId, {
        companyId: alphaId,
        customerId: brokerId,
        stops: stops(day(20), day(22)),
      }),
    )
    const { truckId, driverId } = await equipment('cancel')
    await inOrg((tx) => updateLoad(tx, load.id, { truckId, driverId }))

    const cancelled = await inOrg((tx) =>
      cancelLoad(tx, load.id, 'Broker cancelled the load', {
        byUserId: userId,
      }),
    )
    expect(cancelled.isCancelled).toBe(true)
    expect(cancelled.cancelReason).toBe('Broker cancelled the load')
    // The load was dispatched and it stays dispatched. A truck really was out.
    expect(cancelled.operationalStatus).toBe('DISPATCHED')

    const events = await inOrg((tx) =>
      tx.loadStatusEvent.count({ where: { loadId: load.id } }),
    )
    const again = await inOrg((tx) =>
      cancelLoad(tx, load.id, 'A different reason', { byUserId: userId }),
    )
    expect(again.cancelReason).toBe('Broker cancelled the load')
    expect(
      await inOrg((tx) =>
        tx.loadStatusEvent.count({ where: { loadId: load.id } }),
      ),
    ).toBe(events)
  })

  it('refuses a cancellation with no reason, and accepts one with a reason', async () => {
    const load = await inOrg((tx) =>
      createLoad(tx, organizationId, {
        companyId: alphaId,
        customerId: brokerId,
        stops: stops(day(20), day(22)),
      }),
    )
    await expect(
      inOrg((tx) => cancelLoad(tx, load.id, '   ')),
    ).rejects.toMatchObject({ code: 'required', field: 'cancelReason' })

    const ok = await inOrg((tx) => cancelLoad(tx, load.id, 'Rate fell through'))
    expect(ok.isCancelled).toBe(true)
  })
})

describe('dispatch conflict rules (§8)', () => {
  it('refuses a truck already on an overlapping load, naming the load number', async () => {
    const { truckId, driverId } = await equipment('overlap')

    const first = await inOrg((tx) =>
      createLoad(tx, organizationId, {
        companyId: alphaId,
        customerId: brokerId,
        truckId,
        driverId,
        stops: stops(day(1), day(4)),
      }),
    )

    const failure = await inOrg((tx) =>
      createLoad(tx, organizationId, {
        companyId: alphaId,
        customerId: brokerId,
        truckId,
        driverId,
        stops: stops(day(3), day(6)),
      }).catch((error: unknown) => error),
    )

    expect(failure).toBeInstanceOf(DispatchConflictError)
    const conflicts = (failure as DispatchConflictError).conflicts
    expect(conflicts.some((c) => c.kind === 'overlapping_load')).toBe(true)
    // §10's own example of a good error: it names the load.
    expect(
      conflicts.find((c) => c.kind === 'overlapping_load')?.values.loadNumber,
    ).toBe(first.loadNumber)

    // The pairing: dates that do NOT overlap are accepted, same truck, same
    // driver, same everything else.
    const ok = await inOrg((tx) =>
      createLoad(tx, organizationId, {
        companyId: alphaId,
        customerId: brokerId,
        truckId,
        driverId,
        stops: stops(day(20), day(22)),
      }),
    )
    expect(ok.truckId).toBe(truckId)
  })

  it('does not treat a finished load as a conflict', async () => {
    const { truckId, driverId } = await equipment('finished')
    const first = await inOrg((tx) =>
      createLoad(tx, organizationId, {
        companyId: alphaId,
        customerId: brokerId,
        truckId,
        driverId,
        stops: stops(day(1), day(4)),
      }),
    )
    await inOrg((tx) => markDelivered(tx, first.id, userId))
    await inOrg((tx) => podConfirmed(tx, first.id, userId))

    // Same dates. The truck is free because the load is done.
    const second = await inOrg((tx) =>
      createLoad(tx, organizationId, {
        companyId: alphaId,
        customerId: brokerId,
        truckId,
        driverId,
        stops: stops(day(2), day(5)),
      }),
    )
    expect(second.truckId).toBe(truckId)
  })

  it('refuses an asset working under another authority, and offers the transfer', async () => {
    const { truckId, driverId } = await equipment('auth')
    await inOrg((tx) =>
      transferAsset(tx, organizationId, 'truck', truckId, bravoId),
    )

    const failure = await inOrg((tx) =>
      createLoad(tx, organizationId, {
        companyId: alphaId,
        customerId: brokerId,
        truckId,
        driverId,
        stops: stops(day(1), day(3)),
      }).catch((error: unknown) => error),
    )

    const conflicts = (failure as DispatchConflictError).conflicts
    const other = conflicts.find((c) => c.kind === 'other_authority')
    expect(other).toBeDefined()
    // "offer the transfer flow, never silently move the asset" — so the
    // refusal carries what the transfer would need.
    expect(other?.transfer).toMatchObject({
      assetId: truckId,
      fromCompanyId: bravoId,
      toCompanyId: alphaId,
    })

    // The pairing: book it under the authority it actually works for.
    const ok = await inOrg((tx) =>
      createLoad(tx, organizationId, {
        companyId: bravoId,
        customerId: brokerId,
        truckId,
        stops: stops(day(1), day(3)),
      }),
    )
    expect(ok.companyId).toBe(bravoId)
  })

  it('refuses an out-of-service truck, and accepts it once available', async () => {
    const { truckId } = await equipment('oos')
    await inOrg((tx) =>
      tx.truck.update({
        where: { id: truckId },
        data: { status: 'OUT_OF_SERVICE' },
      }),
    )

    const failure = await inOrg((tx) =>
      createLoad(tx, organizationId, {
        companyId: alphaId,
        customerId: brokerId,
        truckId,
        stops: stops(day(1), day(3)),
      }).catch((error: unknown) => error),
    )
    expect(
      (failure as DispatchConflictError).conflicts.some(
        (c) => c.kind === 'out_of_service',
      ),
    ).toBe(true)

    await inOrg((tx) =>
      tx.truck.update({
        where: { id: truckId },
        data: { status: 'AVAILABLE' },
      }),
    )
    const ok = await inOrg((tx) =>
      createLoad(tx, organizationId, {
        companyId: alphaId,
        customerId: brokerId,
        truckId,
        stops: stops(day(1), day(3)),
      }),
    )
    expect(ok.truckId).toBe(truckId)
  })

  it('reports every conflict at once, not the first', async () => {
    // A dispatcher fixing one problem to be told about the next is the
    // interaction §10 exists to prevent.
    const { truckId, driverId } = await equipment('many')
    await inOrg((tx) =>
      transferAsset(tx, organizationId, 'truck', truckId, bravoId),
    )
    await inOrg((tx) =>
      tx.truck.update({
        where: { id: truckId },
        data: { status: 'OUT_OF_SERVICE' },
      }),
    )

    const failure = await inOrg((tx) =>
      createLoad(tx, organizationId, {
        companyId: alphaId,
        customerId: brokerId,
        truckId,
        driverId,
        stops: stops(day(1), day(3)),
      }).catch((error: unknown) => error),
    )
    const kinds = (failure as DispatchConflictError).conflicts.map(
      (c) => c.kind,
    )
    expect(kinds).toContain('other_authority')
    expect(kinds).toContain('out_of_service')
  })
})
