import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { LOAD_WRITE_TIMEOUT_MS, loadSearchWhere } from '@/lib/loads'
import { ensureRelayCustomer } from '@/lib/relay-import'
import { planTrips } from '@/lib/trips-import'
import { tripRateJoin } from '@/lib/inbound-email'
import {
  createTripLoad,
  enrichLoad,
  planTripWrite,
  resolveFacilities,
  tripFacilityCodes,
} from '@/lib/trips-writer'
import type { TripLeg } from '@/lib/trips-csv'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE TRIPS IMPORT, AGAINST REAL POSTGRES — AND SPECIFICALLY: DOES THE STOP
// LAND WITH WHAT IT WAS GIVEN?
//
// This file exists because of a key that was silently discarded. The create
// path mapped `stopRowsForTrip`'s output by hand into `createLoad`'s stop
// shape and wrote `place` where the contract says `name`. TypeScript does not
// excess-property-check a literal returned from a `.map()` callback, so it
// compiled; `npm run check` was green; 405 integration tests passed. Every
// stop a trips import wrote would have had no name, no city and no state —
// blank on the list AND blank on the detail — and the same hand-mapping
// dropped `legMiles` and `legEmpty`, which is the reason those columns exist.
//
// SO THE ASSERTIONS HERE READ THE ROW BACK. Not "createTripLoad returned
// created", which was true the whole time it was broken, but the value in the
// column, fetched after the write. A mapping bug is invisible to every check
// that does not look at the far side of it.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let companyId = ''
let userId = ''
const nonce = Math.random().toString(36).slice(2, 8)

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'trips-import.test' },
    maxWaitMs: 20_000,
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
  })

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)
  const organization = await owner.organization.create({
    data: { name: `Trips ${nonce}`, slug: `trips-${nonce}` },
  })
  organizationId = organization.id
  const company = await owner.company.create({
    data: { organizationId, name: `Trips Carrier ${nonce}` },
  })
  companyId = company.id
  const user = await owner.user.create({
    data: { email: `trips-${nonce}@example.test`, name: 'Trips Tester' },
  })
  userId = user.id
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

const clock = (date: string, time: string) => ({
  date,
  time,
  utcOffsetHours: -6,
})

const stop = (
  facilityCode: string,
  times: {
    plannedArrival?: ReturnType<typeof clock> | null
    plannedDeparture?: ReturnType<typeof clock> | null
    actualArrival?: ReturnType<typeof clock> | null
    actualDeparture?: ReturnType<typeof clock> | null
  } = {},
) => ({
  facilityCode,
  plannedArrival: times.plannedArrival ?? null,
  plannedDeparture: times.plannedDeparture ?? null,
  actualArrival: times.actualArrival ?? null,
  actualDeparture: times.actualDeparture ?? null,
})

const leg = (over: Partial<TripLeg> = {}): TripLeg => ({
  tripId: `T-TRIPS-${nonce}`,
  loadId: `L-${nonce}`,
  facilitySequence: 'DEN7->MKC6',
  status: 'Completed',
  distance: 583,
  costCents: null,
  distanceUnit: 'mi',
  shipperAccount: 'OutboundAmazonManaged',
  driverName: 'A DRIVER',
  trailerId: 'HV1',
  tractorId: 'ZP1',
  stops: [stop('DEN7'), stop('MKC6')],
  ...over,
})

/** Book one trip the way the action does, and hand back the row it wrote. */
async function importTrip(legs: TripLeg[], maySeeMoney = true) {
  const plan = planTrips(legs)
  const trip = plan.trips[0]!

  const outcome = await inOrg(async (tx) => {
    const customerId = (await ensureRelayCustomer(tx, organizationId)).id
    const facilities = await resolveFacilities(tx, tripFacilityCodes(trip))
    return createTripLoad(
      tx,
      organizationId,
      {
        trip,
        companyId,
        customerId,
        // The action passes null for a role without `load.financials`; the
        // tests drive both sides of that here.
        rateCents: maySeeMoney ? trip.rateCents : null,
      },
      facilities,
    )
  })

  const loadId = outcome.kind === 'created' ? outcome.loadId : ''
  const load = await inOrg((tx) =>
    tx.load.findFirstOrThrow({
      where: { id: loadId },
      include: { stops: { orderBy: { sequence: 'asc' } } },
    }),
  )
  return { trip, outcome, load }
}

