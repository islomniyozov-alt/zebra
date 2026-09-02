import { createLoad, recomputeTotals, type StopInput } from './loads'
import { transitionOperational } from './load-status'
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
//   * MONEY. Never. The rate came from the email or it is absent, and
//     `Estimated Cost` was never parsed in the first place (rule 6).
//   * A stop chain somebody has already edited. If the load has stops, the
//     trip's stops are not written over them — a dispatcher who fixed an
//     address should not find it replaced by an import an hour later.
//   * driver or truck. Rule 7: the CSV's names are informational until
//     name-matching is its own ruled feature.
//
// SO ENRICHMENT ADDS WHAT WAS MISSING and leaves what exists. That is the only
// posture under which running an import twice is safe, and running it twice is
// what will happen.
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
}

export type TripWriteOutcome =
  | { kind: 'created'; loadId: string; tripId: string; stops: number }
  | { kind: 'enriched'; loadId: string; tripId: string; added: string[] }
  | { kind: 'unchanged'; loadId: string; tripId: string; reason: string }

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
    // THE RATE, ONLY IF THE PLANNER CALLED IT ONE. `rateCents` is null for
    // every multi-leg trip by construction, so there is no allocation reachable
    // from here — and null is OMITTED rather than sent as zero, because a
    // dispatcher must not be able to read an import as a rate of nothing.
    ...(input.rateCents === null ? {} : { linehaulCents: input.rateCents }),
    stops,
  })

  return {
    kind: 'created',
    loadId: load.id,
    tripId: input.trip.tripId,
    stops: stops.length,
  }
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
  | {
      action: 'enrich'
      loadId: string
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
    }
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
  existing: {
    hasStops: boolean
    hasMiles: boolean
    hasRate: boolean
    hasActuals: boolean
    isDelivered: boolean
    isCancelled: boolean
  },
  rateCents: number | null = null,
  byUserId: string | null = null,
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
  // `transitionOperational` rather than a column write, so the move is on the
  // event log with a source that says a human did not click it. It refuses a
  // backwards move on its own, so a load already at POD_RECEIVED is safe; the
  // `isDelivered` check is there to keep the preview honest rather than to
  // protect the write.
  if (trip.stage === 'finished' && !existing.isDelivered) {
    const last = actualRows[actualRows.length - 1]
    // WHEN IT FINISHED, not when the file was uploaded — the same choice the
    // board importer makes. Departure first, arrival second, nothing third:
    // a load with no recorded time still moves, it just carries no instant.
    const finishedAt = last?.departedAt ?? last?.arrivedAt ?? null
    const outcome = await transitionOperational(tx, loadId, 'DELIVERED', {
      source: 'INTEGRATION',
      userId: byUserId,
      ...(finishedAt ? { occurredAt: finishedAt } : {}),
      note: `Relay trips export reports ${trip.tripId} completed`,
    })
    if (outcome.result === 'moved') added.push('delivered')
  }

  if (added.length === 0) {
    return {
      kind: 'unchanged',
      loadId,
      tripId: trip.tripId,
      reason: 'the load already has its stops, mileage and times',
    }
  }

  return { kind: 'enriched', loadId, tripId: trip.tripId, added }
}
