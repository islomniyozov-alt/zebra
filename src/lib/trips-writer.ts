import { createLoad, recomputeTotals, type StopInput } from './loads'
// FROM THE DATATRUCK MODULE ON PURPOSE, and it is the only thing taken from it.
// `importEventAt` is not a Datatruck rule: it is the discriminated union that
// makes "I have no date for this event" impossible to pass by accident, written
// there first because that importer met the hazard first. A second copy here
// would be a second chance to get the optional-field trap wrong.
import { importEventAt } from './datatruck/loads'
import { transitionOperational } from './load-status'
import { nameKey } from './name-key'
import { PERSON_DRIVER } from './driver-kind'
import { stageSeatsCrew, type CrewResolvers } from './trips-crew'
import { zoneForRelayStop } from './relay-import'
import { zoneWallClock } from './stop-time'
import type { TxClient } from './tenancy'
import type { PlannedTrip } from './trips-import'

// ---------------------------------------------------------------------------
// A PLANNED TRIP, WRITTEN — OR ADDED TO A LOAD THE EMAIL ALREADY MADE.
//
// RULE 1 IS A JOIN, NOT A CHOICE. `Load.referenceNumber = Trip ID`, so a trip
// whose reference already exists is the SAME FREIGHT arriving by a second
// route: the booking email created the load, and the trips export knows where
// the truck actually went. That load is enriched. Anything else would book
// Amazon's freight twice and put two of it on the dispatch board.
//
// EXACT MATCH ONLY, as ruled. "T-115M68R2H" and "115M68R2H" are different
// references here; the near-miss warning in `trips-import.ts` is what tells a
// human they might not be, and a human decides. Nothing in this file
// normalises an id.
//
// WHAT ENRICHMENT WILL NOT TOUCH:
//
//   * A RATE THE LOAD ALREADY CARRIES. The booking email is the contract and
//     this file is a courier. A load with no rate DOES get one now — see
//     `tripGrossCents`, and note that the old line here said `Estimated Cost`
//     "was never parsed in the first place", which stopped being true on
//     2026-08-20 and stayed in this comment for five weeks.
//   * A stop chain somebody has already edited. If the load has stops, the
//     trip's stops are not written over them — a dispatcher who fixed an
//     address should not find it replaced by an import an hour later.
//   * A SEAT SOMEBODY ALREADY FILLED. Rule 7 — "the CSV's names are
//     informational until name-matching is its own ruled feature" — is
//     SUPERSEDED as of 2026-09-26 for finished trips, by the feature whose
//     absence was its own stated condition. See `stageSeatsCrew` for why live
//     trips keep the old posture; it is not timidity, it is the dispatch guard.
//   * CLOSED HISTORY, AT ALL. Freight another system billed and was paid for.
//
// SO ENRICHMENT ADDS WHAT WAS MISSING and leaves what exists. That is the only
// posture under which running an import twice is safe, and running it twice is
// what will happen — which is the whole of "idempotent by trip id": the join on
// `Load.referenceNumber` makes a second upload update rather than duplicate,
// and adds-never-replaces makes the update a no-op once the load is complete.
// ---------------------------------------------------------------------------

export interface TripWriteInput {
  trip: PlannedTrip
  companyId: string
  customerId: string
  /**
   * The rate to write, already decided by the caller.
   *
   * NOT READ OFF THE TRIP DIRECTLY, and the indirection is the money wall:
   * §1.3 says a role that may not see money does not write it either, so the
   * action passes `trip.rateCents` only when the importer holds
   * `load.financials`, and null otherwise. The board importer takes the same
   * posture — a DISPATCHER's import books at zero.
   */
  rateCents: number | null
  /**
   * Who the file put in the seats, resolved. Null for a trip it refused or did
   * not name, and for every trip that has not finished — see `stageSeatsCrew`.
   */
  crew?: TripCrew | null
}

export type TripWriteOutcome =
  | {
      kind: 'created'
      loadId: string
      tripId: string
      stops: number
      /**
       * Where the export's stage put the load on the way in, or null when it
       * said Not Started and there was nothing to move.
       *
       * A STATUS RATHER THAN A BOOLEAN, because there are now two landings and
       * a `delivered: false` would be true of a load that had just been moved
       * to In Transit — a field whose absence of one thing implies the absence
       * of the other.
       */
      landed: 'DELIVERED' | 'IN_TRANSIT' | null
      /** The export called this trip finished and carried no clock for it. */
      undated?: boolean
      /** Which seats the file filled, when it filled any. */
      seated?: string
    }
  | {
      kind: 'enriched'
      loadId: string
      tripId: string
      added: string[]
      undated?: boolean
    }
  | { kind: 'unchanged'; loadId: string; tripId: string; reason: string }

// ---------------------------------------------------------------------------
// THE CREW, RESOLVED ONCE FOR THE WHOLE FILE.
//
// Owner's ruling, 2026-09-26: "driver and truck seated from the file's columns
// by unique name / unit". The judgement of WHAT a column resolves to lives in
// `trips-crew.ts` with no database in it; this is the two queries that feed it.
//
// TWO QUERIES PER CALL, NOT TWO PER TRIP. A month's export is 800 trips and the
// ruling's first clause is "any row size"; per-trip lookups would be 1,600 round
// trips. The preview calls this once for the file and the write once per chunk —
// see `TRIPS_PER_TRANSACTION` — so the cost is a handful of queries either way.
//
// MATCHED IN MEMORY, AND THAT IS NOT LAZINESS. The file prints one string per
// driver; the roster keeps `firstName` and `lastName`. Splitting the file's
// string to build a `where` would be guessing where a middle name goes — so the
// roster is read and the join happens on `nameKey` in JS, which is the same key
// the resolution refuses on. The cost is the size of the fleet per call, and the
// fleet is hundreds of rows. Whichever column the roster is indexed on would not
// help a comparison it cannot express.
//
// THE QUERY IS SKIPPED ENTIRELY when the file names nobody, so a trips export
// with empty crew columns pays nothing for this.
//
// A PAYEE IS NOT A DRIVER. `PERSON_DRIVER` excludes referral payees — "7 Star"
// and "Said truck 3609" are commission rows, and one of them landing in a seat
// would pay a referral for hauling. INACTIVE drivers ARE admitted, by the
// 2026-09-25 ruling: who drove it drove it, and the exclusion lives on new
// dispatch only.
// ---------------------------------------------------------------------------