describe('a booked trip lands with what it was given', () => {
  // THE ASSERTION THAT WAS MISSING. `place` instead of `name` wrote null here
  // and nothing anywhere said so.
  it('writes each stop with the facility code as its name', async () => {
    const { load } = await importTrip([leg()])

    expect(load.stops).toHaveLength(2)
    expect(load.stops.map((row) => row.name)).toEqual(['DEN7', 'MKC6'])
    // Named explicitly: null is the exact shape the bug produced, so the test
    // says so rather than only asserting the right value.
    for (const row of load.stops) expect(row.name).not.toBeNull()
  })

  it('types the first stop PICKUP and the last DELIVERY', async () => {
    const { load } = await importTrip([
      leg({ tripId: `T-TYPES-${nonce}`, loadId: `L-TYPES-${nonce}` }),
    ])
    expect(load.stops.map((row) => row.type)).toEqual(['PICKUP', 'DELIVERY'])
  })

  // THE OTHER HALF OF THE SAME BUG. `legMiles` and `legEmpty` are the whole
  // reason 20260817225524_load_stop_leg_miles exists, and the hand-mapping
  // never passed them — `createLoad` had no such fields to pass them to.
  it('carries the arriving leg onto the stop it arrived at', async () => {
    const { load } = await importTrip([
      leg({ tripId: `T-LEGS-${nonce}`, loadId: `L-LEGS-${nonce}` }),
    ])

    // The first stop is where the trip began; nothing arrived at it.
    expect(load.stops[0]!.legMiles).toBeNull()
    expect(load.stops[1]!.legMiles).toBe(583)
    expect(load.stops[1]!.legEmpty).toBe(false)
  })

  it('records the trip id as the reference and the miles on the load', async () => {
    const { trip, load } = await importTrip([
      leg({ tripId: `T-REF-${nonce}`, loadId: `L-REF-${nonce}` }),
    ])
    expect(load.referenceNumber).toBe(trip.tripId)
    expect(load.dispatchedMiles).toBe(583)
  })

  // ------------------------------------------------------------------------
  // RULE 6 AS RULED ON 2026-08-20, READ BACK FROM THE COLUMN — both
  // directions, because one of them without the other is not a partition.
  // ------------------------------------------------------------------------

  // A SINGLE-LOAD TRIP LANDS WITH ITS RATE. Trip 1165YNVHN read $5,089.07 in
  // the Relay portal and this column matched it exactly.
  it('books a single-load trip with its rate', async () => {
    const id = `SINGLE-${nonce}`
    const { load } = await importTrip([
      leg({ tripId: id, loadId: id, costCents: 508907 }),
    ])
    expect(load.linehaulCents).toBe(508907)
    // The cached total is what an invoice reads; a linehaul written without it
    // would be right on the load and wrong on the bill.
    expect(load.totalRevenueCents).toBe(508907)
  })

  // A MULTI-LEG TRIP LANDS WITH NONE, whatever its Load IDs say. No trip in
  // today's corpus has this shape — 815 multi-leg trips, none with a leg whose
  // Load ID equals the Trip ID — so it is constructed here on purpose. That is
  // the point: the rule must hold for the shape the data has not shown yet,
  // because the equality alone would price it out of an allocation.
  it('books a multi-leg trip with no rate even when every leg matches', async () => {
    const id = `MULTI-${nonce}`
    const { load } = await importTrip([
      leg({
        tripId: id,
        loadId: id,
        costCents: 180000,
        facilitySequence: 'DEN7->MKC6',
        stops: [stop('DEN7'), stop('MKC6')],
      }),
      leg({
        tripId: id,
        loadId: id,
        costCents: 45000,
        facilitySequence: 'MKC6->ORD5',
        stops: [stop('MKC6'), stop('ORD5')],
      }),
    ])
    expect(load.linehaulCents).toBe(0)
    expect(load.totalRevenueCents).toBe(0)
  })

  // §1.3'S MONEY WALL. A role that may not see money does not write it, so the
  // freight books and the rate waits for somebody who may enter one.
  it('books no rate for an importer who may not see money', async () => {
    const id = `NOMONEY-${nonce}`
    const { load } = await importTrip(
      [leg({ tripId: id, loadId: id, costCents: 508907 })],
      false,
    )
    expect(load.linehaulCents).toBe(0)
  })

  // RULE 7, likewise. The CSV names a driver and two units; none of them may
  // reach the load.
  it('assigns no driver and no equipment', async () => {
    const { load } = await importTrip([
      leg({ tripId: `T-ASSIGN-${nonce}`, loadId: `L-ASSIGN-${nonce}` }),
    ])
    expect(load.driverId).toBeNull()
    expect(load.truckId).toBeNull()
    expect(load.trailerId).toBeNull()
  })
})

describe('enrichment adds a missing rate and replaces nothing', () => {
  const bookEmailLoad = async (tripId: string, linehaulCents: number) => {
    const customerId = await inOrg(
      async (tx) => (await ensureRelayCustomer(tx, organizationId)).id,
    )
    return owner.load.create({
      data: {
        organizationId,
        companyId,
        customerId,
        loadNumber: `R-${tripId}`,
        referenceNumber: tripId,
        linehaulCents,
      },
      select: { id: true },
    })
  }

  const enrich = async (tripId: string, costCents: number) => {
    const trip = planTrips([leg({ tripId, loadId: tripId, costCents })])
      .trips[0]!
    return inOrg(async (tx) => {
      const write = await planTripWrite(tx, trip)
      if (write.action !== 'enrich') throw new Error('expected enrich')
      const facilities = await resolveFacilities(tx, tripFacilityCodes(trip))
      await enrichLoad(
        tx,
        organizationId,
        write.loadId,
        trip,
        facilities,
        {
          hasStops: write.hasStops,
          hasMiles: write.hasMiles,
          hasRate: write.hasRate,
          hasActuals: write.hasActuals,
          isDelivered: write.isDelivered,
          isCancelled: write.isCancelled,
        },
        trip.rateCents,
      )
      return tx.load.findFirstOrThrow({
        where: { id: write.loadId },
        select: { linehaulCents: true, totalRevenueCents: true },
      })
    })
  }

  // The booking email made the load and carried no money — zero is the schema
  // default, which is why `hasRate` treats it as absence.
  it('fills a rate the email never carried', async () => {
    const id = `ENRICH-NONE-${nonce}`
    await bookEmailLoad(id, 0)
    const after = await enrich(id, 508907)
    expect(after.linehaulCents).toBe(508907)
    expect(after.totalRevenueCents).toBe(508907)
  })

  // THE HALF THAT MATTERS. The email is the contract; this import is a
  // courier, and a courier does not rewrite the price.
  it('leaves a rate the email already carried', async () => {
    const id = `ENRICH-KEEP-${nonce}`
    await bookEmailLoad(id, 177600)
    const after = await enrich(id, 508907)
    expect(after.linehaulCents).toBe(177600)
  })
})

describe('a trip whose load already exists is enriched, not doubled', () => {
  it('adds stops and miles to the load the email made, keeping one load', async () => {
    const tripId = `T-ENRICH-${nonce}`
    const legs = [leg({ tripId, loadId: `L-ENRICH-${nonce}` })]
    const trip = planTrips(legs).trips[0]!

    // The booking email's load: a reference and nothing else this import adds.
    const customerId = await inOrg(
      async (tx) => (await ensureRelayCustomer(tx, organizationId)).id,
    )
    const existing = await owner.load.create({
      data: {
        organizationId,
        companyId,
        customerId,
        loadNumber: `E-${nonce}`,
        referenceNumber: tripId,
      },
      select: { id: true },
    })

    const outcome = await inOrg(async (tx) => {
      const write = await planTripWrite(tx, trip)
      // Narrowed rather than asserted-then-indexed: `hasRate` only exists on
      // the enrich arm, and TypeScript is right to insist.
      if (write.action !== 'enrich') throw new Error('expected enrich')
      const facilities = await resolveFacilities(tx, tripFacilityCodes(trip))
      return enrichLoad(
        tx,
        organizationId,
        existing.id,
        trip,
        facilities,
        {
          hasStops: false,
          hasMiles: false,
          hasRate: write.hasRate,
          hasActuals: write.hasActuals,
          isDelivered: write.isDelivered,
          isCancelled: write.isCancelled,
        },
        trip.rateCents,
      )
    })

    expect(outcome.kind).toBe('enriched')

    const loads = await inOrg((tx) =>
      tx.load.findMany({
        where: { referenceNumber: tripId, deletedAt: null },
        include: { stops: { orderBy: { sequence: 'asc' } } },
      }),
    )

    expect(loads).toHaveLength(1)
    expect(loads[0]!.id).toBe(existing.id)
    // The enrich path spreads the row whole and always did carry the name;
    // asserted anyway, so the two paths are held to one standard.
    expect(loads[0]!.stops.map((row) => row.name)).toEqual(['DEN7', 'MKC6'])
    expect(loads[0]!.stops[1]!.legMiles).toBe(583)
  })
})

