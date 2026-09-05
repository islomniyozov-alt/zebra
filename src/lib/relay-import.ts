import type { TxClient } from './tenancy'
import type { RelayClock, RelayStop, RelayTrip } from './relay-csv'
import { type LoadWarning, loadWarnings } from './load-warnings'
import { createLoad } from './loads'
import { transitionOperational } from './load-status'
import { resolveLocation } from './locations'
import { renderStopTime, zoneOffsetHours, zoneWallClock } from './stop-time'

// ---------------------------------------------------------------------------
// A RELAY EXPORT, AS LOADS (Phase 6 §3a).
//
// TWO MODES, WHICH ARE DATATRUCK'S TWO BUTTONS. `booked` takes upcoming trips
// and books them from the PLANNED times; `delivered` takes history and lands
// it already run, from the ACTUAL times. They are not a filter on one import
// — they read different columns and end in different states, and a file of
// finished trips imported as booked would put freight on the dispatch board
// that was delivered last week.
//
// PLAN, THEN WRITE, AND THE PLAN IS SHOWN FIRST. Phase 5 §1 settled that a
// single prefill does NOT get a review screen — the form IS the review. That
// ruling governed one load a dispatcher is looking at. Forty-five loads
// written by one click is a different act: nobody can review what they cannot
// see, and the thing being confirmed is the SET. So this file separates
// `planRelayImport` (reads only, writes nothing) from `importRelayLoad`, and
// the screen shows the first before it is allowed to call the second.
//
// ONE TRANSACTION PER LOAD, NOT ONE PER IMPORT. A create is ~31 statements
// (loads.ts) and Prisma's ceiling is a wall-clock timeout: forty-five of them
// in one interactive transaction cannot finish, on any connection. Phase 5
// flag 31's rule is "fewer statements inside the lock, not a longer lock", and
// the smallest honest lock here is one load.
//
// The cost is that an import can end PARTLY DONE. That is reported rather than
// hidden — the result names what was created and what failed — and it is the
// right trade: each row is a separate piece of freight, and a file where row
// 40 is malformed should still have booked rows 1 to 39.
// ---------------------------------------------------------------------------

export type ImportMode = 'booked' | 'delivered'

/**
 * The customer imported freight is booked under.
 *
 * A CONSTANT, not a typed field. Every row of a Relay export is Amazon's, the
 * `Sub Carrier` column is Amazon's code for US (`AZNG`, `AZNU`) rather than
 * for them, and letting the importer type a customer name would be a way to
 * get one authority's Amazon freight filed under "amazon relay " with a
 * trailing space.
 */
export const RELAY_CUSTOMER_NAME = 'Amazon Relay'

/**
 * Where a stop with no offset and no recorded facility is assumed to be.
 *
 * The same constant the create form uses, and the same admission: it is a
 * fallback, not an answer. `refuse` skips a stop with no offset column
 * precisely so this is almost never reached.
 */
export const COMPANY_FALLBACK_ZONE = 'America/Chicago'

export type RowRefusal =
  | 'no_load_id'
  | 'too_few_stops'
  | 'missing_offset'
  | 'window_inverted'
  // 'not_completed' and 'no_actual_times' were here until 2026-09-05. Nothing
  // can produce them any more: a row that does not qualify as delivered is
  // BOOKED rather than refused, so the two reasons a whole-file mode used to
  // reject freight for no longer exist. See `landsDelivered`.
  | 'repeated_in_file'

export interface PlannedStop {
  type: 'PICKUP' | 'DELIVERY' | 'INTERMEDIATE'
  facility: string
  /** The export's static standard-time offset, kept for the cross-check. */
  utcOffsetHours: number | null
  /** The IANA zone every clock on this stop was read in. See `zoneForRelayStop`. */
  zone: string
  scheduledAt: Date | null
  windowStart: Date | null
  windowEnd: Date | null
  arrivedAt: Date | null
  departedAt: Date | null
  containerId: string | null
}