/** Resolvers over the roster, for the trips this call is given. */
export async function resolveTripCrew(
  tx: TxClient,
  trips: readonly PlannedTrip[],
): Promise<CrewResolvers> {
  const driverNames = [
    ...new Set(trips.flatMap((trip) => trip.driverNames.map(nameKey))),
  ].filter((name) => name !== '')
  const units = [
    ...new Set(trips.flatMap((trip) => trip.tractorIds.map(nameKey))),
  ].filter((unit) => unit !== '')

  const drivers =
    driverNames.length === 0
      ? []
      : await tx.driver.findMany({
          where: { deletedAt: null, ...PERSON_DRIVER },
          select: { id: true, firstName: true, lastName: true },
        })

  const trucks =
    units.length === 0
      ? []
      : await tx.truck.findMany({
          where: { deletedAt: null },
          select: { id: true, unitNumber: true },
        })

  const driverIds = new Map<string, string[]>()
  for (const driver of drivers) {
    // THE FILE PRINTS ONE STRING, so the roster's two columns are joined to
    // compare with it. `nameKey` on both sides, which is the whole reason that
    // function is a module.
    const key = nameKey(`${driver.firstName} ${driver.lastName}`)
    if (!driverNames.includes(key)) continue
    const hits = driverIds.get(key) ?? []
    hits.push(driver.id)
    driverIds.set(key, hits)
  }

  const truckIds = new Map<string, string[]>()
  for (const truck of trucks) {
    const key = nameKey(truck.unitNumber)
    if (!units.includes(key)) continue
    const hits = truckIds.get(key) ?? []
    hits.push(truck.id)
    truckIds.set(key, hits)
  }

  return {
    driverIdsFor: (name) => driverIds.get(nameKey(name)) ?? [],
    truckIdsFor: (unit) => truckIds.get(nameKey(unit)) ?? [],
  }
}

/** The facility codes a trip names, in the order it visits them. */
export function tripFacilityCodes(trip: PlannedTrip): string[] {
  return [...new Set(trip.stops.map((stop) => stop.facilityCode))]
}

/**
 * Where each code lives, for the codes the seed knows.
 *
 * A code with no location is not an error and not a guess: the stop is written
 * with the code as its name and no address, which is exactly what "we have
 * never seen this dock" looks like. The alternative — inventing a location —
 * is how a facility book fills with half-known addresses.
 */
export interface ResolvedFacility {
  id: string
  city: string | null
  /** Null when the book has a row for the code but no street for it. */
  addressLine1: string | null
  state: string | null
  /** The zone its printed clocks are read in, when somebody has recorded one. */
  timezone: string | null
}

export async function resolveFacilities(
  tx: TxClient,
  codes: readonly string[],
): Promise<Map<string, ResolvedFacility>> {
  if (codes.length === 0) return new Map()

  const found = await tx.location.findMany({
    where: { facilityCode: { in: [...codes] }, deletedAt: null },
    select: {
      id: true,
      facilityCode: true,
      city: true,
      state: true,
      // THE STOP'S OWN ZONE. Flag 14: a printed clock is a wall-clock face and
      // becomes an instant only in a named zone. Reading it here means the
      // trip's times are resolved where they happened rather than where the
      // carrier is.
      timezone: true,
      // WHETHER THE BOOK KNOWS WHERE THIS DOCK IS. A facility row can exist
      // with no street — MEM4-DRAY does — and a stop written from it renders
      // as a code with blank space under it. The preview counts these so a
      // dispatcher learns it before a driver does.
      addressLine1: true,
    },
  })

  const map = new Map<string, ResolvedFacility>()
  for (const row of found) {
    if (row.facilityCode) {
      map.set(row.facilityCode, {
        id: row.id,
        city: row.city,
        state: row.state,
        timezone: row.timezone,
        addressLine1: row.addressLine1,
      })
    }
  }
  return map
}

/** The stop rows a trip writes, resolved against the facility book. */
/**
 * A stop row: a `StopInput` and the sequence it sits at.
 *
 * TYPED AS `StopInput &` DELIBERATELY, so the create path can SPREAD it rather
 * than restate it. Three separate fields have been lost in that restatement —
 * `place` for `name`, `legMiles`/`legEmpty`, and all four clocks — every one of
 * them in the same handful of lines, every one found only by a test that read
 * the column back. The durable fix is the shape, not more care.
 */
export interface TripStopRow {
  /** Position in the chain. `createLoad` recomputes it from array order. */
  sequence: number
  type: 'PICKUP' | 'DELIVERY'
  locationId: string | null
  name: string
  referenceNumber: string | null
  legMiles: number | null
  legEmpty: boolean | null
  /** The plan, as the export printed it. */
  scheduledAt: Date | null
  /** What happened, on a finished trip. Null on one still running. */
  arrivedAt: Date | null
  departedAt: Date | null
}