describe('every field family survives the write', () => {
  // ------------------------------------------------------------------------
  // THE CREATE PATH SPREADS THE ROW NOW, so no field can be forgotten by
  // restatement — that shape lost `place`/`name`, then `legMiles`/`legEmpty`,
  // then all four clocks, in the same handful of lines.
  //
  // TYPES CANNOT REPLACE THIS TEST. A spread that stops PRODUCING a field is
  // invisible to the compiler: the row simply has one fewer key and everything
  // still fits. Only reading the column back can see it. One assertion per
  // family, so a future narrowing shows up as a null somewhere specific rather
  // than as a vague failure.
  // ------------------------------------------------------------------------
  it('lands identity, location, leg and clock fields together', async () => {
    const id = `FAMILY-${nonce}`
    const { load } = await importTrip([
      leg({
        tripId: id,
        loadId: 'LEG-LOAD-1',
        distance: 583,
        stops: [
          stop('DEN7', { plannedArrival: clock('2026-08-24', '04:41') }),
          stop('MKC6', {
            plannedArrival: clock('2026-08-24', '06:32'),
            actualArrival: clock('2026-08-24', '08:08'),
            actualDeparture: clock('2026-08-24', '08:41'),
          }),
        ],
      }),
    ])

    const [first, second] = load.stops

    // IDENTITY — the family `place` instead of `name` emptied.
    expect(first!.name).toBe('DEN7')
    expect(second!.name).toBe('MKC6')

    // TYPE — position is the only evidence this export offers.
    expect(first!.type).toBe('PICKUP')
    expect(second!.type).toBe('DELIVERY')

    // REFERENCE — the arriving leg's own Load ID, on the stop it arrived at.
    expect(second!.referenceNumber).toBe('LEG-LOAD-1')

    // LEG — the family the hand-mapping dropped second.
    expect(second!.legMiles).toBe(583)
    expect(second!.legEmpty).toBe(false)

    // CLOCKS — the family it dropped third.
    expect(first!.scheduledAt).not.toBeNull()
    expect(second!.scheduledAt).not.toBeNull()
    expect(second!.arrivedAt).not.toBeNull()
    expect(second!.departedAt).not.toBeNull()
  })
})

describe('the clocks a trip lands with', () => {
  // ------------------------------------------------------------------------
  // THE TRIPS WRITER USED TO DISCARD EVERY TIME IT PARSED. Planned and actual,
  // arrival and departure — all four read by the parser, carried by the
  // planner, and dropped on the floor by the writer, so an imported load had
  // no times of any kind. These read the columns back.
  // ------------------------------------------------------------------------

  it('lands a FINISHED trip with its actual check-in and departure', async () => {
    const id = `ACT-${nonce}`
    const { load } = await importTrip([
      leg({
        tripId: id,
        loadId: id,
        stops: [
          stop('DEN7', {
            plannedArrival: clock('2026-08-24', '04:41'),
            actualArrival: clock('2026-08-24', '07:17'),
            actualDeparture: clock('2026-08-24', '07:52'),
          }),
          stop('MKC6', {
            plannedArrival: clock('2026-08-24', '06:32'),
            actualArrival: clock('2026-08-24', '08:08'),
          }),
        ],
      }),
    ])

    expect(load.stops[0]!.arrivedAt).not.toBeNull()
    expect(load.stops[0]!.departedAt).not.toBeNull()
    // THE PLAN IS KEPT, NOT REPLACED. It is the reference the screen shows
    // beneath the record, and the settlement marks when it has to fall back.
    expect(load.stops[0]!.scheduledAt).not.toBeNull()
    expect(load.stops[0]!.arrivedAt!.getTime()).toBeGreaterThan(
      load.stops[0]!.scheduledAt!.getTime(),
    )
    expect(load.stops[1]!.arrivedAt).not.toBeNull()
  })

  // A trip still running: Relay prints the plan and no check-in.
  it('lands a BOOKED trip with the plan and no actuals', async () => {
    const id = `PLAN-${nonce}`
    const { load } = await importTrip([
      leg({
        tripId: id,
        loadId: id,
        stops: [
          stop('DEN7', { plannedArrival: clock('2026-08-24', '04:41') }),
          stop('MKC6', { plannedArrival: clock('2026-08-24', '06:32') }),
        ],
      }),
    ])

    expect(load.stops[0]!.scheduledAt).not.toBeNull()
    expect(load.stops[0]!.arrivedAt).toBeNull()
    expect(load.stops[0]!.departedAt).toBeNull()
  })

  // A REAL SHAPE: the driver checked into the first dock and not the second.
  // The second stop must keep its plan and stay distinguishable from a record.
  it('lands a half-finished trip without inventing the missing actual', async () => {
    const id = `HALF-${nonce}`
    const { load } = await importTrip([
      leg({
        tripId: id,
        loadId: id,
        stops: [
          stop('DEN7', {
            plannedArrival: clock('2026-08-24', '04:41'),
            actualArrival: clock('2026-08-24', '07:17'),
          }),
          stop('MKC6', { plannedArrival: clock('2026-08-24', '06:32') }),
        ],
      }),
    ])

    expect(load.stops[0]!.arrivedAt).not.toBeNull()
    expect(load.stops[1]!.arrivedAt).toBeNull()
    expect(load.stops[1]!.scheduledAt).not.toBeNull()
  })

  // FLAG 14. The printed face is read in the stop's zone, so 04:41 at a
  // Central dock is 09:41Z — not 04:41Z, and not shifted by the standard
  // offset column, which disagrees with the clock for half the year.
  it('reads a printed clock in the zone, not as UTC', async () => {
    const id = `ZONE-${nonce}`
    const { load } = await importTrip([
      leg({
        tripId: id,
        loadId: id,
        stops: [
          stop('DEN7', { plannedArrival: clock('2026-08-24', '04:41') }),
          stop('MKC6', { plannedArrival: clock('2026-08-24', '06:32') }),
        ],
      }),
    ])

    const iso = load.stops[0]!.scheduledAt!.toISOString()
    expect(iso).not.toContain('T04:41')
    expect(iso).toContain('2026-08-24')
  })
})

