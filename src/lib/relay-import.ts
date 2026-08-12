import type { TxClient } from './tenancy'
import type { RelayStop, RelayTrip } from './relay-csv'
import { type LoadWarning, loadWarnings } from './load-warnings'
import { createLoad } from './loads'
import { transitionOperational } from './load-status'
import { resolveLocation } from './locations'
import { renderDateOnly } from './stop-time'

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

export type RowRefusal =
  | 'no_load_id'
  | 'too_few_stops'
  | 'missing_offset'
  | 'window_inverted'
  | 'not_completed'
  | 'no_actual_times'
  | 'repeated_in_file'

export interface PlannedStop {
  type: 'PICKUP' | 'DELIVERY' | 'INTERMEDIATE'
  facility: string
  /** Carried so the preview can print the time the FILE printed. */
  utcOffsetHours: number | null
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
}

export interface SkippedRow {
  rowNumber: number
  /** May be null — a row with no Load ID is exactly why. */
  loadId: string | null
  reason: RowRefusal
}

export interface ImportPlan {
  mode: ImportMode
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
    mode: ImportMode
    /** `load.financials:update`. Decides whether money is in the plan at all. */
    maySeeMoney: boolean
  },
): Promise<ImportPlan> {
  const customer = await tx.customer.findFirst({
    where: {
      name: { equals: RELAY_CUSTOMER_NAME, mode: 'insensitive' },
      deletedAt: null,
    },
    select: { id: true, settlesDirectly: true },
  })

  const create: PlannedLoad[] = []
  const skip: SkippedRow[] = []
  const seen = new Set<string>()

  for (const trip of input.trips) {
    const refusal = refuse(trip, input.mode, seen)
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

    const stops = trip.stops.map((stop, index) =>
      plannedStop(stop, index, trip.stops.length, input.mode),
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

    create.push({
      rowNumber: trip.rowNumber,
      loadId,
      lane: `${trip.stops[0]!.facility} → ${trip.stops[trip.stops.length - 1]!.facility}`,
      stops,
      distanceMiles: trip.distanceMiles,
      costCents,
      note: tripNote(trip),
      warnings,
    })
  }

  return {
    mode: input.mode,
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
function refuse(
  trip: RelayTrip,
  mode: ImportMode,
  seen: Set<string>,
): RowRefusal | null {
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
    // A TIME WITH NO OFFSET IS NOT A MOMENT. `relayInstant` already returned
    // null for every time on this stop; importing it would produce a load with
    // no dates at all and no explanation, so the row says why instead.
    if (stop.utcOffsetHours === null) return 'missing_offset'

    // Caught here rather than in `writeStops`, which throws and would take the
    // whole transaction — and, more to the point, would surface as a failure
    // AFTER the confirm rather than as a skipped row in the preview.
    if (
      stop.plannedArrival &&
      stop.plannedDeparture &&
      stop.plannedDeparture.getTime() < stop.plannedArrival.getTime()
    ) {
      return 'window_inverted'
    }
  }

  if (mode === 'delivered') {
    // `Load Execution Status` is per LOAD; `Trip Stage` is per trip and a trip
    // can be 'In Transit' while its first load is 'Completed'. The corpus has
    // exactly that row, which is why this reads the load's own column.
    if ((trip.executionStatus ?? '').toLowerCase() !== 'completed') {
      return 'not_completed'
    }
    // A trip whose last stop has no actual departure has not delivered,
    // whatever its status column says. Landing it as delivered would put a
    // POD-less load into billing.
    const last = trip.stops[trip.stops.length - 1]!
    if (!last.actualArrival && !last.actualDeparture) return 'no_actual_times'
  }

  return null
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
): PlannedStop {
  const delivered = mode === 'delivered'
  return {
    type:
      index === 0
        ? 'PICKUP'
        : index === count - 1
          ? 'DELIVERY'
          : 'INTERMEDIATE',
    facility: stop.facility,
    utcOffsetHours: stop.utcOffsetHours,
    // THE PLANNED WINDOW IS KEPT IN BOTH MODES. A delivered load whose
    // appointment is erased cannot be asked "was it late", which is the
    // question a Relay scorecard is decided on.
    scheduledAt: stop.plannedArrival,
    windowStart: stop.plannedArrival,
    windowEnd: stop.plannedDeparture,
    arrivedAt: delivered ? stop.actualArrival : null,
    departedAt: delivered ? stop.actualDeparture : null,
    containerId: stop.containerId,
  }
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
    plan.mode,
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
  mode: ImportMode
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

  if (options.mode === 'delivered') {
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
 * `Aug 11, 23:30 UTC−6` — a stop time, in the preview.
 *
 * RENDERED BACK AT THE STOP'S OWN OFFSET, so the preview shows the dispatcher
 * the same clock face the file did. Design rule 3 says a stop time renders in
 * the STOP's zone, and this is the closest that rule can be honoured with what
 * the export contains: there is no IANA zone here and no address to look one
 * up from, so the offset is printed rather than an abbreviation invented for
 * it. A dispatcher who can see `UTC−6` beside the time can tell us it is
 * wrong; `CST` would be a claim the file never made.
 */
export function previewMoment(
  at: Date | null,
  offsetHours: number | null,
): string {
  if (!at) return '—'
  if (offsetHours === null) return renderDateOnly(at) ?? '—'

  // Shifted, then formatted as UTC. `Intl` takes a zone and there is no zone —
  // moving the instant by the offset and reading it in UTC is the same
  // arithmetic the file's own columns describe.
  const local = new Date(at.getTime() + offsetHours * 3_600_000)
  const face = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(local)

  // U+2212 MINUS, not a hyphen: this is a signed number, and the design
  // system's own money rule uses the same character for the same reason.
  const sign = offsetHours < 0 ? '−' : '+'
  return `${face} UTC${sign}${Math.abs(offsetHours)}`
}