// PRECISE TYPES HERE, NOT `StopInput &`. That was tried: `StopInput` types its
// text fields `unknown` because they arrive from form data and are laundered
// through `optionalText`, and inheriting that widened this row enough to break
// `enrichLoad`'s direct `createMany`. The row keeps real types and stays
// STRUCTURALLY assignable to `StopInput`, which is all the spread below needs.
type RowFitsStopInput =
  Omit<TripStopRow, 'sequence'> extends StopInput ? true : never
/** Fails to compile if a row field ever stops fitting the load contract. */
const _rowFitsStopInput: RowFitsStopInput = true
void _rowFitsStopInput

/**
 * A printed clock face becomes an instant, in the stop's own zone.
 *
 * FLAG 14, APPLIED TO ACTUALS AS WELL AS TO THE PLAN. The export prints wall
 * clocks and a standard-offset column beside them; the offset disagrees with
 * the printed time for half the year, so it is cross-check metadata and never
 * an instant. The zone comes from the facility when somebody has recorded one,
 * from the offset table when they have not, and from the carrier last.
 */
function instantAt(
  clock: { date: string; time: string; utcOffsetHours: number | null } | null,
  facility: ResolvedFacility | undefined,
  fallbackZone: string,
): Date | null {
  if (!clock) return null
  const [hour, minute] = clock.time.split(':').map(Number)
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null
  const zone = zoneForRelayStop(
    facility?.timezone ?? null,
    clock.utcOffsetHours,
    fallbackZone,
  )
  return zoneWallClock(clock.date, hour!, minute!, zone)
}

export function stopRowsForTrip(
  trip: PlannedTrip,
  facilities: ReadonlyMap<string, ResolvedFacility>,
  fallbackZone = 'America/Chicago',
): TripStopRow[] {
  return trip.stops.map((stop, index) => ({
    sequence: index + 1,
    // POSITION IS THE ONLY EVIDENCE THIS EXPORT OFFERS. It names facilities
    // and clocks, never "pickup" or "delivery" — so the first stop is where
    // the freight was collected and the rest are where it went. A trip that
    // is really pick-pick-drop-drop will be wrong here and a dispatcher can
    // see it, which is better than a guess dressed as a reading.
    type: index === 0 ? ('PICKUP' as const) : ('DELIVERY' as const),
    locationId: facilities.get(stop.facilityCode)?.id ?? null,
    name: stop.facilityCode,
    referenceNumber: stop.referenceNumber,
    legMiles: stop.legMiles,
    legEmpty: stop.legEmpty,
    // ALL FOUR CLOCKS, WHICH THIS USED TO DISCARD ENTIRELY. The parser reads
    // planned and actual arrival and departure for every stop; the planner
    // carries them; this function returned none of them, so a trips-imported
    // load had no times of any kind — and the ruling that actuals are
    // operative had nothing to be operative over.
    scheduledAt: instantAt(
      stop.plannedArrival,
      facilities.get(stop.facilityCode),
      fallbackZone,
    ),
    arrivedAt: instantAt(
      stop.actualArrival,
      facilities.get(stop.facilityCode),
      fallbackZone,
    ),
    departedAt: instantAt(
      stop.actualDeparture,
      facilities.get(stop.facilityCode),
      fallbackZone,
    ),
  }))
}

// ---------------------------------------------------------------------------
// A MONTH'S FILE DOES NOT FIT IN ONE TRANSACTION, SO IT IS WRITTEN IN CHUNKS.
//
// Owner's ruling, 2026-09-26, first clause: "any row size (a week or a month)".
//
// ── THE ARITHMETIC, WHICH IS WHY THIS IS NOT A GUESS ──────────────────────
//
// `SETTLEMENT_BATCH_TIMEOUT_MS` records the measured cost of a round trip to
// us-east-2: roughly 200ms. One trip costs about ten — `planTripWrite`, the
// crew resolve is shared, `createLoad` and its number allocation, the stop
// rows, `transitionOperational` reading the load, writing the event, updating
// the column and refreshing billing, and the seat update. So:
//
//   152 trips (the 2026-09-24 fixture) × 10 × 200ms ≈ 300 SECONDS
//
// against `LOAD_WRITE_TIMEOUT_MS` of 20. The old single transaction could
// import about ten trips. It was never wrong for an Upcoming file of a dozen,
// which is what it was built for, and it cannot do what the ruling asks.
//
// ── AND CHUNKING IS SAFE HERE FOR A SPECIFIC REASON ───────────────────────
//
// It is not safe in general — a settlement batch must be one transaction,
// because a week where some drivers have statement numbers and others do not is
// not a state anybody can reason about. THIS import is different, and the
// difference is the ruling's own fourth clause: idempotent by trip id. A chunk
// that fails leaves earlier chunks written, and re-uploading the same file
// enriches those to no-ops and carries on. Partial progress that a re-run
// completes beats an all-or-nothing that can never complete at all.
//
// A FAILED CHUNK STILL FAILS THE REQUEST. Nothing here swallows an error to
// keep going: the dispatcher is told, and the fix is to upload the file again.
// ---------------------------------------------------------------------------

/** Trips per transaction. 20 × 10 round trips × 200ms ≈ 40s of the budget. */
export const TRIPS_PER_TRANSACTION = 20

/**
 * One chunk's budget, with room for the slowest link rather than the median.
 *
 * Three times the arithmetic above, because the estimate is per round trip on a
 * good connection and a chunk that runs out mid-write is the one outcome worth
 * paying for — the chunk rolls back whole and the numbers the dispatcher is
 * shown stop matching what landed.
 */
export const TRIPS_IMPORT_TIMEOUT_MS = 120_000