export interface PlannedLoad {
  rowNumber: number
  /** Amazon's Load ID. Becomes `referenceNumber`, and is the duplicate key. */
  loadId: string
  /** `FOE1 → MCI4`, for the preview. */
  lane: string
  stops: PlannedStop[]
  distanceMiles: number | null
  /**
   * Null when the role may not see money — §1.3, and the same rule the create
   * form follows. Not zero: zero is a rate, and a dispatcher must not be shown
   * a money column at all.
   */
  costCents: number | null
  /** What lands in `dispatcherNotes`. See `tripNote`. */
  note: string
  /** Every warning this row would raise, each naming its record. */
  warnings: LoadWarning[]
  /**
   * Where THIS row lands, read from its own `Load Execution Status`.
   *
   * PER LOAD, NOT PER FILE, and that is the point of the field existing. The
   * plan used to carry one `mode` for everything in it, which is a claim about
   * a file that a file is not entitled to make: a Relay export routinely holds
   * finished and unfinished freight together.
   */
  delivered: boolean
}

export interface SkippedRow {
  rowNumber: number
  /** May be null — a row with no Load ID is exactly why. */
  loadId: string | null
  reason: RowRefusal
}

export interface ImportPlan {
  customerName: string
  /** False when the customer exists and is NOT set to settle directly. */
  settlesDirectly: boolean
  /** True when this import would create the customer row. */
  customerIsNew: boolean
  create: PlannedLoad[]
  skip: SkippedRow[]
}

/**
 * What this file would create, without creating any of it.
 *
 * READS ONLY. Called to render the preview and called AGAIN on confirm, and
 * the second call is the point: a plan is only allowed through if it still
 * looks exactly like the one that was shown. See `planSignature`.
 */
export async function planRelayImport(
  tx: TxClient,
  input: {
    trips: RelayTrip[]
    /** `load.financials:update`. Decides whether money is in the plan at all. */
    maySeeMoney: boolean
    /** Where a stop with no offset and no recorded facility is assumed to be. */
    fallbackZone?: string
  },
): Promise<ImportPlan> {
  const fallbackZone = input.fallbackZone ?? COMPANY_FALLBACK_ZONE

  const customer = await tx.customer.findFirst({
    where: {
      name: { equals: RELAY_CUSTOMER_NAME, mode: 'insensitive' },
      deletedAt: null,
    },
    select: { id: true, settlesDirectly: true },
  })

  // EVERY FACILITY THIS FILE MENTIONS, IN ONE QUERY, so a dispatcher's recorded
  // zone beats the offset column's zone family (`zoneForRelayStop` source 1).
  // One `findMany` rather than a lookup per stop: the plan runs on every
  // keystroke of a preview and a forty-five-row file has ninety stops.
  const facilities = await tx.location.findMany({
    where: {
      name: {
        in: [
          ...new Set(
            input.trips.flatMap((trip) =>
              trip.stops.map((stop) => stop.facility),
            ),
          ),
        ],
      },
      deletedAt: null,
    },
    select: { name: true, timezone: true },
  })
  // Lower-cased, because `resolveLocation` matches case-insensitively and a
  // map that did not would miss the very row the import is about to reuse.
  const recorded = new Map(
    facilities.map((place) => [place.name.toLowerCase(), place.timezone]),
  )

  const create: PlannedLoad[] = []
  const skip: SkippedRow[] = []
  const seen = new Set<string>()

  for (const trip of input.trips) {
    const refusal = refuse(trip, seen)
    if (refusal) {
      skip.push({
        rowNumber: trip.rowNumber,
        loadId: trip.loadId,
        reason: refusal,
      })
      continue
    }
    // Non-null by construction: `refuse` returns 'no_load_id' otherwise.
    const loadId = trip.loadId!
    seen.add(loadId.toLowerCase())

    // THE ROW DECIDES, NOT THE FILE. See `landsDelivered`.
    const delivered = landsDelivered(trip)

    const stops = trip.stops.map((stop, index) =>
      plannedStop(
        stop,
        index,
        trip.stops.length,
        delivered ? 'delivered' : 'booked',
        zoneForRelayStop(
          recorded.get(stop.facility.toLowerCase()) ?? null,
          stop.utcOffsetHours,
          fallbackZone,
        ),
      ),
    )
    const costCents = input.maySeeMoney ? (trip.costCents ?? 0) : null

    const warnings = await loadWarnings(tx, {
      customerId: customer?.id ?? '',
      customerName: RELAY_CUSTOMER_NAME,
      // The export carries neither. Passed as null rather than mapped onto
      // the Load ID: a BOL warning about something that is not a BOL trains
      // the office to click through warnings, which is what makes the real
      // ones worthless.
      bolNumber: null,
      poNumber: null,
      referenceNumber: loadId,
      pickupAt: stops[0]?.scheduledAt ?? null,
      deliveryAt: stops[stops.length - 1]?.scheduledAt ?? null,
      // No addresses exist in this export, so the broker+date+lane duplicate
      // check has nothing to compare and returns nothing. The Load ID check
      // is the one that matters here and it is exact.
      pickup: { city: null, state: null },
      delivery: { city: null, state: null },
      linehaulCents: costCents,
    })

    // FLAG 14'S CROSS-CHECK, ONE PER STOP THAT FAILS IT. Not a refusal: the
    // load is importable and the times are the best reading available. It is a
    // sentence naming the facility, both offsets and the zone the clocks were
    // read in, so somebody can say "AGS1 is not in Central" and fix it on the
    // facility — which is source 1 of `zoneForRelayStop` and makes every later
    // import of that dock right.
    for (const stop of stops) {
      if (!offsetDisagrees(stop.scheduledAt, stop.zone, stop.utcOffsetHours)) {
        continue
      }
      warnings.push({
        kind: 'offset_disagrees',
        messageKey: 'loads.warn.offsetDisagrees',
        values: {
          facility: stop.facility,
          zone: stop.zone,
          column: String(stop.utcOffsetHours),
          actual: String(zoneOffsetHours(stop.scheduledAt!, stop.zone)),
        },
      })
    }

    create.push({
      rowNumber: trip.rowNumber,
      loadId,
      lane: `${trip.stops[0]!.facility} → ${trip.stops[trip.stops.length - 1]!.facility}`,
      stops,
      distanceMiles: trip.distanceMiles,
      costCents,
      note: tripNote(trip),
      warnings,
      delivered,
    })
  }

  return {
    customerName: RELAY_CUSTOMER_NAME,
    // A customer that does not exist yet will be created settling directly,
    // so the answer for a new one is yes.
    settlesDirectly: customer?.settlesDirectly ?? true,
    customerIsNew: customer === null,
    create,
    skip,
  }
}

