import type { TripLeg, TripLegStop } from './trips-csv'
import { isEmptyLeg } from './leg-purpose'

// ---------------------------------------------------------------------------
// LEGS BECOME A TRIP; A TRIP BECOMES ONE LOAD.
//
// The planner, and no I/O in it. Legs in, a plan out — so every rule below is
// testable against the 1,600-file sweep without a database, and the preview a
// dispatcher confirms is the same object the writer consumes.
//
// ONE ZEBRA LOAD PER TRIP, keyed on `Load.referenceNumber = Trip ID`. That is
// also the join: a load already carrying this reference was created from the
// booking email, and this ENRICHES it rather than booking the freight twice.
//
// EXACT MATCH ONLY. Two id shapes exist in the wild — "T-115M68R2H" from the
// trips export and "115M68R2H" from booking #1's email — and normalising them
// silently would be guessing which trip a load belongs to. So a load whose
// reference differs ONLY by that prefix is surfaced as a WARNING with both
// strings shown, and the human decides.
//
// WORTH KNOWING BEFORE READING THE WARNING CODE: across 1,600 real exports and
// 2,987 leg rows the two shapes have an EMPTY INTERSECTION, and every bare
// Trip ID is its own row's Load ID (973 of 973, never once when prefixed). So
// a bare id is a single-load booking named by its load, and this warning
// guards a case never yet observed. It is a tripwire, not a workflow.
// ---------------------------------------------------------------------------

/** Legs Amazon replanned. Rule 3: skipped whole, counted out loud. */
export const CANCELLED_STATUS = 'Cancelled'

/**
 * A leg that ran to the end. The export's other states are `Not Started` and
 * `In Progress`; measured across the corpus, those four are all it uses.
 */
export const COMPLETED_STATUS = 'Completed'

/** A leg Amazon has planned and nobody has driven yet. */
export const NOT_STARTED_STATUS = 'Not Started'

/**
 * Where a trip is in its life.
 *
 * THE LIFECYCLE THIS EXISTS FOR: dispatch imports the trip from an Upcoming
 * export to get it on the board, and the same trip is exported again after it
 * runs. The second file is the only place the actual check-ins live — and
 * because both files produce the same stops and the same mileage, the import
 * called the second one "already complete" and wrote nothing until this told
 * them apart.
 */
export type TripStage = 'upcoming' | 'running' | 'finished'

function stageOf(usable: readonly TripLeg[]): TripStage {
  if (usable.every((leg) => leg.status === COMPLETED_STATUS)) return 'finished'
  if (usable.every((leg) => leg.status === NOT_STARTED_STATUS))
    return 'upcoming'
  return 'running'
}

export interface PlannedTripStop {
  sequence: number
  facilityCode: string
  /** The leg that ARRIVED here. Null on the first stop of the trip. */
  legMiles: number | null
  legEmpty: boolean | null
  /** The arriving leg's own Load ID — the Datatruck convention for a stop. */
  referenceNumber: string | null
  plannedArrival: TripLegStop['plannedArrival']
  plannedDeparture: TripLegStop['plannedDeparture']
  actualArrival: TripLegStop['actualArrival']
  actualDeparture: TripLegStop['actualDeparture']
}

export interface PlannedTrip {
  tripId: string
  stops: PlannedTripStop[]
  /** Sum of non-cancelled leg miles. Rule 5. */
  totalMiles: number | null
  /** The empty share of that sum, for `Load.emptyMiles`. */
  emptyMiles: number | null
  /** Rule 7: shown, never auto-assigned. */
  driverNames: string[]
  trailerIds: string[]
  tractorIds: string[]
  /** Rule 3: how many legs were dropped, so the preview can say so. */
  cancelledLegs: number
  /**
   * Where the trip is in its life, from the legs themselves.
   *
   * `finished` — every usable leg Completed.
   * `upcoming` — every usable leg Not Started.
   * `running`  — anything else, including a mix.
   *
   * ONE FIELD, NOT TWO. A separate `completed` boolean beside this would be a
   * second number free to disagree with it, which is the shape this codebase
   * keeps getting bitten by.
   */
  stage: TripStage
  /**
   * The trip's price in integer cents, or null — and null is the common case.
   *
   * SET ONLY FOR A SINGLE-LOAD TRIP: exactly one row in the export, and that
   * row's Load ID equal to the Trip ID. See `singleLoadRateCents`.
   *
   * The per-leg costs do NOT survive onto this object. A `PlannedTrip` is what
   * the writer sees, and the writer must not be able to reach an allocation
   * even by mistake — the value either qualified as a price here or it no
   * longer exists.
   */
  rateCents: number | null
}

export type TripWarningKind =
  | 'prefix_near_miss'
  | 'no_usable_legs'
  | 'sequence_gap'