/** The trips one transaction will write, in order. */
export function tripChunks<T>(
  trips: readonly T[],
  size: number = TRIPS_PER_TRANSACTION,
): T[][] {
  const out: T[][] = []
  for (let index = 0; index < trips.length; index += size) {
    out.push(trips.slice(index, index + size))
  }
  return out
}

/** What the file says about one trip's crew, already resolved to ids. */
export interface TripCrew {
  driverId: string | null
  truckId: string | null
}

/**
 * THE CREW, INTO EMPTY SEATS ONLY, ON BOTH WRITE PATHS.
 *
 * Owner's ruling, 2026-09-26. The same posture as everything else in this file:
 * adds what is missing, replaces nothing. A dispatcher who corrected a seat by
 * hand keeps their correction, and re-uploading the file does not undo it —
 * which is what makes the import idempotent in the sense that matters, not just
 * duplicate-free.
 *
 * SHARED, BECAUSE THE TWO PATHS HAVE ALREADY DISAGREED ONCE HERE. `landTripStage`
 * exists for exactly that: the create path wrote the same stops as the enrich
 * path and left the load booked, for a phase, because each had its own copy of
 * one behaviour. One function, called twice.
 *
 * `tx.load.update` AND NOT `updateLoad`, which is the part worth reading twice.
 * `updateLoad` runs `assertAssignable`, and every one of its four rules would
 * refuse a true statement about freight that has already run — see
 * `stageSeatsCrew` for the list and the two rulings behind it. This writes the
 * columns and nothing else.
 *
 * Returns what it wrote, for the enrich path's `added` list, or null.
 */
async function seatCrew(
  tx: TxClient,
  loadId: string,
  trip: PlannedTrip,
  crew: TripCrew | null,
  existing: { hasDriver: boolean; hasTruck: boolean },
): Promise<string | null> {
  if (crew === null) return null
  if (!stageSeatsCrew(trip.stage)) return null

  const seats: { driverId?: string; truckId?: string } = {}
  if (!existing.hasDriver && crew.driverId !== null) {
    seats.driverId = crew.driverId
  }
  if (!existing.hasTruck && crew.truckId !== null) {
    seats.truckId = crew.truckId
  }
  // A `data: {}` update is a round trip that says nothing and still stamps the
  // row as changed for anything watching it.
  if (Object.keys(seats).length === 0) return null

  await tx.load.update({ where: { id: loadId }, data: seats })
  return [seats.driverId ? 'driver' : null, seats.truckId ? 'truck' : null]
    .filter(Boolean)
    .join(' and ')
}

/** Where a landing put the load, and whether the file gave it no date to use. */
export interface TripLanding {
  landed: 'DELIVERED' | 'IN_TRANSIT' | null
  /**
   * The export reported this trip finished and gave no clock to stamp it at.
   *
   * REPORTED RATHER THAN DEFAULTED. See the no-date branch below; the preview
   * counts these so "12 delivered" and "12 completed rows" can differ out loud.
   */
  undated?: boolean
}

/**
 * A finished trip is a load whose POD landed — on whichever path wrote it.
 *
 * ── THE POD, AT THE FILE'S DELIVERY TIME ──────────────────────────────────
 *
 * Owner's ruling, 2026-09-26. The move stays DELIVERED and the POD comes with
 * it, because Relay freight is direct-settled and `transitionOperational` was
 * already written to carry one — see "DELIVERED CARRIES THE POD" there.
 *
 * WHAT WAS WRONG WAS THE DATE, NOT THE TARGET. `podConfirmed` passed no
 * `occurredAt`, and `LoadStatusEvent.occurredAt` defaults to `now()`. So the
 * one event `settleableWhere` reads — an APPLIED POD_RECEIVED inside the period
 * — was stamped at the moment of the upload, while the DELIVERED event beside
 * it carried the file's real clock. A file uploaded on the 26th for freight
 * delivered on the 19th settled that driver in the week of the 26th, after the
 * statement for the right week had gone out, and every screen looked right.
 *
 * FIXED WHERE THE DEFECT WAS rather than routed around: `podConfirmed` now
 * inherits the triggering transition's instant. So this file keeps DELIVERED —
 * which the log needs, because reaching POD with no delivery behind it is a
 * load that was paid for a trip it never finished — and both events carry the
 * same date, which is the one the freight actually has.
 *
 * NOT `POD_RECEIVED` DIRECTLY, which was tried: it produces one event, drops
 * DELIVERED from the log, and makes this importer disagree with the load
 * detail's own timeline about whether the freight ever arrived.
 *
 * THE RUNNING CASE IS UNCHANGED at IN_TRANSIT, which nothing settles on.
 *
 * SHARED, BECAUSE THE TWO PATHS DISAGREED FOR A PHASE. `enrichLoad` read
 * `trip.stage` and moved the load; `createTripLoad` wrote the same four
 * check-ins onto the same four stops and left it BOOKED. So a dispatcher
 * importing yesterday's finished trips got loads that claimed to be booked
 * and appeared to carry Amazon's appointment times — appeared, because the
 * times were on the row all along and `stop-actuals.ts` shows the PLAN on a
 * booked load. Importing the same file a second time moved the status and the
 * check-ins became visible, which read as "the second import added them".
 *
 * That is the same shape as the column two readers named differently: one
 * behaviour, two implementations, and nothing comparing them. It is one
 * function now.
 *
 * `transitionOperational` rather than a column write, so the move is on the
 * event log with a source that says a human did not click it. It refuses a
 * backwards move on its own, so a load already at POD_RECEIVED is safe.
 */