/**
 * Why this row cannot be imported, or null.
 *
 * EVERY REFUSAL IS A ROW, NOT THE FILE. A trip that is half-finished sits in
 * the same export as four that are done, and refusing the whole import over it
 * is how somebody ends up pasting rows into a second file.
 */
function refuse(trip: RelayTrip, seen: Set<string>): RowRefusal | null {
  if (!trip.loadId) return 'no_load_id'
  // ONE FILE, TWO ROWS, ONE LOAD ID. Not the same as the duplicate WARNING,
  // which is about freight already in the database and is a sentence in front
  // of a confirm. This is the file contradicting itself, and importing both
  // would create two loads nothing could later tell apart.
  if (seen.has(trip.loadId.toLowerCase())) return 'repeated_in_file'

  // `createLoad` refuses fewer than two stops and it is right to: a load is a
  // movement between places.
  if (trip.stops.length < 2) return 'too_few_stops'

  for (const stop of trip.stops) {
    // A STOP WITH NO OFFSET HAS NO ZONE TO BE READ IN.
    //
    // It stopped meaning "no instant can be computed" when flag 14 was settled
    // — the printed clocks are still perfectly readable without it — and it
    // still means the facility cannot be placed. With no offset and no
    // recorded `Location.timezone`, every clock on the stop would fall back to
    // the company's zone, which is a guess about somewhere that could be three
    // hours away. Skipped and named, rather than imported an hour or three out.
    if (stop.utcOffsetHours === null) return 'missing_offset'

    // Caught here rather than in `writeStops`, which throws and would take the
    // whole transaction — and, more to the point, would surface as a failure
    // AFTER the confirm rather than as a skipped row in the preview.
    //
    // COMPARED AS CLOCK FACES, not as instants, and it is exact: both readings
    // are at the SAME facility, so they share a zone whatever that zone turns
    // out to be, and the comparison does not need one.
    if (
      stop.plannedArrival &&
      stop.plannedDeparture &&
      clockBefore(stop.plannedDeparture, stop.plannedArrival)
    ) {
      return 'window_inverted'
    }
  }

  return null
}

