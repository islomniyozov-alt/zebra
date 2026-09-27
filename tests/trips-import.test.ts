import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseTripsCsv, type TripLeg } from '@/lib/trips-csv'
import {
  CANCELLED_STATUS,
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
    costCents: null,
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

describe('the rate, and the two conditions it needs', () => {
  const priced = (over: Partial<TripLeg>[]) =>
    planTrips(over.map((o) => leg(o))).trips[0]!.rateCents

  // THE VERIFIED CASE. Trip 1165YNVHN read $5,089.07 in the Relay portal and
  // the column matched exactly, on a trip whose Load ID is its Trip ID.
  it('prices a single-load trip from Estimated Cost', () => {
    expect(priced([{ tripId: 'T-1', loadId: 'T-1', costCents: 508907 }])).toBe(
      508907,
    )
  })

  // ── SUPERSEDED, 2026-09-26: A MULTI-LEG TRIP IS PRICED AT THE SUM ────────
  //
  // This test used to assert `toBeNull()` here, under the 2026-08-20 ruling's
  // second sentence. The new ruling for bulk completed files is "gross from the
  // file", because a delivered load with no rate cannot be settled and somebody
  // types the same figures in by hand off the same export.
  //
  // THE OLD WARNING STILL STANDS AND IS NOW A LABEL. No single leg's cost is
  // the trip's money; the SUM is a different claim from any one of them, and
  // `rateBasis` is how the preview says which claim it is making.
  it('prices a multi-leg trip at the sum of its legs, labelled as a sum', () => {
    const trip = planTrips([
      leg({ tripId: 'T-1', loadId: 'T-1', costCents: 180000 }),
      leg({ tripId: 'T-1', loadId: 'T-1', costCents: 45000 }),
    ]).trips[0]!
    expect(trip.rateCents).toBe(225000)
    expect(trip.rateBasis).toBe('leg_sum')
  })

  // AND THE VERIFIED READING KEEPS ITS OWN LABEL, so a dispatcher can tell the
  // figure Amazon's portal was checked against from one this code added up.
  it('labels a single-load trip as the row it came from', () => {
    const trip = planTrips([
      leg({ tripId: 'T-1', loadId: 'T-1', costCents: 508907 }),
    ]).trips[0]!
    expect(trip.rateBasis).toBe('load_row')
  })

  // A PARTIAL SUM IS REFUSED RATHER THAN RETURNED SHORT. Measured on the
  // 2026-09-24 fixture: 32 multi-leg trips, all 32 carrying a cost on every
  // usable leg, 0 partial — so this costs nothing and is why the next file can
  // be trusted. A gross that is quietly low is worse than none: it settles.
  it('REFUSES a sum when one leg carries no cost', () => {
    const trip = planTrips([
      leg({ tripId: 'T-1', loadId: 'A', costCents: 180000 }),
      leg({ tripId: 'T-1', loadId: 'B', costCents: null }),
    ]).trips[0]!
    expect(trip.rateCents).toBeNull()
    expect(trip.rateBasis).toBeNull()
  })

  it('refuses a single leg whose Load ID is a different id', () => {
    expect(priced([{ tripId: 'T-1', loadId: 'OTHER', costCents: 90000 }])).toBe(
      null,
    )
  })

  // A CANCELLED SIBLING STILL MAKES IT A MULTI-LEG TRIP, so the trip is priced
  // by the SUM rather than by the row — "exactly one row" means exactly one row,
  // which is the original ruling and unchanged.
  //
  // AND THE CANCELLED LEG IS OUT OF THE SUM, by rule 3: a replanned leg is money
  // for a trip nobody drove. The two clauses together are why the figure here is
  // 180000 with a `leg_sum` label and not 180000 with a `load_row` one.
  it('sums the usable legs and leaves the cancelled one out', () => {
    const trip = planTrips([
      leg({ tripId: 'T-1', loadId: 'T-1', costCents: 180000 }),
      leg({
        tripId: 'T-1',
        loadId: 'T-1',
        status: 'Cancelled',
        costCents: 99999,
      }),
    ]).trips[0]!
    expect(trip.rateCents).toBe(180000)
    expect(trip.rateBasis).toBe('leg_sum')
  })

  it('is null when a single-load trip carries no cost at all', () => {
    expect(
      priced([{ tripId: 'T-1', loadId: 'T-1', costCents: null }]),
    ).toBeNull()
  })

  // The per-leg figures must not survive onto the object the writer sees.
  it('leaves no per-leg cost anywhere on the planned trip', () => {
    const plan = planTrips([
      leg({ tripId: 'T-9', loadId: 'A', costCents: 111 }),
      leg({ tripId: 'T-9', loadId: 'B', costCents: 222 }),
    ])
    const json = JSON.stringify(plan.trips[0])
    expect(json).not.toContain('111')
    expect(json).not.toContain('222')
  })
})

const CORPUS = join(process.cwd(), 'corpus', 'relay-trips')
const files = existsSync(CORPUS)
  ? readdirSync(CORPUS).filter(
      // A trip export is named Trips*. Excluding one facilities file BY NAME
      // meant a second one — facilities-amazon-delta.csv — was fed to the trip
      // parser the day it arrived.
      (name) => name.startsWith('Trips') && name.endsWith('.csv'),
    )
  : []

describe.skipIf(files.length === 0)('every real trip in the sweep', () => {
  const plans = files.map((name) => {
    const { legs } = parseTripsCsv(readFileSync(join(CORPUS, name), 'utf8'))
    return { name, ...planTrips(legs) }
  })

  // ------------------------------------------------------------------------
  // THE RATE PARTITION, BOTH DIRECTIONS, ACROSS THE WHOLE SWEEP.
  //
  // Per file — the unit planTrips runs in — the corpus holds 1,816 trip
  // instances: 1,001 single-leg, 973 of those with Load ID === Trip ID and all
  // 973 carrying a cost; 815 multi-leg, NONE with a matching leg.
  //
  // ── SUPERSEDED, 2026-09-26 ───────────────────────────────────────────────
  //
  // This used to assert that NO multi-leg trip was ever priced, across the whole
  // sweep. The ruling changed — "gross from the file" for bulk completed files —
  // so the question the sweep can still answer is a different one: EVERY priced
  // trip's figure must be re-derivable from its own rows, by the basis the plan
  // claims. That is the part a corpus can check and a constructed leg cannot.
  //
  // BUILT FROM THE ARTEFACT, NOT FROM WHAT THE PLANNER BELIEVES. The figures are
  // re-parsed out of the file rather than read off the plan, which is flag 88's
  // lesson: an instrument that inherits the belief it is meant to test proves
  // nothing. A plan that summed the wrong legs would still agree with itself.
  // ------------------------------------------------------------------------
  it('can re-derive every priced trip from its own rows', () => {
    const priced = plans.flatMap((plan) =>
      plan.trips
        .filter((trip) => trip.rateCents !== null)
        .map((trip) => ({ name: plan.name, tripId: trip.tripId, trip })),
    )
    expect(priced.length).toBeGreaterThan(0)

    let rows_ = 0
    let sums = 0
    for (const { name, tripId, trip } of priced) {
      const { legs } = parseTripsCsv(readFileSync(join(CORPUS, name), 'utf8'))
      const rows = legs.filter((leg) => leg.tripId === tripId)

      if (trip.rateBasis === 'load_row') {
        // THE ORIGINAL RULING, UNCHANGED: exactly one row, named by its load.
        expect(
          rows,
          `${name}:${tripId} claims load_row with ${rows.length} legs`,
        ).toHaveLength(1)
        expect(rows[0]!.loadId).toBe(tripId)
        expect(trip.rateCents).toBe(rows[0]!.costCents)
        rows_ += 1
        continue
      }

      expect(trip.rateBasis).toBe('leg_sum')
      // CANCELLED LEGS OUT, by rule 3, and every survivor carrying a cost —
      // a partial sum is refused rather than returned short.
      const usable = rows.filter((leg) => leg.status !== CANCELLED_STATUS)
      expect(rows.length).toBeGreaterThan(1)
      expect(usable.every((leg) => leg.costCents !== null)).toBe(true)
      expect(trip.rateCents).toBe(
        usable.reduce((sum, leg) => sum + (leg.costCents ?? 0), 0),
      )
      sums += 1
    }

    // BOTH BRANCHES EXERCISED, or the loop above proved one rule and skipped
    // the other while reporting a pass. The corpus predates the sum, so a run
    // that found no sums would be the old rule passing under a new name.
    expect(rows_).toBeGreaterThan(0)
    expect(sums).toBeGreaterThan(0)
  })

  it('prices every single-load trip the export gives a cost for', () => {
    const missed = plans.flatMap((plan) =>
      plan.trips
        .filter((trip) => trip.rateCents === null && trip.cancelledLegs === 0)
        .flatMap((trip) => {
          const { legs } = parseTripsCsv(
            readFileSync(join(CORPUS, plan.name), 'utf8'),
          )
          const rows = legs.filter((leg) => leg.tripId === trip.tripId)
          const single =
            rows.length === 1 &&
            rows[0]!.loadId === trip.tripId &&
            rows[0]!.costCents !== null
          return single ? [`${plan.name}:${trip.tripId}`] : []
        }),
    )
    expect(missed).toEqual([])
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

// ---------------------------------------------------------------------------
// THE PER-STOP MILES AGREE WITH THE LOAD'S TOTAL.
//
// `Load.dispatchedMiles` accumulates per LEG, once, and is the authority. The
// per-stop `legMiles` is the same money broken out, and the two disagreeing is
// how a stops table comes to contradict the summary above it on the same
// screen.
//
// IT DID DISAGREE, on 5 of 1,730 trips. `legMiles` was written as
// `index === 0 ? null : miles`, which puts the WHOLE leg's mileage on every
// stop after the first — identical to the intent on a two-stop leg and a
// multiple of it on a longer one. The sweep held exactly 5 legs with three or
// more stops. One-to-one, so the mechanism was named rather than guessed at,
// and the authority question dissolved instead of needing a ruling.
// ---------------------------------------------------------------------------

describe.skipIf(files.length === 0)('miles, broken out and summed', () => {
  it('sums the stop legs back to the trip total, on every trip in the sweep', () => {
    const mismatched: string[] = []
    let checked = 0

    for (const name of files) {
      const { legs } = parseTripsCsv(readFileSync(join(CORPUS, name), 'utf8'))
      for (const trip of planTrips(legs).trips) {
        if (trip.totalMiles === null) continue
        checked++
        const summed = trip.stops.reduce(
          (total, stop) => total + (stop.legMiles ?? 0),
          0,
        )
        if (summed !== trip.totalMiles && mismatched.length < 5) {
          mismatched.push(
            `${name} ${trip.tripId}: stops summed ${summed}, trip total ` +
              `${trip.totalMiles}, ${trip.stops.length} stops`,
          )
        }
      }
    }

    // The control. This assertion is worthless over an empty sweep, and the
    // sweep is gitignored.
    expect(checked).toBeGreaterThan(1_000)
    expect(mismatched).toEqual([])
  })

  // THE CASE THAT BROKE IT, kept as itself so a future edit sees the shape
  // rather than only the aggregate.
  it('gives a three-stop leg its mileage once, at the arrival', () => {
    const trip = planTrips([
      leg({
        tripId: 'T-3STOP',
        distance: 470,
        stops: ['MEM4', 'HME9', 'MDW2'].map((facilityCode) => ({
          facilityCode,
          plannedArrival: null,
          plannedDeparture: null,
          actualArrival: null,
          actualDeparture: null,
        })),
      }),
    ]).trips[0]!

    expect(trip.totalMiles).toBe(470)
    expect(trip.stops.map((s) => s.legMiles)).toEqual([null, null, 470])
  })
})