async function landTripStage(
  tx: TxClient,
  loadId: string,
  trip: PlannedTrip,
  rows: readonly TripStopRow[],
  byUserId: string | null,
): Promise<TripLanding> {
  // ── A RUNNING TRIP LANDS IN TRANSIT, AND THAT IS AN ACCEPTED TRADE ───────
  //
  // IF YOU ARE HERE BECAUSE A LOAD SAYS "IN TRANSIT" AND IT HAS ACTUALLY
  // DELIVERED, this is the reasoning and it was accepted knowingly on
  // 2026-09-05 — not an oversight to correct.
  //
  // `In Progress` is 246 of 1,730 trips in the corpus (14.2%), the second most
  // common state after Completed. Until now those landed BOOKED while carrying
  // Amazon's real check-in times, which is the booked-then-ran defect that
  // `deliverFinishedTrip` was written to fix, still open for one stage in
  // three: freight physically mid-route, on the board claiming nobody had
  // dispatched it.
  //
  // THE COST OF THE FIX IS A STALE EXPORT. A file exported this morning says
  // In Progress for a trip that delivered at noon, so the load claims to be
  // moving when it is done. That is wrong. It is LESS wrong than Booked with
  // check-ins on it — which was wrong about both the status and, by implying
  // no departure, about the freight — and the damage is bounded, because
  // `transitionOperational` refuses a backwards move: the next import, or a
  // POD, moves it forward and nothing drags it back.
  //
  // NO FINER STATES. AT_PICKUP / LOADED / AT_DELIVERY are all derivable from
  // the per-leg clocks and none of them is worth having: it would be a second
  // reader of the same rows, free to disagree with the first, for a
  // distinction the Load Tracker collapses into "In-Transit" anyway.
  const target =
    trip.stage === 'finished'
      ? 'DELIVERED'
      : trip.stage === 'running'
        ? 'IN_TRANSIT'
        : null
  if (target === null) return { landed: null }

  const last = rows[rows.length - 1]
  // WHEN IT FINISHED, not when the file was uploaded — the same choice the
  // board importer makes. Departure first, arrival second, nothing third.
  const when = importEventAt({
    deliveryAt: last?.departedAt ?? last?.arrivedAt ?? null,
  })

  // ── NO DATE, NO DELIVERY — AND ONLY FOR THE DELIVERY ────────────────────
  //
  // THIS USED TO BE `...(finishedAt ? { occurredAt: finishedAt } : {})`, which
  // is the exact trap `ImportEventDate` was made a union to prevent:
  // `TransitionOptions.occurredAt` is optional and `LoadStatusEvent.occurredAt`
  // carries `@default(now())`, so a missing date did not fail — it silently
  // wrote the event the ruling forbids, dated at the import, and the load's
  // money landed in whatever week the file happened to be uploaded in.
  //
  // A DELIVERED load with no date therefore stays at its floor status: visibly
  // not delivered, which somebody can see and fix, rather than settleable in the
  // wrong week.
  //
  // IN TRANSIT MOVES EITHER WAY, and the asymmetry is the whole reason this is
  // not one rule. A running trip has NOT ARRIVED — that is what running means —
  // so its last stop carries no clock by construction, and refusing the move
  // would put every in-progress trip in the file back on the board as Booked.
  // Nothing settles on IN_TRANSIT; no date is money there. Written as one rule
  // this refused 246 of 1,730 corpus trips, which is how the integration suite
  // found it.
  if (when.kind === 'no-date' && target === 'DELIVERED') {
    return { landed: null, undated: true }
  }

  const outcome = await transitionOperational(tx, loadId, target, {
    source: 'INTEGRATION',
    userId: byUserId,
    // Only when there is one. A load with no recorded time still moves to
    // IN_TRANSIT, it just carries no instant — see the branch above.
    ...(when.kind === 'at' ? { occurredAt: when.at } : {}),
    // The note says what the FILE reported, not what we concluded from it.
    // A reader auditing a wrong status needs to know which of the two was
    // wrong, and only one of them is recoverable from the row.
    note:
      target === 'DELIVERED'
        ? `Relay trips export reports ${trip.tripId} completed`
        : `Relay trips export reports ${trip.tripId} in progress`,
  })
  return { landed: outcome.result === 'moved' ? target : null }
}

/**
 * Book a trip that no load carries yet.
 *
 * IT LIVES HERE RATHER THAN IN THE SERVER ACTION, and that is the whole
 * lesson of the bug that produced it. The create half used to be inline in
 * `actions.ts` — a 'use server' file no test can call — where it mapped
 * `stopRowsForTrip`'s output by hand into `createLoad`'s stop shape and got
 * the key wrong: `place` instead of `name`. TypeScript does not flag an
 * excess property on a literal returned from a `.map()` callback, so it
 * typechecked, linted, passed 1,112 unit tests and 405 integration tests, and
 * would have written every stop with no name at all. The same hand-mapping
 * dropped `legMiles` and `legEmpty`, which is the entire point of the
 * migration that added them.
 *
 * `enrichLoad` beside it never had the bug, because it spreads the row whole.
 * The difference was not care; it was that one path had a function to test and
 * the other had a screen.
 *
 * NO MONEY IS PASSED. Rule 6, and there is nothing to pass: the parser never
 * read a cost.
 */
