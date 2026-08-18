import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseTripsCsv, type TripLeg } from '@/lib/trips-csv'
import {
  isPrefixNearMiss,
  nearMissWarnings,
  planTrips,
  withoutTripPrefix,
} from '@/lib/trips-import'

// ---------------------------------------------------------------------------
// LEGS BECOME A TRIP, AND A TRIP BECOMES ONE LOAD.
//
// No I/O in the planner, so every rule is testable here against the same 1,600
// real exports the parser reads — and the object a dispatcher confirms in the
// preview is the object the writer consumes.
// ---------------------------------------------------------------------------

const clock = (date: string, time: string, offset: number | null = -6) => ({
  date,
  time,
  utcOffsetHours: offset,
})

function leg(over: Partial<TripLeg> = {}): TripLeg {
  return {
    tripId: 'T-1',
    loadId: 'L-1',
    facilitySequence: 'A->B',
    status: 'Completed',
    distance: 100,
    distanceUnit: 'mi',
    shipperAccount: 'OutboundAmazonManaged',
    driverName: 'Belal Sultani',
    trailerId: 'HV1',
    tractorId: 'ZP1',
    stops: [
      {
        facilityCode: 'A',
        plannedArrival: clock('2025-01-10', '07:30'),
        plannedDeparture: clock('2025-01-10', '08:30'),
        actualArrival: null,
        actualDeparture: null,
      },
      {
        facilityCode: 'B',
        plannedArrival: clock('2025-01-11', '07:30'),
        plannedDeparture: null,
        actualArrival: null,
        actualDeparture: null,
      },
    ],
    ...over,
  }
}

describe('legs flatten into one stop chain', () => {
  const { trips } = planTrips([
    leg({ loadId: 'L-1', facilitySequence: 'A->B' }),
    leg({
      loadId: 'L-2',
      facilitySequence: 'B->C',
      distance: 50,
      stops: [
        {
          facilityCode: 'B',
          plannedArrival: null,
          plannedDeparture: clock('2025-01-11', '09:00'),
          actualArrival: null,
          actualDeparture: null,
        },
        {
          facilityCode: 'C',
          plannedArrival: clock('2025-01-12', '06:00'),
          plannedDeparture: null,
          actualArrival: null,
          actualDeparture: null,
        },
      ],
    }),
  ])

  it('dedupes the shared facility: A->B, B->C is three stops', () => {
    expect(trips[0]?.stops.map((stop) => stop.facilityCode)).toEqual([
      'A',
      'B',
      'C',
    ])
  })

  it('keeps the shared stop ONE visit with both halves of its clock', () => {
    // The B a truck departs is the B it arrived at. Two rows, one visit.
    const b = trips[0]?.stops[1]
    expect(b?.plannedArrival?.time).toBe('07:30')
    expect(b?.plannedDeparture?.time).toBe('09:00')
  })

  it('hangs each leg on the stop it ARRIVED at', () => {
    const [a, b, c] = trips[0]?.stops ?? []
    // The origin has no arriving leg. That is why the columns are nullable.
    expect(a?.legMiles).toBeNull()
    expect(a?.referenceNumber).toBeNull()
    expect(b?.legMiles).toBe(100)
    expect(b?.referenceNumber).toBe('L-1')
    expect(c?.legMiles).toBe(50)
    expect(c?.referenceNumber).toBe('L-2')
  })

  it('sums the trip miles', () => {
    expect(trips[0]?.totalMiles).toBe(150)
  })
})

describe('a trip that returns to where it started', () => {
  it('keeps both visits, because the driver made both', () => {
    // Dedupe is on ADJACENCY, not on the whole chain. Collapsing A...A would
    // erase a stop that happened.
    const { trips } = planTrips([
      leg({ facilitySequence: 'A->B' }),
      leg({
        loadId: 'L-2',
        facilitySequence: 'B->A',
        stops: [
          {
            facilityCode: 'B',
            plannedArrival: null,
            plannedDeparture: null,
            actualArrival: null,
            actualDeparture: null,
          },
          {
            facilityCode: 'A',
            plannedArrival: null,
            plannedDeparture: null,
            actualArrival: null,
            actualDeparture: null,
          },
        ],
      }),
    ])
    expect(trips[0]?.stops.map((stop) => stop.facilityCode)).toEqual([
      'A',
      'B',
      'A',
    ])
  })
})

describe('cancelled legs', () => {
  it('are skipped whole and counted out loud', () => {
    const { trips } = planTrips([
      leg({ status: 'Cancelled', distance: 999 }),
      leg({ loadId: 'L-2', distance: 100 }),
    ])
    expect(trips[0]?.cancelledLegs).toBe(1)
    // Rule 3: the 999 never reaches the mileage.
    expect(trips[0]?.totalMiles).toBe(100)
  })

  it('warn rather than produce an empty trip when they are all cancelled', () => {
    const { trips, warnings } = planTrips([leg({ status: 'Cancelled' })])
    expect(trips).toEqual([])
    expect(warnings[0]?.kind).toBe('no_usable_legs')
  })
})