/**
 * Does THIS ROW land delivered? Read from the row, never from a radio button.
 *
 * THE MODE QUESTION IS GONE AND THIS IS WHAT REPLACED IT. The screen used to
 * ask "Upcoming or Finished?" for a whole file, apply it to every row, and
 * SKIP the rows that disagreed — so a mixed file imported under the wrong
 * answer silently dropped freight, and under the right answer dropped the
 * other half. Four bad imports came from that question being asked at all.
 *
 * `Load Execution Status` is per LOAD; `Trip Stage` is per trip, and a trip
 * can be 'In Transit' while its first load is 'Completed'. The corpus has
 * exactly that row, which is why this reads the load's own column.
 *
 * A ROW THAT FAILS THESE CHECKS IS BOOKED, NOT SKIPPED. That is the whole
 * change: "Completed" with no actual times on its last stop is not a delivered
 * load — landing it delivered would put a POD-less load into billing — but it
 * is still perfectly good freight, and the old code threw it away for
 * disagreeing with a radio button. Downgrading keeps the load and keeps the
 * safety property.
 *
 * ── THE OVERRIDE IS GONE, DELIBERATELY, AND HERE IS WHAT REPLACED IT ──────
 *
 * The office can no longer import a Completed row as merely Booked. That was a
 * real capability and it is not coming back by accident, so: it was removed on
 * 2026-09-05, knowingly, and this is the reasoning.
 *
 * THE RADIO NEVER CARRIED KNOWLEDGE THE FILE LACKED. It recorded which button
 * somebody clicked, and every row in the file already stated its own execution
 * status — from Amazon, about Amazon's own freight. An import that disagreed
 * with that was never the honest shape: it was a screen asserting a fact about
 * a trip it had never seen, against the system that ran it.
 *
 * WHAT IT COST WHEN IT DISAGREED. Four bad imports came from the question
 * being asked at all, and the worse half was silent: under "Finished" every
 * unfinished row was SKIPPED, so a mixed file lost freight without saying so
 * loudly enough to notice. Nothing here can do that now — every row lands
 * somewhere.
 *
 * AND THE GENUINE NEED SURVIVES, somewhere better. Holding a finished load at
 * Booked is a status change on the load screen, where `transitionOperational`
 * writes it to the event log as a human decision with a name against it —
 * rather than an import-time preference that leaves a load looking as though
 * Amazon had said so.
 */
function landsDelivered(trip: RelayTrip): boolean {
  if ((trip.executionStatus ?? '').toLowerCase() !== 'completed') return false
  const last = trip.stops[trip.stops.length - 1]
  if (!last) return false
  return Boolean(last.actualArrival || last.actualDeparture)
}

/** Is `a` earlier on the clock than `b`? Same facility, so the zone cancels. */
function clockBefore(a: RelayClock, b: RelayClock): boolean {
  if (a.date !== b.date) return a.date < b.date
  return a.hour * 60 + a.minute < b.hour * 60 + b.minute
}

/**
 * One stop, in the mode's own times.
 *
 * TYPE BY POSITION, AND THIS IS THE ONE PLACE THE RULE BENDS. §6 says types
 * are read and not assumed, and every other path obeys it because a rate
 * confirmation prints the words "PICKUP" and "DELIVERY". THIS EXPORT HAS NO
 * TYPE COLUMN — `Facility Sequence` is `FOE1->MCI4` and nothing more. Position
 * is not an assumption here, it is the only information the file contains, and
 * Relay's own model is one Load ID per leg: A to B. Flagged in the brief.
 */
function plannedStop(
  stop: RelayStop,
  index: number,
  count: number,
  mode: ImportMode,
  zone: string,
): PlannedStop {
  const delivered = mode === 'delivered'
  // EVERY PRINTED CLOCK, READ WHERE THE FACILITY IS. Flag 14's fix: the export
  // prints wall clocks and `zoneWallClock` is the same DST-aware conversion
  // the create form's typed dates go through.
  const at = (clock: RelayClock | null) =>
    clock === null
      ? null
      : zoneWallClock(clock.date, clock.hour, clock.minute, zone)

  return {
    type:
      index === 0
        ? 'PICKUP'
        : index === count - 1
          ? 'DELIVERY'
          : 'INTERMEDIATE',
    facility: stop.facility,
    utcOffsetHours: stop.utcOffsetHours,
    zone,
    // THE PLANNED WINDOW IS KEPT IN BOTH MODES. A delivered load whose
    // appointment is erased cannot be asked "was it late", which is the
    // question a Relay scorecard is decided on.
    scheduledAt: at(stop.plannedArrival),
    windowStart: at(stop.plannedArrival),
    windowEnd: at(stop.plannedDeparture),
    arrivedAt: delivered ? at(stop.actualArrival) : null,
    departedAt: delivered ? at(stop.actualDeparture) : null,
    containerId: stop.containerId,
  }
}