export async function createTripLoad(
  tx: TxClient,
  organizationId: string,
  input: TripWriteInput,
  facilities: ReadonlyMap<string, ResolvedFacility>,
  byUserId: string | null = null,
): Promise<TripWriteOutcome> {
  const rows = stopRowsForTrip(input.trip, facilities)

  // THE `: StopInput` ON THE CALLBACK IS THE GUARD, AND ITS POSITION IS THE
  // WHOLE TRICK. Annotating the VARIABLE — `const stops: StopInput[] = ...` —
  // does nothing: excess-property checking does not reach a literal returned
  // from a `.map()` callback, which is precisely why `place` survived review,
  // typecheck, lint, 1,112 unit tests and 405 integration tests. Measured, not
  // assumed: with the variable annotation alone, reintroducing `place`
  // still compiled clean; with the RETURN annotation it fails as TS2353.
  //
  // Both annotations are kept. The variable one documents the intent, the
  // callback one enforces it.
  // SPREAD, NOT RESTATED — and the return annotation stays.
  //
  // Measured, because both halves of that sentence are load-bearing: a SPREAD
  // property is not excess-property-checked, so `sequence` passes through
  // harmlessly and no field can be forgotten; an explicitly written unknown key
  // still fails TS2353 under `(row): StopInput`. Verified both ways before this
  // was written.
  //
  // The read-back tests in tests/integration/trips-import.test.ts are the other
  // half: types cannot notice a field that stops being PRODUCED, only one that
  // is misspelled on arrival.
  const stops: StopInput[] = rows.map((row): StopInput => ({ ...row }))

  const load = await createLoad(tx, organizationId, {
    companyId: input.companyId,
    customerId: input.customerId,
    referenceNumber: input.trip.tripId,
    ...(input.trip.totalMiles === null
      ? {}
      : { dispatchedMiles: String(input.trip.totalMiles) }),
    // THE RATE, ONLY IF THE PLANNER CALLED IT ONE. Null is OMITTED rather than
    // sent as zero, because a dispatcher must not be able to read an import as
    // a rate of nothing. The per-leg costs never reach this object, so there is
    // still no allocation reachable from here: `planTrips` either added the
    // legs up and labelled the sum, or the value does not exist.
    ...(input.rateCents === null ? {} : { linehaulCents: input.rateCents }),
    stops,
  })

  // AND THE STAGE THE PLANNER ALREADY READ. A Completed export imported with
  // no earlier pass behind it is a delivered load on the FIRST import; needing
  // a second one to reach the right state made the file a two-step ritual and
  // put freight on the board claiming to be booked.
  const landing = await landTripStage(tx, load.id, input.trip, rows, byUserId)

  // ── THE SEATS GO ON AFTER THE LANDING, AND THE ORDER IS THE POINT ────────
  //
  // `createLoad` above is called with NO crew, deliberately: it runs
  // `assertAssignable`, which is right about a plan and wrong about a
  // completed row (see `stageSeatsCrew`). So the load is created empty, landed,
  // and seated after.
  //
  // AFTER rather than before, because a BOOKED load carrying a driver is an
  // overlapping load as far as the NEXT trip's `createLoad` is concerned —
  // `findAssignmentConflicts` excludes DELIVERED and POD_RECEIVED and nothing
  // else. Seating before landing would make a driver's second trip in the file
  // refuse their first, and the refusal would take the whole transaction with
  // it.
  const seated = await seatCrew(tx, load.id, input.trip, input.crew ?? null, {
    hasDriver: false,
    hasTruck: false,
  })

  return {
    kind: 'created',
    loadId: load.id,
    tripId: input.trip.tripId,
    stops: stops.length,
    landed: landing.landed,
    ...(landing.undated ? { undated: true } : {}),
    ...(seated === null ? {} : { seated }),
  }
}

/**
 * EVERYTHING THE DECISION KNOWS ABOUT A LOAD THE FILE ALREADY MATCHED.
 *
 * ── ONE TYPE, BECAUSE THE RESTATEMENT HAS ALREADY COST THIS FILE THREE FIELDS ─
 *
 * `enrichLoad` used to take an anonymous object and every caller built it by
 * hand — `{ hasStops: write.hasStops, hasMiles: write.hasMiles, ... }`, eleven
 * times over the action and the integration suite. That is the same shape as
 * the hand-mapped stop rows two hundred lines up, which lost `place` for
 * `name`, `legMiles`, `legEmpty` and all four clocks: a field ADDED to the
 * decision is silently absent from every restatement, and the only thing that
 * notices is a test that reads the column back.
 *
 * Named, the decision is passed whole and the compiler names anyone who does
 * not. `planTripWrite` returns it with `action` and `loadId` beside it, and a
 * caller hands that straight to `enrichLoad`.
 */
export interface TripEnrichFacts {
  hasStops: boolean
  hasMiles: boolean
  hasRate: boolean
  /** Any stop already carries a check-in. */
  hasActuals: boolean
  /** Already at or past DELIVERED, so nothing here may move it. */
  isDelivered: boolean
  /**
   * Somebody said this freight is not happening.
   *
   * An import must not touch it AT ALL. Before this, only the status move
   * was refused — by `transitionOperational`, which protects itself — while
   * the stop times, the mileage and the rate wrote straight through. So a
   * cancelled load quietly gained figures from a file while the preview
   * promised the one change that was going to be refused.
   */
  isCancelled: boolean
  /**
   * CLOSED HISTORY, WHICH AN IMPORT MAY NOT TOUCH AT ALL.
   *
   * Owner's ruling, 2026-09-26: "closed history untouched." A bulk file
   * covers a month, and a month reaches back over `BOOKS_CUTOVER` into the
   * 14,345 loads Datatruck delivered, billed and was paid for. Every one of
   * those is freight this system was not present for.
   *
   * `billingStatus = CLOSED_IN_DATATRUCK` is the marker, and it is the
   * billing axis that says so rather than a date or an `externalId` — the
   * same predicate `NOT_CLOSED_HISTORY` uses, so a load somebody
   * legitimately reopens stops being closed and starts being importable,
   * which falls out of asking the status instead of asking where the row
   * came from.
   *
   * WITHOUT THIS, a trips file naming an old trip would write stop times
   * over settled freight and stamp a POD_RECEIVED event on it — and that
   * event is what `settleableWhere` reads, so a load paid for a year ago in
   * another system would appear in a driver's settleable set for this week.
   */
  isClosedHistory: boolean
  /** Somebody already put a driver in the seat. Enrichment never moves it. */
  hasDriver: boolean
  /** Same for the truck. */
  hasTruck: boolean
}