export interface TripWarning {
  kind: TripWarningKind
  tripId: string
  detail: string
}

export interface TripsPlan {
  trips: PlannedTrip[]
  warnings: TripWarning[]
}

/** The bare form of an id, for comparison only — never for storage. */
export function withoutTripPrefix(tripId: string): string {
  return tripId.startsWith('T-') ? tripId.slice(2) : tripId
}

/**
 * Do these two references differ ONLY by the trip prefix?
 *
 * Used to warn, never to match. `T-115M68R2H` and `115M68R2H` are different
 * references until a human says otherwise.
 */
export function isPrefixNearMiss(a: string, b: string): boolean {
  if (a === b) return false
  return withoutTripPrefix(a) === withoutTripPrefix(b)
}

/**
 * The facilities a leg visits, in order.
 *
 * The stop columns are the authority. `Facility Sequence` ("DEN7->MKC6") says
 * the same thing in one cell and is kept for the preview to display, but a
 * chain built from a string would be a second parser to keep in step.
 */
function legStops(leg: TripLeg): TripLegStop[] {
  return leg.stops
}

/**
 * Turn one file's legs into trips.
 *
 * LEGS FLATTEN AND SHARED FACILITIES DEDUPE: A->B then B->C is three stops,
 * not four, because the B a truck departs is the B it arrived at. Dedupe is on
 * ADJACENCY, not on the whole chain — a trip that returns to a yard it started
 * from really did visit it twice, and collapsing that would erase a stop the
 * driver made.
 */
export function planTrips(legs: readonly TripLeg[]): TripsPlan {
  const warnings: TripWarning[] = []
  const byTrip = new Map<string, TripLeg[]>()

  for (const leg of legs) {
    const existing = byTrip.get(leg.tripId)
    if (existing) existing.push(leg)
    else byTrip.set(leg.tripId, [leg])
  }

  const trips: PlannedTrip[] = []

  for (const [tripId, all] of byTrip) {
    // RULE 3: cancelled legs are replanned ones, and the real data carries
    // same-lane duplicates because of them. Dropped whole, counted out loud.
    const usable = all.filter((leg) => leg.status !== CANCELLED_STATUS)
    const cancelledLegs = all.length - usable.length

    if (usable.length === 0) {
      warnings.push({
        kind: 'no_usable_legs',
        tripId,
        detail: `all ${all.length} leg(s) are ${CANCELLED_STATUS.toLowerCase()}`,
      })
      continue
    }

    const stops: PlannedTripStop[] = []
    let totalMiles = 0
    let emptyMiles = 0
    let sawDistance = false

    usable.forEach((leg) => {
      const chain = legStops(leg)
      const empty = isEmptyLeg(leg.shipperAccount)
      const miles = leg.distance === null ? null : Math.round(leg.distance)

      if (miles !== null) {
        sawDistance = true
        totalMiles += miles
        if (empty) emptyMiles += miles
      }

      chain.forEach((stop, index) => {
        const last = stops[stops.length - 1]

        // THE SHARED FACILITY. This leg's first stop is usually the previous
        // leg's last; they are one visit, and the later leg's clocks are the
        // departure half of it.
        if (index === 0 && last?.facilityCode === stop.facilityCode) {
          last.plannedDeparture = stop.plannedDeparture ?? last.plannedDeparture
          last.actualDeparture = stop.actualDeparture ?? last.actualDeparture
          return
        }

        stops.push({
          sequence: stops.length + 1,
          facilityCode: stop.facilityCode,
          // The leg belongs to the stop it ARRIVES at, so the first facility
          // of a leg carries nothing and the rest carry this leg's figures.
          legMiles: index === 0 ? null : miles,
          legEmpty: index === 0 ? null : empty,
          referenceNumber: index === 0 ? null : leg.loadId || null,
          plannedArrival: stop.plannedArrival,
          plannedDeparture: stop.plannedDeparture,
          actualArrival: stop.actualArrival,
          actualDeparture: stop.actualDeparture,
        })
      })
    })

    if (stops.length < 2) {
      warnings.push({
        kind: 'sequence_gap',
        tripId,
        detail: `${stops.length} stop(s) after flattening ${usable.length} leg(s)`,
      })
    }

    trips.push({
      tripId,
      stops,
      totalMiles: sawDistance ? totalMiles : null,
      emptyMiles: sawDistance ? emptyMiles : null,
      driverNames: unique(usable.map((leg) => leg.driverName)),
      trailerIds: unique(usable.map((leg) => leg.trailerId)),
      tractorIds: unique(usable.map((leg) => leg.tractorId)),
      cancelledLegs,
      // EVERY usable leg, not any. A trip half-run is not a trip that
      // happened, and calling it delivered would put a load on the invoice
      // queue while the driver is still on it.
      stage: stageOf(usable),
      rateCents: singleLoadRateCents(tripId, all),
    })
  }

  return { trips, warnings }
}