/**
 * The IANA zone a Relay stop's clocks are read in.
 *
 * THREE SOURCES, IN THIS ORDER, and the order is the argument:
 *
 *   1. **The facility's own recorded zone.** `Location.timezone` exists for
 *      exactly this and design rule 3 says it wins. A dispatcher who has
 *      filled in where `AGS1` actually is has said something this file cannot.
 *   2. **The zone family the offset column names.** The export's offset is
 *      static STANDARD-time metadata (flag 14) — which is useless for
 *      converting a clock and precise about which zone the facility is in.
 *      −6 is Central, −5 is Eastern, and that is not a guess about a facility
 *      code, it is the one geographic fact the file states.
 *   3. **The company fallback**, when the column is empty too.
 *
 * WITHOUT STEP 2 THIS WOULD BE SILENTLY WRONG for half the corpus. A facility
 * code has no state, so `resolveZone` would fall to America/Chicago for every
 * stop — and an Augusta appointment read as Central is an hour late, with the
 * cross-check below agreeing that −5 is −5 and saying nothing. The failure is
 * invisible precisely where it matters.
 *
 * ARIZONA IS THE KNOWN HOLE. `-7` maps to America/Denver, which observes DST;
 * Phoenix does not, so a Phoenix facility's summer clocks land an hour early.
 * Not resolved by guessing between two zones with one offset — resolved by a
 * dispatcher recording the facility's zone, which is source 1. Flagged.
 */
export function zoneForRelayStop(
  recorded: string | null,
  utcOffsetHours: number | null,
  fallback: string,
): string {
  if (recorded) return recorded
  if (utcOffsetHours !== null) {
    const zone = STANDARD_OFFSET_ZONES[utcOffsetHours]
    if (zone) return zone
  }
  return fallback
}

/**
 * US standard-time offset → the zone that keeps it.
 *
 * Standard offsets, not current ones: this table is read against a column that
 * says −6 in July. Alaska and Hawaii are included because Relay runs neither
 * and their absence would be a silent fallback rather than an answer.
 */
const STANDARD_OFFSET_ZONES: Record<number, string> = {
  [-5]: 'America/New_York',
  [-6]: 'America/Chicago',
  [-7]: 'America/Denver',
  [-8]: 'America/Los_Angeles',
  [-9]: 'America/Anchorage',
  [-10]: 'Pacific/Honolulu',
}

/**
 * Whether the offset column still agrees with the zone this stop resolved to.
 *
 * THE CROSS-CHECK HALF OF FLAG 14. The column is standard time, so in summer
 * the real zone is one hour ahead of it and that difference is expected — it
 * is the whole reason the column stopped being the authority. Anything OUTSIDE
 * that range means the stop is being read in the wrong zone, and a stop read
 * in the wrong zone is an appointment nobody can meet.
 *
 * Expected is `actual − column ∈ {0, +1}`: zero in winter, one in summer.
 */
export function offsetDisagrees(
  at: Date | null,
  zone: string,
  column: number | null,
): boolean {
  if (!at || column === null) return false
  const drift = zoneOffsetHours(at, zone) - column
  return drift < 0 || drift > 1
}

/**
 * The trip's own facts, as one sentence on the load.
 *
 * THE DRIVER IS NAMED HERE RATHER THAN ASSIGNED, and that is deliberate. A
 * name is not a `Driver.id`, matching one by string is a fuzzy join onto a
 * compliance record, and the corpus proves the cost of getting it wrong:
 * `T-113PDBV26` carries two loads whose windows OVERLAP — the first is planned
 * out of MCI4 at 01:02 and the second planned into MCI4 at 00:32. Assigning
 * one driver to both would hit Phase 4's `assertAssignable`, throw a dispatch
 * conflict, and fail the import over freight that really did run that way,
 * because Amazon's planned times are estimates that overlap at a handoff.
 *
 * So the information is kept where a dispatcher can read it and act, and the
 * assignment stays a human act on the dispatch board.
 */