/**
 * What writing this trip would do, decided before anything is written.
 *
 * Separated so the preview and the write agree by construction: the sentence a
 * dispatcher confirms is produced by the same function that later acts.
 */
export async function planTripWrite(
  tx: TxClient,
  trip: PlannedTrip,
): Promise<
  | { action: 'create' }
  | ({ action: 'enrich'; loadId: string } & TripEnrichFacts)
> {
  const existing = await tx.load.findFirst({
    // EXACT. No prefix stripping, no case folding, no trimming beyond what the
    // parser already did.
    where: { referenceNumber: trip.tripId, deletedAt: null },
    select: {
      id: true,
      dispatchedMiles: true,
      linehaulCents: true,
      operationalStatus: true,
      isCancelled: true,
      billingStatus: true,
      driverId: true,
      truckId: true,
      _count: { select: { stops: true } },
      // THE LIFECYCLE THIS EXISTS FOR. A trip imported from an Upcoming export
      // has stops and mileage and no check-ins; the same trip exported after it
      // runs is the ONLY place the check-ins live. Counting stops alone made
      // the second file read as "already complete", so the actual times could
      // never reach a load that had been booked first — which is the normal
      // order of events, not an edge case.
      stops: {
        where: { arrivedAt: { not: null } },
        select: { id: true },
        take: 1,
      },
    },
  })

  if (!existing) return { action: 'create' }

  return {
    action: 'enrich',
    loadId: existing.id,
    hasStops: existing._count.stops > 0,
    hasMiles: existing.dispatchedMiles !== null,
    // ZERO IS "NO RATE YET" HERE, and it has to be: `linehaulCents` is
    // `@default(0)`, so a load booked from an email that carried no money is
    // indistinguishable from one deliberately booked at nothing. Treating 0 as
    // absent is what lets the import ADD a rate; treating it as a real figure
    // would mean no enrich ever fills one. A load with an actual rate is
    // untouched either way, which is the half that matters.
    hasRate: existing.linehaulCents !== 0,
    hasActuals: existing.stops.length > 0,
    isCancelled: existing.isCancelled,
    isClosedHistory: existing.billingStatus === 'CLOSED_IN_DATATRUCK',
    hasDriver: existing.driverId !== null,
    hasTruck: existing.truckId !== null,
    isDelivered:
      existing.operationalStatus === 'DELIVERED' ||
      existing.operationalStatus === 'POD_RECEIVED',
  }
}

/**
 * Add to a load the email already created.
 *
 * ADDS WHAT IS MISSING, REPLACES NOTHING. A load that already has stops keeps
 * them; a load that already has mileage keeps it. What comes back names what
 * changed, so a preview can say "adds stops and miles" rather than "enriches",
 * which is a word that hides whether anything happened.
 */