describe('booked first, then it runs — the normal lifecycle', () => {
  // ------------------------------------------------------------------------
  // FOUND IN LIVE USE, load 1010 / T-115GY4TBD. Dispatch imported the trip
  // from an UPCOMING export to get it on the board: four stops, plan times,
  // Booked. The trip then ran, and re-importing the SAME trip from a COMPLETED
  // export counted it "1 already complete" and wrote nothing — because the
  // load already had stops and mileage, which was the whole of the question
  // being asked. The actual check-ins could never reach a load that had been
  // booked first, which is the ordinary order of events.
  // ------------------------------------------------------------------------
  const upcoming = (id: string) =>
    leg({
      tripId: id,
      loadId: id,
      status: 'Not Started',
      stops: [
        stop('DEN7', { plannedArrival: clock('2026-08-24', '04:41') }),
        stop('MKC6', { plannedArrival: clock('2026-08-24', '06:32') }),
      ],
    })

  const finished = (id: string) =>
    leg({
      tripId: id,
      loadId: id,
      status: 'Completed',
      stops: [
        stop('DEN7', {
          plannedArrival: clock('2026-08-24', '04:41'),
          actualArrival: clock('2026-08-24', '07:17'),
          actualDeparture: clock('2026-08-24', '07:52'),
        }),
        stop('MKC6', {
          plannedArrival: clock('2026-08-24', '06:32'),
          actualArrival: clock('2026-08-24', '08:08'),
        }),
      ],
    })

  /** Re-import a trip onto the load that already carries its reference. */
  const reimport = async (legs: TripLeg[]) => {
    const trip = planTrips(legs).trips[0]!
    return inOrg(async (tx) => {
      const write = await planTripWrite(tx, trip)
      if (write.action !== 'enrich') throw new Error('expected enrich')
      const facilities = await resolveFacilities(tx, tripFacilityCodes(trip))
      const outcome = await enrichLoad(
        tx,
        organizationId,
        write.loadId,
        trip,
        facilities,
        {
          hasStops: write.hasStops,
          hasMiles: write.hasMiles,
          hasRate: write.hasRate,
          hasActuals: write.hasActuals,
          isDelivered: write.isDelivered,
          isCancelled: write.isCancelled,
        },
        null,
        userId,
      )
      const load = await tx.load.findFirstOrThrow({
        where: { id: write.loadId },
        include: { stops: { orderBy: { sequence: 'asc' } } },
      })
      return { outcome, load }
    })
  }

  it('books from an Upcoming export with the plan and no actuals', async () => {
    const id = `LIFE-A-${nonce}`
    const { load } = await importTrip([upcoming(id)])

    expect(load.operationalStatus).toBe('BOOKED')
    expect(load.stops[0]!.scheduledAt).not.toBeNull()
    expect(load.stops.every((row) => row.arrivedAt === null)).toBe(true)
  })

  // THE BUG, ASSERTED. This is the re-import that used to write nothing.
  it('takes the actuals on a Finished re-import and delivers the load', async () => {
    const id = `LIFE-B-${nonce}`
    await importTrip([upcoming(id)])

    const { outcome, load } = await reimport([finished(id)])

    expect(outcome.kind).toBe('enriched')
    expect(load.stops[0]!.arrivedAt).not.toBeNull()
    expect(load.stops[0]!.departedAt).not.toBeNull()
    expect(load.stops[1]!.arrivedAt).not.toBeNull()
    // PAST DELIVERED. See the first-import test for why this is the payable
    // state and not an overshoot.
    expect(load.operationalStatus).toBe('POD_RECEIVED')
  })

  it('keeps the plan alongside the actual it just gained', async () => {
    const id = `LIFE-C-${nonce}`
    await importTrip([upcoming(id)])
    const { load } = await reimport([finished(id)])

    const first = load.stops[0]!
    expect(first.scheduledAt).not.toBeNull()
    expect(first.arrivedAt!.getTime()).toBeGreaterThan(
      first.scheduledAt!.getTime(),
    )
  })

  // ADDS WHAT IS MISSING, REPLACES NOTHING — the promise the rest of this
  // function makes, extended to times. A stop somebody corrected by hand, or
  // one a previous Finished import already filled, is left exactly as it is.
  it('never overwrites a check-in that is already there', async () => {
    const id = `LIFE-D-${nonce}`
    await importTrip([upcoming(id)])
    const { load: firstPass } = await reimport([finished(id)])
    const original = firstPass.stops[0]!.arrivedAt!

    // A different Completed export for the same trip, an hour later.
    const later = leg({
      tripId: id,
      loadId: id,
      status: 'Completed',
      stops: [
        stop('DEN7', {
          plannedArrival: clock('2026-08-24', '04:41'),
          actualArrival: clock('2026-08-24', '09:17'),
        }),
        stop('MKC6', { plannedArrival: clock('2026-08-24', '06:32') }),
      ],
    })
    const trip = planTrips([later]).trips[0]!
    const after = await inOrg(async (tx) => {
      const write = await planTripWrite(tx, trip)
      if (write.action !== 'enrich') throw new Error('expected enrich')
      const facilities = await resolveFacilities(tx, tripFacilityCodes(trip))
      await enrichLoad(
        tx,
        organizationId,
        write.loadId,
        trip,
        facilities,
        {
          hasStops: write.hasStops,
          hasMiles: write.hasMiles,
          hasRate: write.hasRate,
          hasActuals: write.hasActuals,
          isDelivered: write.isDelivered,
          isCancelled: write.isCancelled,
        },
        null,
        userId,
      )
      return tx.load.findFirstOrThrow({
        where: { id: write.loadId },
        include: { stops: { orderBy: { sequence: 'asc' } } },
      })
    })

    expect(after.stops[0]!.arrivedAt!.toISOString()).toBe(
      original.toISOString(),
    )
  })

  // A TRIP STILL RUNNING IS NOT A DELIVERED LOAD. `In Progress` carries
  // check-ins for the stops already made and must not move the load.
  it('does not deliver a load whose trip is still in progress', async () => {
    const id = `LIFE-E-${nonce}`
    await importTrip([upcoming(id)])

    const running = leg({
      tripId: id,
      loadId: id,
      status: 'In Progress',
      stops: [
        stop('DEN7', {
          plannedArrival: clock('2026-08-24', '04:41'),
          actualArrival: clock('2026-08-24', '07:17'),
        }),
        stop('MKC6', { plannedArrival: clock('2026-08-24', '06:32') }),
      ],
    })
    const { outcome, load } = await reimport([running])

    // The actuals it does have are still worth taking.
    expect(outcome.kind).toBe('enriched')
    expect(load.stops[0]!.arrivedAt).not.toBeNull()
    expect(load.operationalStatus).toBe('BOOKED')
  })

  // AND THE THIRD IMPORT REALLY IS NOTHING. Idempotence is what makes
  // re-importing a downloads folder safe.
  it('reports unchanged when the same Finished file is imported twice', async () => {
    const id = `LIFE-F-${nonce}`
    await importTrip([upcoming(id)])
    await reimport([finished(id)])
    const { outcome } = await reimport([finished(id)])

    expect(outcome.kind).toBe('unchanged')
  })
})