describe('empty miles', () => {
  it('are the empty share of the total, not a separate sum', () => {
    const { trips } = planTrips([
      leg({ distance: 100, shipperAccount: 'OutboundAmazonManaged' }),
      leg({
        loadId: 'L-2',
        distance: 40,
        shipperAccount: 'BobtailMovementAnnotation',
      }),
    ])
    expect(trips[0]?.totalMiles).toBe(140)
    expect(trips[0]?.emptyMiles).toBe(40)
  })

  it('marks the arriving stop of an empty leg', () => {
    const { trips } = planTrips([
      leg({ shipperAccount: 'CustomerFacingEmptyTrailer' }),
    ])
    expect(trips[0]?.stops[1]?.legEmpty).toBe(true)
  })

  it('is null rather than zero when no distance was printed', () => {
    // Zero miles and an unknown distance are different facts.
    const { trips } = planTrips([leg({ distance: null })])
    expect(trips[0]?.totalMiles).toBeNull()
    expect(trips[0]?.emptyMiles).toBeNull()
  })
})

describe('the driver and the equipment', () => {
  it('are collected for the preview and never assigned', () => {
    const { trips } = planTrips([leg(), leg({ loadId: 'L-2' })])
    // Rule 7: name-matching to a Driver record is a separate ruled feature.
    expect(trips[0]?.driverNames).toEqual(['Belal Sultani'])
    expect(trips[0]?.trailerIds).toEqual(['HV1'])
    const source = readFileSync('src/lib/trips-import.ts', 'utf8')
    expect(source).not.toContain('driverId')
    expect(source).not.toContain('truckId')
  })
})

describe('the two trip-id shapes', () => {
  it('are never silently normalised into each other', () => {
    expect(withoutTripPrefix('T-115M68R2H')).toBe('115M68R2H')
    // The comparison form exists; the STORED form is untouched.
    const { trips } = planTrips([leg({ tripId: 'T-115M68R2H' })])
    expect(trips[0]?.tripId).toBe('T-115M68R2H')
  })

  it('warn when a load differs only by the prefix', () => {
    const plan = planTrips([leg({ tripId: 'T-115M68R2H' })])
    const warnings = nearMissWarnings(plan, ['115M68R2H'])
    expect(warnings[0]?.kind).toBe('prefix_near_miss')
    expect(warnings[0]?.detail).toContain('115M68R2H')
  })

  it('say nothing when the reference matches exactly — that is the join', () => {
    const plan = planTrips([leg({ tripId: 'T-115M68R2H' })])
    expect(nearMissWarnings(plan, ['T-115M68R2H'])).toEqual([])
  })

  it('and nothing when the references are simply different', () => {
    const plan = planTrips([leg({ tripId: 'T-1' })])
    expect(nearMissWarnings(plan, ['T-2', '999'])).toEqual([])
    expect(isPrefixNearMiss('T-1', 'T-1')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// AGAINST THE SWEEP.
// ---------------------------------------------------------------------------

const CORPUS = join(process.cwd(), 'corpus', 'relay-trips')
const files = existsSync(CORPUS)
  ? readdirSync(CORPUS).filter(
      (name) => name.endsWith('.csv') && name !== 'facilities-seed.csv',
    )
  : []

describe.skipIf(files.length === 0)('every real trip in the sweep', () => {
  const plans = files.map((name) => {
    const { legs } = parseTripsCsv(readFileSync(join(CORPUS, name), 'utf8'))
    return { name, ...planTrips(legs) }
  })

  it('plans a trip from every file that has a usable leg', () => {
    const empty = plans.filter(
      (plan) =>
        plan.trips.length === 0 &&
        !plan.warnings.some((warning) => warning.kind === 'no_usable_legs'),
    )
    expect(empty).toEqual([])
  })

  it('gives every planned trip at least two stops', () => {
    const thin = plans.flatMap((plan) =>
      plan.trips.filter((trip) => trip.stops.length < 2).map(() => plan.name),
    )
    expect(thin).toEqual([])
  })

  it('never puts a leg on the first stop of a trip', () => {
    // The origin has no arriving leg, by definition of the chain.
    const wrong = plans.flatMap((plan) =>
      plan.trips.filter(
        (trip) =>
          trip.stops[0]?.legMiles !== null ||
          trip.stops[0]?.referenceNumber !== null,
      ),
    )
    expect(wrong).toEqual([])
  })

  it('keeps empty miles within the total', () => {
    const broken = plans.flatMap((plan) =>
      plan.trips.filter(
        (trip) =>
          trip.emptyMiles !== null &&
          trip.totalMiles !== null &&
          trip.emptyMiles > trip.totalMiles,
      ),
    )
    expect(broken).toEqual([])
  })

  it('drops the cancelled legs the sweep really contains', () => {
    const cancelled = plans.reduce(
      (sum, plan) =>
        sum + plan.trips.reduce((n, trip) => n + trip.cancelledLegs, 0),
      0,
    )
    // 250 cancelled rows were counted across the sweep before any of this was
    // built; some belong to trips whose every leg is cancelled and are counted
    // as a warning instead, so this is the remainder rather than the total.
    expect(cancelled).toBeGreaterThan(0)
  })
})