function tripNote(trip: RelayTrip): string {
  const parts = [
    trip.tripId ? `Relay trip ${trip.tripId}` : null,
    trip.driverName ? `driver ${trip.driverName}` : null,
    trip.tractorId ? `tractor ${trip.tractorId}` : null,
    trip.trailerId ? `trailer ${trip.trailerId}` : null,
    trip.equipmentText,
    trip.shipperAccount,
    trip.facilitySequence,
  ].filter((part): part is string => part !== null && part !== '')
  return parts.join(' · ')
}

/**
 * What the dispatcher was shown, as one string.
 *
 * The same device as `warningSignature` and for the same reason: a confirm
 * only lets THIS plan through. Re-upload a different file, or let a duplicate
 * appear in the seconds between preview and confirm, and the signature stops
 * matching and the preview is shown again rather than the write happening on
 * the strength of a click about something else.
 *
 * The warnings are IN the signature: a row that has become a duplicate since
 * the preview is a row the office has not been told about yet.
 */
export function planSignature(plan: ImportPlan): string {
  return [
    plan.settlesDirectly ? 'direct' : 'invoiced',
    ...plan.create.map(
      (load) =>
        `${load.rowNumber}:${load.loadId}:${load.stops.length}:${load.costCents ?? '-'}:${load.warnings
          .map((warning) => warning.kind)
          .sort()
          .join('+')}`,
    ),
    ...plan.skip.map((row) => `skip:${row.rowNumber}:${row.reason}`),
  ].join('|')
}

/**
 * The Relay customer, created settling directly if it is not there.
 *
 * `settlesDirectly` IS THE POINT — Amazon pays by weekly ACH statement and its
 * loads never become invoices (schema, `Customer.settlesDirectly`). Set when
 * this row is created and NEVER written afterwards: a customer whose terms
 * somebody has deliberately changed must not be quietly changed back by an
 * import. When it is off, the plan says so and the loads are honestly
 * invoiceable.
 */
export async function ensureRelayCustomer(
  tx: TxClient,
  organizationId: string,
): Promise<{ id: string; settlesDirectly: boolean }> {
  const existing = await tx.customer.findFirst({
    where: {
      name: { equals: RELAY_CUSTOMER_NAME, mode: 'insensitive' },
      deletedAt: null,
    },
    select: { id: true, settlesDirectly: true },
  })
  if (existing) return existing

  return tx.customer.create({
    data: {
      organizationId,
      name: RELAY_CUSTOMER_NAME,
      type: 'SHIPPER',
      settlesDirectly: true,
      // Amazon does not factor and a factored Relay load is a mistake with a
      // fee attached. Off at creation; changeable on the customer screen.
      isFactorable: false,
    },
    select: { id: true, settlesDirectly: true },
  })
}

export interface ImportLoadOptions {
  companyId: string
  customerId: string
  byUserId: string | null
}

/**
 * One planned load, written.
 *
 * Its own transaction, per the note at the top of this file. The caller loops.
 */