describe('the email–trip join, in both orders', () => {
  // ------------------------------------------------------------------------
  // THE TWO AMAZON SOURCES ARE COMPLEMENTARY ON ONE KEY. The Trips CSV has the
  // stop chain, the legs, the miles and the actuals and never the payout; the
  // booking email has the payout and the same Trip ID.
  //
  // ORDER-INDEPENDENT, and that is the half worth testing hardest. Dispatch
  // may forward the email before the trip is exported or after it, and both
  // must end with ONE load carrying the full stop chain and the right rate.
  // Real figures throughout: T-113X2YMG9 printed $1,776.25 as Estimated
  // Payout beside a $1,466.53 Base Rate.
  // ------------------------------------------------------------------------
  const PAYOUT_CENTS = 177625

  const bookingEmail = (reference: string, payout = '$1776.25') =>
    ({
      brokerName: { value: 'Amazon Relay', confidence: 'high' },
      brokerReference: { value: reference, confidence: 'high' },
      money: {
        // BASE RATE IS PRESENT AND MUST NOT BE READ. It is 21% lower; taking
        // it would under-invoice every Relay load in exactly the way nothing
        // downstream would notice.
        linehaul: { value: '$1466.53', confidence: 'high' },
        total: { value: payout, confidence: 'high' },
      },
    }) as never

  const tripCsv = (id: string) =>
    leg({
      tripId: id,
      loadId: id,
      status: 'Completed',
      stops: [
        stop('DEN7', { plannedArrival: clock('2026-08-24', '04:41') }),
        stop('MKC6', { plannedArrival: clock('2026-08-24', '06:32') }),
      ],
    })

  const verdictFor = (extracted: unknown) =>
    inOrg((tx) => tripRateJoin(tx, extracted as never))

  it('waits when the trip has not been imported yet, and says which', async () => {
    const id = `T-WAIT-${nonce}`
    const verdict = await verdictFor(bookingEmail(id))

    expect(verdict.kind).toBe('waiting')
    if (verdict.kind !== 'waiting') return
    // The reference is named so the screen can say what it is waiting for.
    expect(verdict.reference).toBe(id)
  })

  // CSV FIRST, THEN THE EMAIL — the ordinary order once dispatch is importing
  // trips regularly.
  it('fills the rate when the trip landed first', async () => {
    const id = `T-CSVFIRST-${nonce}`
    const { load } = await importTrip([tripCsv(id)])
    expect(load.linehaulCents).toBe(0)

    const verdict = await verdictFor(bookingEmail(id))
    expect(verdict.kind).toBe('fillable')
    if (verdict.kind !== 'fillable') return
    expect(verdict.cents).toBe(PAYOUT_CENTS)
    expect(verdict.loadId).toBe(load.id)
  })

  // EMAIL FIRST, THEN THE CSV — the email waits, the import books the load
  // with its full chain, and the same email then fills the rate. One load.
  it('ends the other order in the same place', async () => {
    const id = `T-EMAILFIRST-${nonce}`

    const before = await verdictFor(bookingEmail(id))
    expect(before.kind).toBe('waiting')

    const { load } = await importTrip([tripCsv(id)])
    const after = await verdictFor(bookingEmail(id))

    expect(after.kind).toBe('fillable')
    if (after.kind !== 'fillable') return
    expect(after.loadId).toBe(load.id)
    expect(after.cents).toBe(PAYOUT_CENTS)

    // ONE LOAD, WITH THE CHAIN THE CSV KNOWS. The email never created
    // anything, which is the whole rule: a load booked from this email would
    // carry the two stops it prints instead.
    const all = await inOrg((tx) =>
      tx.load.findMany({
        where: { referenceNumber: id, deletedAt: null },
        include: { stops: true },
      }),
    )
    expect(all).toHaveLength(1)
    expect(all[0]!.stops).toHaveLength(2)
  })

  // ESTIMATED PAYOUT, NEVER BASE RATE. Both are in the payload above.
  it('takes the payout and not the base rate', async () => {
    const id = `T-PAYOUT-${nonce}`
    await importTrip([tripCsv(id)])
    const verdict = await verdictFor(bookingEmail(id))

    if (verdict.kind !== 'fillable') throw new Error('expected fillable')
    expect(verdict.cents).toBe(177625)
    expect(verdict.cents).not.toBe(146653)
  })

  // FILLS ONLY A NULL RATE. Whoever put a figure there — a typed correction,
  // an earlier single-leg import — keeps it.
  it('refuses a load that already carries money', async () => {
    const id = `T-RATED-${nonce}`
    const { load } = await importTrip([tripCsv(id)])
    await inOrg((tx) =>
      tx.load.update({
        where: { id: load.id },
        data: { linehaulCents: 999_00 },
      }),
    )

    const verdict = await verdictFor(bookingEmail(id))
    expect(verdict.kind).toBe('already_rated')
  })

  // EXACT MATCH — the JOIN rule, not the search rule. `loadSearchWhere`
  // deliberately matches loosely so a human can find a load by typing; money
  // is not attached on a resemblance.
  it('does not join a bare id to a prefixed load, or the reverse', async () => {
    const bare = `NOPREFIX-${nonce}`
    await importTrip([tripCsv(`T-${bare}`)])

    // A bare-ID email is not a trip email at all — it keeps the create flow.
    expect((await verdictFor(bookingEmail(bare))).kind).toBe('not_a_trip')

    // And a prefixed email finds nothing when only the bare load exists.
    const other = `OTHER-${nonce}`
    await importTrip([tripCsv(other)])
    expect((await verdictFor(bookingEmail(`T-${other}`))).kind).toBe('waiting')
  })

  it('says so when the trip is here but the email printed no payout', async () => {
    const id = `T-NOPAY-${nonce}`
    await importTrip([tripCsv(id)])
    const verdict = await verdictFor({
      brokerReference: { value: id, confidence: 'high' },
      money: { linehaul: { value: '$1466.53', confidence: 'high' } },
    })
    expect(verdict.kind).toBe('no_payout')
  })
})

