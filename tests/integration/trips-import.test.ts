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

const stop = (facilityCode: string) => ({
  facilityCode,
  plannedArrival: null,
  plannedDeparture: null,
  actualArrival: null,
  actualDeparture: null,
})

const leg = (over: Partial<TripLeg> = {}): TripLeg => ({
  tripId: `T-TRIPS-${nonce}`,
  loadId: `L-${nonce}`,
  facilitySequence: 'DEN7->MKC6',
  status: 'Completed',
  distance: 583,
  distanceUnit: 'mi',
  shipperAccount: 'OutboundAmazonManaged',
  driverName: 'A DRIVER',
  trailerId: 'HV1',
  tractorId: 'ZP1',
  stops: [stop('DEN7'), stop('MKC6')],
  ...over,
})

/** Book one trip the way the action does, and hand back the row it wrote. */
async function importTrip(legs: TripLeg[]) {
  const plan = planTrips(legs)
  const trip = plan.trips[0]!

  const outcome = await inOrg(async (tx) => {
    const customerId = await resolveBroker(tx, organizationId, 'Amazon Relay')
    const facilities = await resolveFacilities(tx, tripFacilityCodes(trip))
    return createTripLoad(
      tx,
      organizationId,
      { trip, companyId, customerId },
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

  // RULE 6, READ BACK FROM THE COLUMN. The parser never reads a cost, so the
  // load must book with no rate — asserted against the row rather than against
  // the absence of a word in the source.
  it('books no money at all', async () => {
    const { load } = await importTrip([
      leg({ tripId: `T-MONEY-${nonce}`, loadId: `L-MONEY-${nonce}` }),
    ])
    expect(load.linehaulCents).toBe(0)
    expect(load.totalRevenueCents).toBe(0)
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
      expect(write.action).toBe('enrich')
      const facilities = await resolveFacilities(tx, tripFacilityCodes(trip))
      return enrichLoad(tx, organizationId, existing.id, trip, facilities, {
        hasStops: false,
        hasMiles: false,
      })
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