export async function importRelayLoad(
  tx: TxClient,
  organizationId: string,
  planned: PlannedLoad,
  options: ImportLoadOptions,
): Promise<{ id: string; loadNumber: string }> {
  // One Location per facility CODE. `FOE1` becomes a facility with a name and
  // no address, which is the truth: the export has no addresses in it. The
  // second import down the same lane finds the same row, and the first time a
  // dispatcher fills the address in, Phase 5's facility memory has something
  // to match on.
  const places: string[] = []
  for (const stop of planned.stops) {
    const location = await resolveLocation(tx, organizationId, stop.facility)
    places.push(location.locationId)

    // AND THE ZONE IS RECORDED ON THE FACILITY, which is not bookkeeping.
    //
    // The instant is right without this; the SCREEN is not. `renderStopTime`
    // resolves a stop's zone from `Location.timezone`, then the state, then
    // the company fallback — and a facility code has no state, so an Augusta
    // appointment stored correctly at 23:09Z would render "18:09 CDT" on the
    // load detail screen. Right in the database, an hour wrong in front of the
    // dispatcher, which is the failure design rule 3 exists to prevent.
    //
    // ONLY WHEN THE ROW HAS NONE. A zone somebody recorded deliberately is
    // source 1 of `zoneForRelayStop` and it beat this import's guess when the
    // plan was built; overwriting it here would let the file win after all.
    if (location.timezone === null) {
      await tx.location.update({
        where: { id: location.locationId },
        data: { timezone: stop.zone },
      })
    }
  }

  const load = await createLoad(
    tx,
    organizationId,
    {
      companyId: options.companyId,
      customerId: options.customerId,
      // AMAZON'S LOAD ID IS THE REFERENCE, and therefore the duplicate key.
      referenceNumber: planned.loadId,
      // AS A STRING, AND THAT IS NOT COSMETIC. `LoadInput` types this field
      // `unknown` and `createLoad` reads it through `optionalText`, which
      // returns null for anything that is not a string — so passing the number
      // 241 stored NO MILES AT ALL, silently, with nothing to typecheck
      // against. Caught by the integration test asserting the exact value; an
      // assertion of "not null" would have passed on the null.
      dispatchedMiles:
        planned.distanceMiles === null
          ? undefined
          : String(planned.distanceMiles),
      // A container moves on a chassis and a trailer does not, and the export
      // says which in words. Everything else Amazon runs is a dry van.
      equipmentType: /container/i.test(planned.note) ? 'CONTAINER' : 'DRY_VAN',
      // Null means the role may not enter money at all (§1.3): the field is
      // omitted rather than sent as zero, so nothing downstream can read a
      // dispatcher's import as a rate of nothing.
      ...(planned.costCents === null
        ? {}
        : { linehaulCents: planned.costCents }),
      dispatcherNotes: planned.note,
      stops: planned.stops.map((stop, index) => ({
        type: stop.type,
        locationId: places[index]!,
        name: stop.facility,
        scheduledAt: stop.scheduledAt,
        windowStart: stop.windowStart,
        windowEnd: stop.windowEnd,
        // A planned arrival AND a planned departure is a window, not an
        // appointment, and Relay works to windows. Said in the column that
        // exists for it rather than left at the default.
        appointmentType:
          stop.windowStart && stop.windowEnd ? 'WINDOW' : 'APPOINTMENT',
        referenceNumber: stop.containerId,
      })),
    },
    { byUserId: options.byUserId },
  )

  // THE LOAD'S OWN LANDING, not the file's. `planned.delivered` was read from
  // this row's `Load Execution Status`; a caller cannot override it, which is
  // the property that makes a mixed file safe to import in one pass.
  if (planned.delivered) {
    // THE ACTUAL TIMES, WHICH `createLoad` HAS NO INPUT FOR. `StopInput`
    // carries the plan; arrival and departure are things that HAPPEN, and
    // every other path writes them from a driver's action rather than at
    // creation. Written here in one statement per stop that has any, which is
    // the smallest addition to a transaction that is already the largest in
    // the application.
    for (const [index, stop] of planned.stops.entries()) {
      if (!stop.arrivedAt && !stop.departedAt) continue
      await tx.loadStop.updateMany({
        where: { loadId: load.id, sequence: index + 1 },
        data: { arrivedAt: stop.arrivedAt, departedAt: stop.departedAt },
      })
    }

    // AND THE STATUS, THROUGH THE ENGINE. Not a `data: { operationalStatus }`
    // write — Phase 2's rule is that the axis moves through
    // `transitionOperational` so the event log records it. `INTEGRATION` is
    // the source, because a human did not click Delivered on this load, and
    // `occurredAt` is when it actually finished rather than when the file was
    // uploaded.
    const last = planned.stops[planned.stops.length - 1]!
    await transitionOperational(tx, load.id, 'DELIVERED', {
      source: 'INTEGRATION',
      userId: options.byUserId,
      ...(last.departedAt ? { occurredAt: last.departedAt } : {}),
      note: `Imported from Relay export · ${planned.loadId}`,
    })
  }

  return { id: load.id, loadNumber: load.loadNumber }
}

/**
 * `Aug 11, 23:30 CDT` — a stop time, in the preview.
 *
 * DESIGN RULE 3, PROPERLY, which it could not be before flag 14 was settled.
 * The first version printed `UTC−6` because there was no zone to name and an
 * abbreviation would have been a claim the file never made. Now every stop has
 * a real IANA zone, so this is `renderStopTime` — the same renderer the load
 * screen and the dispatch board use, showing the same abbreviation.
 *
 * That the preview reads `23:30 CDT` where the Relay portal reads `23:30 CDT`
 * is the whole verification: it is the printed clock, back where it came from.
 */
export function previewMoment(
  at: Date | null,
  zone: string,
  locale?: string,
): string {
  const rendered = renderStopTime(at, null, {
    fallbackZone: zone,
    zone,
    ...(locale ? { locale } : {}),
  })
  return rendered?.text ?? '—'
}