describe('T-115GY4TBD, the real four-leg trip', () => {
  // ------------------------------------------------------------------------
  // LOAD 1010's OWN EXPORT, transcribed. Four legs, one of them CANCELLED and
  // dropped by rule 3, flattening to the four stops the load actually carries:
  //
  //   111JPJ8YR  Completed  MEM4 07:17 → HME9 08:08
  //   111YNGZP5  Completed  HME9 08:10 → WE_PAY_WMBAF_38113_NEX 09:20
  //   113R4R6KT  CANCELLED  MEM4 06:27 → WE_PAY_WMBAF_38113_NEX (none)
  //   1133KXTMH  Completed  WE_PAY_WMBAF_38113_NEX 09:20 → MDW2 18:59
  //
  // HME9 IS THE SHARED STOP, and the interesting one: it is the ARRIVING leg's
  // stop 2 at 08:08 and the DEPARTING leg's stop 1 at 08:10. One visit, two
  // rows. The arrival belongs to the leg that arrived.
  // ------------------------------------------------------------------------
  const WE_PAY = 'WE_PAY_WMBAF_38113_NEX'

  const fourLegs = (id: string) => [
    leg({
      tripId: id,
      loadId: '111JPJ8YR',
      status: 'Completed',
      facilitySequence: `MEM4->HME9`,
      stops: [
        stop('MEM4', {
          plannedArrival: clock('2026-08-31', '04:41'),
          actualArrival: clock('2026-08-31', '07:17'),
        }),
        stop('HME9', {
          plannedArrival: clock('2026-08-31', '06:32'),
          actualArrival: clock('2026-08-31', '08:08'),
        }),
      ],
    }),
    leg({
      tripId: id,
      loadId: '111YNGZP5',
      status: 'Completed',
      facilitySequence: `HME9->${WE_PAY}`,
      stops: [
        stop('HME9', { actualArrival: clock('2026-08-31', '08:10') }),
        stop(WE_PAY, {
          plannedArrival: clock('2026-08-31', '08:02'),
          actualArrival: clock('2026-08-31', '09:20'),
        }),
      ],
    }),
    // RULE 3: replanned, dropped whole, and its 06:27 must not reach anything.
    leg({
      tripId: id,
      loadId: '113R4R6KT',
      status: 'Cancelled',
      facilitySequence: `MEM4->${WE_PAY}`,
      stops: [
        stop('MEM4', { actualArrival: clock('2026-08-31', '06:27') }),
        stop(WE_PAY, {}),
      ],
    }),
    leg({
      tripId: id,
      loadId: '1133KXTMH',
      status: 'Completed',
      facilitySequence: `${WE_PAY}->MDW2`,
      stops: [
        stop(WE_PAY, { actualArrival: clock('2026-08-31', '09:20') }),
        stop('MDW2', {
          plannedArrival: clock('2026-09-01', '20:00'),
          actualArrival: clock('2026-08-31', '18:59'),
        }),
      ],
    }),
  ]

  const upcoming = (id: string) =>
    fourLegs(id).map((one) => ({
      ...one,
      status: one.status === 'Cancelled' ? 'Cancelled' : 'Not Started',
      stops: one.stops.map((s) => ({ ...s, actualArrival: null })),
    }))

  it('flattens four legs into the four stops the load carries', async () => {
    const id = `T-4LEG-${nonce}`
    const { load } = await importTrip(upcoming(id))
    expect(load.stops.map((row) => row.name)).toEqual([
      'MEM4',
      'HME9',
      WE_PAY,
      'MDW2',
    ])
  })

  // THE REPRODUCTION. Booked from an Upcoming export, then the Completed
  // export re-imported — the exact sequence load 1010 went through, minus the
  // cancellation. If the check-ins do not land here, cancellation was never
  // the cause.
  it('lands a check-in on every stop when the finished export arrives', async () => {
    const id = `T-4LEGACT-${nonce}`
    await importTrip(upcoming(id))

    const trip = planTrips(fourLegs(id)).trips[0]!
    const load = await inOrg(async (tx) => {
      const write = await planTripWrite(tx, trip)
      if (write.action !== 'enrich') throw new Error('expected enrich')
      const facilities = await resolveFacilities(tx, tripFacilityCodes(trip))
      await enrichLoad(
        tx,
        organizationId,
        write.loadId,
        trip,
        facilities,
        {
          hasStops: write.hasStops,
          hasMiles: write.hasMiles,
          hasRate: write.hasRate,
          hasActuals: write.hasActuals,
          isDelivered: write.isDelivered,
          isCancelled: write.isCancelled,
        },
        null,
        userId,
      )
      return tx.load.findFirstOrThrow({
        where: { id: write.loadId },
        include: { stops: { orderBy: { sequence: 'asc' } } },
      })
    })

    const arrived = load.stops.map((row) => row.arrivedAt)
    expect(
      arrived.filter((at) => at !== null),
      `stops with a check-in: ${load.stops
        .map((r) => `${r.name}=${r.arrivedAt ? 'set' : 'null'}`)
        .join(', ')}`,
    ).toHaveLength(4)
  })

  // THE SHARED STOP. HME9 is arrived at on one leg and departed on the next;
  // its arrival is the ARRIVING leg's 08:08, not the departing leg's 08:10.
  it('gives the shared stop the arriving leg check-in', async () => {
    const id = `T-SHARED-${nonce}`
    await importTrip(upcoming(id))

    const trip = planTrips(fourLegs(id)).trips[0]!
    const hme9 = trip.stops.find((s) => s.facilityCode === 'HME9')!
    expect(hme9.actualArrival?.time).toBe('08:08')
  })

  // RULE 3, ON TIMES. The cancelled leg's 06:27 belongs to a leg Amazon
  // replanned and must not become MEM4's check-in.
  it('never takes a time from the cancelled leg', async () => {
    const id = `T-CANCLEG-${nonce}`
    const trip = planTrips(fourLegs(id)).trips[0]!
    const mem4 = trip.stops.find((s) => s.facilityCode === 'MEM4')!
    expect(mem4.actualArrival?.time).toBe('07:17')
    expect(mem4.actualArrival?.time).not.toBe('06:27')
  })

  // ------------------------------------------------------------------------
  // THE FIRST IMPORT, WITH NO EARLIER ONE BEHIND IT.
  //
  // Dispatch imports yesterday's finished trips. There was no Upcoming pass —
  // the freight ran before anybody typed it in, which is the ordinary case for
  // a carrier catching up on a week. The file says Completed and carries every
  // check-in.
  //
  // ON PRODUCTION AT 790f475 loads 1011, 1012 and 1013 arrived from exactly
  // this file and landed BOOKED, showing Amazon's appointment times as though
  // they were the plan for freight still to come. Re-importing the same file
  // then moved them to Delivered. Two passes to reach a state the first pass
  // had all the facts for: `enrichLoad` reads `trip.stage` and `createTripLoad`
  // did not.
  //
  // BOTH HALVES ARE ASSERTED SEPARATELY, because the screen cannot tell them
  // apart. `stop-actuals.ts` shows the PLAN on a booked load, so a stop that
  // carries a real check-in and a stop that carries none render identically
  // while the status is wrong — and "shows scheduled times" is therefore not
  // evidence about what was written. The row is.
  // ------------------------------------------------------------------------
  it('lands a finished trip payable on the first import', async () => {
    const id = `T-FRESH-${nonce}`
    const { load } = await importTrip(fourLegs(id))

    // POD RECEIVED, NOT DELIVERED, and the difference is the point.
    //
    // Relay freight settles directly, so `transitionOperational` carries the
    // POD with the delivery: drivers upload into Relay, Amazon holds the
    // signed paperwork, and no POD document will ever reach this application
    // for this load. Stopping at DELIVERED would leave it invisible to
    // `settleableWhere`, which selects on POD_RECEIVED — no settlement line,
    // in any period, for any driver.
    //
    // THIS TEST READ 'DELIVERED' AND PASSED, against freight that was not
    // Amazon at all: the fixture resolved its customer with `resolveBroker`,
    // which leaves `settlesDirectly` false, while the action used
    // `ensureRelayCustomer`, which sets it true. The fixture inherited the
    // defect from the code and agreed with it. Both call one function now.
    expect(load.operationalStatus).toBe('POD_RECEIVED')

    // The freight IS the kind the whole redesign is about — asserted here
    // rather than assumed, because that assumption is exactly what failed.
    expect(load.directSettled).toBe(true)

    // AND DELIVERED IS STILL ON THE LOG. Reaching POD without a delivery
    // behind it would be a load that was paid for a trip it never finished.
    const events = await inOrg((tx) =>
      tx.loadStatusEvent.findMany({
        where: { loadId: load.id, axis: 'OPERATIONAL', outcome: 'APPLIED' },
        orderBy: { occurredAt: 'asc' },
        select: { toStatus: true, source: true },
      }),
    )
    expect(events.map((event) => event.toStatus)).toContain('DELIVERED')
    expect(
      events.find((event) => event.toStatus === 'POD_RECEIVED')?.source,
    ).toBe('AUTOMATIC')
  })

  it('and with every check-in the file printed, in one pass', async () => {
    const id = `T-FRESHACT-${nonce}`
    const { load } = await importTrip(fourLegs(id))

    expect(
      load.stops.filter((row) => row.arrivedAt !== null),
      `stops with a check-in: ${load.stops
        .map((row) => `${row.name}=${row.arrivedAt ? 'set' : 'null'}`)
        .join(', ')}`,
    ).toHaveLength(4)
  })

  // AND THE SECOND IMPORT CHANGES NOTHING. The point of doing it in one pass
  // is that the file stops being a two-step ritual; if a re-import still found
  // something to add, the first pass would still be incomplete.
  it('has nothing left to add when the same file arrives again', async () => {
    const id = `T-FRESHIDEM-${nonce}`
    await importTrip(fourLegs(id))

    const trip = planTrips(fourLegs(id)).trips[0]!
    const outcome = await inOrg(async (tx) => {
      const write = await planTripWrite(tx, trip)
      if (write.action !== 'enrich') throw new Error('expected enrich')
      const facilities = await resolveFacilities(tx, tripFacilityCodes(trip))
      return enrichLoad(
        tx,
        organizationId,
        write.loadId,
        trip,
        facilities,
        {
          hasStops: write.hasStops,
          hasMiles: write.hasMiles,
          hasRate: write.hasRate,
          hasActuals: write.hasActuals,
          isDelivered: write.isDelivered,
          isCancelled: write.isCancelled,
        },
        null,
        userId,
      )
    })

    expect(outcome.kind).toBe('unchanged')
  })

  // A TRIP STILL RUNNING IS NOT DELIVERED, which is the other side of reading
  // the stage: only `finished` moves the load, and the same import that lands
  // one load delivered leaves the next one booked.
  it('leaves an unfinished trip booked', async () => {
    const id = `T-FRESHRUN-${nonce}`
    const { load } = await importTrip(
      fourLegs(id).map((one) => ({ ...one, status: 'In Progress' })),
    )

    expect(load.operationalStatus).toBe('BOOKED')
  })
})