/**
 * `Estimated Cost` promoted to a price, or null.
 *
 * ---------------------------------------------------------------------------
 * THE PARTITION, AND WHY IT IS TWO CONDITIONS RATHER THAN ONE.
 *
 * The ruling on 2026-08-20 was "fill the rate when Trip ID === Load ID", after
 * the owner verified trip 1165YNVHN against the Relay portal at $5,089.07 and
 * found this column matching exactly.
 *
 * MEASURED ACROSS THE 1,600-FILE CORPUS, per file, which is the only unit
 * `planTrips` is ever called in: 1,816 trip instances, of which 1,001 have a
 * single leg. 973 of those 1,001 have Load ID === Trip ID and every one of the
 * 973 carries a cost. Of the 815 multi-leg trips, ZERO contain a leg whose
 * Load ID equals the Trip ID. The partition is clean, exactly as ruled.
 *
 * THE LEG COUNT IS CHECKED ANYWAY, and not because the corpus needs it. It is
 * the ruling's second sentence — multi-leg trips stay never-read — written as
 * code rather than left as a property of today's data. On a multi-leg trip
 * this column is a share of the trip's money; if such a trip ever does carry a
 * matching Load ID, the equality alone would price it from an allocation, and
 * the trap would be silent.
 *
 * A CAUTION FROM BUILDING THIS. The first measurement said 87 multi-leg trips
 * contained a matching leg, and it was WRONG: it grouped trips across every
 * file at once, so the corpus's duplicate exports of one trip — the same trip
 * downloaded four times — counted as four legs. Grouping by Trip ID is right;
 * grouping by Trip ID across files invents legs that never shared a trip.
 *
 * CANCELLED LEGS COUNT TOWARDS THE TOTAL. A trip that ran one leg and
 * cancelled another was still planned as a multi-leg trip, and its cost column
 * was still divided up as one. "Exactly one row" means exactly one row.
 * ---------------------------------------------------------------------------
 */
function singleLoadRateCents(
  tripId: string,
  legs: readonly TripLeg[],
): number | null {
  if (legs.length !== 1) return null
  const only = legs[0]!
  if (only.loadId.trim() !== tripId.trim()) return null
  return only.costCents
}

/**
 * The warnings a plan earns once existing loads are known.
 *
 * Separated from `planTrips` because it needs the database and that does not:
 * the caller reads the references it already has and hands them here, so the
 * near-miss rule stays testable without one.
 */
export function nearMissWarnings(
  plan: TripsPlan,
  existingReferences: readonly string[],
): TripWarning[] {
  const exact = new Set(existingReferences)
  const warnings: TripWarning[] = []

  for (const trip of plan.trips) {
    if (exact.has(trip.tripId)) continue
    for (const reference of existingReferences) {
      if (isPrefixNearMiss(trip.tripId, reference)) {
        warnings.push({
          kind: 'prefix_near_miss',
          tripId: trip.tripId,
          detail:
            `a load already carries "${reference}", which differs only by the ` +
            `trip prefix. These are treated as DIFFERENT references; confirm ` +
            `before importing if they are the same freight.`,
        })
      }
    }
  }

  return warnings
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim() !== ''))]
}

/**
 * A fingerprint of what a preview showed, posted back with the confirm.
 *
 * WHY IT EXISTS: the preview and the confirm are two round trips over the same
 * text, and between them a dispatcher can pick a different file. Without this,
 * the second submit would write whatever the browser last held while the
 * screen still displayed the plan for something else — the worst shape a bulk
 * write can take, because it looks like it was reviewed.
 *
 * IT IS NOT A CHECKSUM OF THE FILE. Two exports of one trip differing only in
 * whitespace or column order describe the same freight and should not force a
 * re-read; what must not change is what the import WOULD DO. So the fingerprint
 * is taken over the planned shape — which trips, how many stops each, the
 * mileage, how many legs were dropped — and it is deliberately blind to
 * everything the write does not use.
 *
 * SORTED, because row order in the export is not meaningful and reordering it
 * is not a change worth refusing.
 */
export function planSignature(plan: TripsPlan): string {
  const shape = plan.trips
    .map(
      (trip) =>
        `${trip.tripId}:${trip.stops.length}:${trip.totalMiles ?? '-'}:${trip.cancelledLegs}`,
    )
    .sort()
    .join('|')

  let hash = 0
  for (let index = 0; index < shape.length; index++) {
    hash = (hash * 31 + shape.charCodeAt(index)) | 0
  }
  return `${plan.trips.length}-${hash}`
}
