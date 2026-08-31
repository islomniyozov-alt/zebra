import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { LOAD_WRITE_TIMEOUT_MS, loadSearchWhere } from '@/lib/loads'
import { resolveBroker } from '@/lib/locations'
import { planTrips } from '@/lib/trips-import'
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
    const customerId = await resolveBroker(tx, organizationId, 'Amazon Relay')
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
    const customerId = await inOrg((tx) =>
      resolveBroker(tx, organizationId, 'Amazon Relay'),
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
    const customerId = await inOrg((tx) =>
      resolveBroker(tx, organizationId, 'Amazon Relay'),
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
        { hasStops: false, hasMiles: false, hasRate: write.hasRate },
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