describe('a cancelled load is left alone', () => {
  // LOAD 1010's SHAPE. Booked, delivered by hand, cancelled by hand, then the
  // Completed export re-imported. Before this guard the import wrote mileage
  // and rate straight through while `transitionOperational` refused the status
  // move — so a cancelled load gained figures from a file, and the preview had
  // promised the one change that could not happen.
  const cancelledLoadFor = async (id: string) => {
    const { load } = await importTrip([
      leg({
        tripId: id,
        loadId: id,
        status: 'Not Started',
        stops: [
          stop('DEN7', { plannedArrival: clock('2026-08-24', '04:41') }),
          stop('MKC6', { plannedArrival: clock('2026-08-24', '06:32') }),
        ],
      }),
    ])
    await owner.load.update({
      where: { id: load.id },
      data: { isCancelled: true, cancelReason: 'not happening' },
    })
    return load
  }

  const finished = (id: string) =>
    leg({
      tripId: id,
      loadId: id,
      status: 'Completed',
      distance: 900,
      costCents: 500000,
      stops: [
        stop('DEN7', {
          plannedArrival: clock('2026-08-24', '04:41'),
          actualArrival: clock('2026-08-24', '07:17'),
        }),
        stop('MKC6', {
          plannedArrival: clock('2026-08-24', '06:32'),
          actualArrival: clock('2026-08-24', '08:08'),
        }),
      ],
    })

  it('writes nothing at all — not times, not mileage, not rate', async () => {
    const id = `T-CANC-${nonce}`
    const before = await cancelledLoadFor(id)

    const trip = planTrips([finished(id)]).trips[0]!
    const outcome = await inOrg(async (tx) => {
      const write = await planTripWrite(tx, trip)
      if (write.action !== 'enrich') throw new Error('expected enrich')
      expect(write.isCancelled).toBe(true)
      const facilities = await resolveFacilities(tx, tripFacilityCodes(trip))
      return enrichLoad(
        tx,
        organizationId,
        write.loadId,
        trip,
        facilities,
        {
          hasStops: write.hasStops,
          hasMiles: write.hasMiles,
          hasRate: write.hasRate,
          hasActuals: write.hasActuals,
          isDelivered: write.isDelivered,
          isCancelled: write.isCancelled,
        },
        trip.rateCents,
        userId,
      )
    })

    expect(outcome.kind).toBe('unchanged')

    const after = await inOrg((tx) =>
      tx.load.findFirstOrThrow({
        where: { id: before.id },
        include: { stops: { orderBy: { sequence: 'asc' } } },
      }),
    )

    // THE HALF-WRITE THIS REPLACED: mileage and rate went in while the status
    // move was refused. Each of these is a field that used to change.
    expect(after.stops.every((row) => row.arrivedAt === null)).toBe(true)
    expect(after.dispatchedMiles).toBe(before.dispatchedMiles)
    expect(after.linehaulCents).toBe(before.linehaulCents)
    expect(after.operationalStatus).toBe(before.operationalStatus)
  })

  it('still enriches an identical load that nobody cancelled', async () => {
    const id = `T-NOTCANC-${nonce}`
    await importTrip([
      leg({
        tripId: id,
        loadId: id,
        status: 'Not Started',
        stops: [
          stop('DEN7', { plannedArrival: clock('2026-08-24', '04:41') }),
          stop('MKC6', { plannedArrival: clock('2026-08-24', '06:32') }),
        ],
      }),
    ])

    const trip = planTrips([finished(id)]).trips[0]!
    const load = await inOrg(async (tx) => {
      const write = await planTripWrite(tx, trip)
      if (write.action !== 'enrich') throw new Error('expected enrich')
      expect(write.isCancelled).toBe(false)
      const facilities = await resolveFacilities(tx, tripFacilityCodes(trip))
      await enrichLoad(
        tx,
        organizationId,
        write.loadId,
        trip,
        facilities,
        {
          hasStops: write.hasStops,
          hasMiles: write.hasMiles,
          hasRate: write.hasRate,
          hasActuals: write.hasActuals,
          isDelivered: write.isDelivered,
          isCancelled: write.isCancelled,
        },
        trip.rateCents,
        userId,
      )
      return tx.load.findFirstOrThrow({
        where: { id: write.loadId },
        include: { stops: { orderBy: { sequence: 'asc' } } },
      })
    })

    // The control: without it, a guard that refused EVERYTHING would pass the
    // test above and nobody would notice until an import stopped working.
    expect(load.stops[0]!.arrivedAt).not.toBeNull()
    // POD RECEIVED, NOT DELIVERED — Relay freight settles directly, so the
    // delivery carries its POD. See the note at the first import test.
    expect(load.operationalStatus).toBe('POD_RECEIVED')
  })
})