export async function enrichLoad(
  tx: TxClient,
  organizationId: string,
  loadId: string,
  trip: PlannedTrip,
  facilities: ReadonlyMap<string, ResolvedFacility>,
  // THE DECISION, WHOLE. `planTripWrite`'s return goes straight in — see
  // `TripEnrichFacts` for what restating it field by field has already cost.
  existing: TripEnrichFacts,
  rateCents: number | null = null,
  byUserId: string | null = null,
  /** Null on a trip the file gave no usable crew for, or refused. */
  crew: TripCrew | null = null,
): Promise<TripWriteOutcome> {
  // A CANCELLED LOAD IS NOT ENRICHED, AT ALL.
  //
  // Somebody looked at this freight and said it is not happening. An import
  // arriving afterwards has nothing to add to that — and the half-write it
  // used to perform was the worst available outcome: mileage and rate went in,
  // the status move was refused by `transitionOperational`, and the preview
  // had promised exactly the part that got refused.
  //
  // FIRST, BEFORE ANY WRITE, so this cannot become "refuses some of it".
  if (existing.isCancelled) {
    return {
      kind: 'unchanged',
      loadId,
      tripId: trip.tripId,
      reason: 'the load is cancelled',
    }
  }

  // ── AND NEITHER IS CLOSED HISTORY ───────────────────────────────────────
  //
  // BEFORE ANY WRITE, for the same reason the cancelled check is: a guard that
  // runs after the first update is a guard against half of the damage. See
  // `isClosedHistory` on `planTripWrite` for what the other half would have
  // been — a POD_RECEIVED event on freight another system settled a year ago,
  // which is the one event a settlement selects on.
  if (existing.isClosedHistory) {
    return {
      kind: 'unchanged',
      loadId,
      tripId: trip.tripId,
      reason: 'the load is closed history',
    }
  }

  const added: string[] = []

  if (!existing.hasStops && trip.stops.length > 0) {
    const rows = stopRowsForTrip(trip, facilities)
    await tx.loadStop.createMany({
      data: rows.map((row) => ({ ...row, loadId, organizationId })),
    })
    added.push(`${rows.length} stops`)
  }

  if (!existing.hasMiles && trip.totalMiles !== null) {
    await tx.load.update({
      where: { id: loadId },
      data: {
        dispatchedMiles: trip.totalMiles,
        // Only alongside the miles it is a share of. An empty figure with no
        // total to sit inside is a number without a denominator.
        ...(trip.emptyMiles === null ? {} : { emptyMiles: trip.emptyMiles }),
      },
    })
    added.push(`${trip.totalMiles} miles`)
  }

  const seated = await seatCrew(tx, loadId, trip, crew, existing)
  if (seated !== null) added.push(seated)

  // THE RATE, ADDED AND NEVER REPLACED. A load that already carries money keeps
  // it: the booking email is the contract and this file is a courier. `null`
  // covers both "the trip is multi-leg" and "the importer may not see money",
  // and neither is a reason to write zero over anything.
  if (!existing.hasRate && rateCents !== null) {
    await tx.load.update({
      where: { id: loadId },
      data: { linehaulCents: rateCents },
    })
    // The cached total is owned by this function, not written by hand — a
    // linehaul changed without it leaves `totalRevenueCents` stale, which is
    // the figure invoices read.
    await recomputeTotals(tx, loadId)
    added.push('rate')
  }

  // ---------------------------------------------------------------------------
  // THE ACTUALS, ONTO STOPS THAT ALREADY EXIST.
  //
  // THE LIFECYCLE: dispatch imports the trip from an Upcoming export to get it
  // on the board, then the trip runs, then the same trip is exported again as
  // Completed. Only the second file has the check-ins. Because the first
  // import had already written stops and mileage, the second read as "already
  // complete" and wrote nothing — so a load booked first, which is the normal
  // order, could never receive the times it actually ran to.
  //
  // FILLED, NEVER OVERWRITTEN. Only a stop whose `arrivedAt` is null is
  // touched, which keeps this the same promise the rest of the function makes:
  // it adds what is missing. A stop somebody corrected by hand stays corrected.
  //
  // MATCHED ON SEQUENCE AND FACILITY, BOTH. Sequence alone would write MEM4's
  // check-in onto HME9 if the chain ever changed between the two exports, and
  // that is a wrong time presented as a record — the exact thing this whole
  // area exists to prevent. A stop that does not match on both is left alone.
  // Resolved once: the clocks are already instants on these rows, in the
  // stop's own zone. Nothing below re-derives a time.
  const actualRows = stopRowsForTrip(trip, facilities)

  if (!existing.hasActuals) {
    const current = await tx.loadStop.findMany({
      where: { loadId },
      select: { id: true, sequence: true, name: true, arrivedAt: true },
      orderBy: { sequence: 'asc' },
    })

    let filled = 0
    for (const row of actualRows) {
      if (row.arrivedAt === null && row.departedAt === null) continue
      const match = current.find(
        (stop) =>
          stop.sequence === row.sequence &&
          stop.name === row.name &&
          stop.arrivedAt === null,
      )
      if (!match) continue
      await tx.loadStop.update({
        where: { id: match.id },
        data: { arrivedAt: row.arrivedAt, departedAt: row.departedAt },
      })
      filled += 1
    }

    if (filled > 0) added.push(`${filled} actual time(s)`)
  }

  // AND THE STATUS THE EXPORT REPORTS. A finished trip is a delivered load, and
  // leaving it BOOKED means it never reaches the invoice queue or a settlement.
  //
  // THE SAME FUNCTION THE CREATE PATH CALLS. `deliverFinishedTrip` used to be
  // written out here and nowhere else, which is how the create path came to
  // write identical stops and leave the load booked. The `isDelivered` check
  // stays here rather than moving inside it: it keeps the PREVIEW honest about
  // whether there is a move to make, and `transitionOperational` refuses a
  // backwards move on its own regardless.
  let undated = false
  if (!existing.isDelivered) {
    const landing = await landTripStage(tx, loadId, trip, actualRows, byUserId)
    if (landing.landed === 'DELIVERED') added.push('delivered')
    else if (landing.landed === 'IN_TRANSIT') added.push('in transit')
    undated = landing.undated === true
  }

  if (added.length === 0) {
    return {
      kind: 'unchanged',
      loadId,
      tripId: trip.tripId,
      // A FINISHED TRIP WITH NO CLOCK GETS ITS OWN SENTENCE. It produced no
      // write, so it is genuinely unchanged — but "already has its stops,
      // mileage and times" would be a false account of why, and the fix for
      // the two cases is different: one needs nothing, the other needs a file
      // that carries a delivery time.
      reason: undated
        ? 'the export reports it completed and carries no delivery time'
        : 'the load already has its stops, mileage and times',
    }
  }

  return {
    kind: 'enriched',
    loadId,
    tripId: trip.tripId,
    added,
    ...(undated ? { undated: true } : {}),
  }
}

/**
 * The codes the book knows but has no street for.
 *
 * TWO DIFFERENT PROBLEMS, AND THIS IS THE QUIETER ONE. A code with no row at
 * all is already surfaced: the import writes the code as the stop's name and
 * the preview lists it as unresolved. A code the book HAS, with no address on
 * it, resolves cleanly — the stop links to a real facility, the load looks
 * complete, and a driver is sent to a code nobody has a street for. MEM4-DRAY
 * on load 1013 is exactly that, and nothing on any screen said so.
 *
 * IT LIVES HERE RATHER THAN IN THE SERVER ACTION so it can be tested; flag 85
 * again. The action reads a map and shows a sentence, and neither of those is
 * where the judgement is.
 */
export function facilitiesMissingAddress(
  codes: readonly string[],
  facilities: ReadonlyMap<string, ResolvedFacility>,
): string[] {
  return codes.filter((code) => {
    const facility = facilities.get(code)
    // Absent from the book is NOT this condition — it is the other one, and
    // reporting a code under both headings would double-count the same stop.
    return facility !== undefined && facility.addressLine1 === null
  })
}