describe('finding a trip by the number dispatch quotes', () => {
  // "IS TRIP X IN THE SYSTEM?" — the question the loads-list search exists to
  // answer, asked against real Postgres because `contains` and `insensitive`
  // are translated into SQL rather than evaluated in JavaScript. A predicate
  // that compiles is not a predicate that matches.
  const find = (term: string) =>
    inOrg((tx) =>
      tx.load.findMany({
        where: { deletedAt: null, ...loadSearchWhere(term) },
        select: { referenceNumber: true },
      }),
    )

  it('finds a prefixed trip when the bare id is typed, and the reverse', async () => {
    const bare = `SEARCH${nonce}`
    await importTrip([leg({ tripId: `T-${bare}`, loadId: `L-S1-${nonce}` })])

    // BOTH SHAPES EXIST IN THE WILD and a dispatcher types what is printed in
    // front of them. Exact matching is the JOIN rule, deliberately not this.
    expect((await find(bare)).map((row) => row.referenceNumber)).toContain(
      `T-${bare}`,
    )
    expect(
      (await find(`T-${bare}`)).map((row) => row.referenceNumber),
    ).toContain(`T-${bare}`)
  })

  it('ignores case', async () => {
    const bare = `MiXeD${nonce}`
    await importTrip([leg({ tripId: `T-${bare}`, loadId: `L-S2-${nonce}` })])
    expect(
      (await find(bare.toLowerCase())).map((row) => row.referenceNumber),
    ).toContain(`T-${bare}`)
  })

  // The number printed down every other row of the same table. A search box
  // that refused it would be a trap.
  it('finds a load by its own load number too', async () => {
    const { load } = await importTrip([
      leg({ tripId: `T-BYNUM${nonce}`, loadId: `L-S3-${nonce}` }),
    ])
    const found = await inOrg((tx) =>
      tx.load.findMany({
        where: { deletedAt: null, ...loadSearchWhere(load.loadNumber) },
        select: { id: true },
      }),
    )
    expect(found.map((row) => row.id)).toContain(load.id)
  })

  // An empty term must not become a filter that matches nothing — the caller
  // spreads this into a `where`, and `{}` is what "not filtering" looks like.
  it('does not filter on an empty or whitespace term', async () => {
    await importTrip([
      leg({ tripId: `T-ALL${nonce}`, loadId: `L-S4-${nonce}` }),
    ])
    const all = await find('')
    const spaces = await find('   ')
    expect(all.length).toBeGreaterThan(0)
    expect(spaces.length).toBe(all.length)
  })
})
