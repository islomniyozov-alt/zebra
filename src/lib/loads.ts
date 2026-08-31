import type { TxClient } from './tenancy'
import type {
  EquipmentType,
  LoadOperationalStatus,
  Prisma,
} from '@/generated/prisma/client'
import { allocateNumber } from './counters'
import { assertAssignable, loadWindow } from './dispatch'
import {
  podConfirmed,
  statusForAssignment,
  transitionOperational,
  type TransitionOutcome,
} from './load-status'
import {
  ReferenceError,
  isUniqueViolation,
  optionalText,
  requiredText,
  stateCode,
} from './reference'

// ---------------------------------------------------------------------------
// THE LOAD SERVICE
//
// Create, edit, cancel, assign. Everything a load can have done to it, in one
// module, so the four screens that will call it in Steps 4–6 have nothing left
// to decide.
//
// THREE RULES THIS FILE EXISTS TO HOLD:
//
//   * The load number comes from the Counter and nowhere else (§10). Never
//     MAX+1, never a guess, and if allocation fails the create fails.
//   * Stops are rows, always. §2's decision 3 — multi-stop in the data,
//     single-stop in the UI — means `writeStops` takes a LIST and the UI
//     happens to pass two. Nothing here assumes two.
//   * Status is never assigned directly. Every move goes through
//     `transitionOperational`, which writes the event log. A `data:
//     { operationalStatus }` anywhere outside src/lib/load-status.ts is a bug.
// ---------------------------------------------------------------------------

/**
 * What a load write needs on the clock, and why 5 seconds is not it.
 *
 * Prisma aborts an interactive transaction after 5s. Booking a load with a
 * truck and a driver sends about **31 statements**, counted:
 *
 *   6  reads — company, customer, truck, driver, open periods, other loads
 *   1  the counter increment (raw SQL, so it bypasses the audit extension)
 *   24 six audited writes × 4 statements each
 *
 * That last line is the one worth knowing. Every audited write is wrapped in
 * `SAVEPOINT … <write> … <audit insert> … RELEASE` (Phase 1 §8), so a write
 * costs four round trips rather than one. It is the right design — a failed
 * audit must not poison the caller's transaction — and it is expensive.
 *
 * Measured against this database: **200ms per round trip** from a laptop in
 * Tajikistan to Neon in us-east-2, which puts 5s at roughly 24 statements and
 * a create at ~6.2s. Observed failures were 6.1–6.6s, so the arithmetic is
 * the whole story.
 *
 * On the deployed worker the same transaction is a fraction of this — the
 * round trip is a tenth. The timeout is raised for the distance, not for the
 * work, and raising it does not excuse adding statements: everything cheap
 * has already been cut (see `writeStops` and `findAssignmentConflicts`).
 */
export const LOAD_WRITE_TIMEOUT_MS = 20_000

export interface StopInput {
  type: 'PICKUP' | 'DELIVERY' | 'INTERMEDIATE'
  /** The reusable facility this stop is at, when one was resolved. */
  locationId?: string | null
  name?: unknown
  addressLine1?: unknown
  city?: unknown
  state?: unknown
  postalCode?: unknown
  scheduledAt?: Date | null
  windowStart?: Date | null
  windowEnd?: Date | null
  appointmentType?: 'APPOINTMENT' | 'FCFS' | 'WINDOW'
  referenceNumber?: unknown
  contactName?: unknown
  contactPhone?: unknown
  instructions?: unknown
  /**
   * What actually happened here, when it is known.
   *
   * SEPARATE FROM `scheduledAt`, NEVER OVERWRITING IT. The plan is what was
   * agreed and stays on the row as the reference; these two are the record.
   * `src/lib/stop-actuals.ts` decides which one a screen shows.
   *
   * `relay-import.ts` used to write these in a second pass because this
   * contract had nowhere to put them — a load could not be created complete.
   */
  arrivedAt?: Date | null
  departedAt?: Date | null
  /**
   * The leg that ARRIVED at this stop: its distance, and whether it ran empty.
   *
   * TYPED, NOT `unknown`, UNLIKE ITS NEIGHBOURS ABOVE. Those are `unknown`
   * because they come from form data and are laundered through `optionalText`.
   * These come from a parser that has already made them numbers, and typing
   * them is what makes a caller passing the wrong shape a compile error rather
   * than a silent null — which is exactly how these two came to be missing
   * from the trips importer's create path for a day.
   */
  legMiles?: number | null
  legEmpty?: boolean | null
}

export interface LoadInput {
  companyId: string
  customerId: string
  referenceNumber?: unknown
  /** The shipper's numbers, recorded and never allocated here (§3 step 5). */
  bolNumber?: unknown
  poNumber?: unknown
  truckId?: string | null
  driverId?: string | null
  trailerId?: string | null
  equipmentType?: EquipmentType
  commodity?: unknown
  weightLbs?: unknown
  dispatchedMiles?: unknown
  linehaulCents?: number
  fuelSurchargeCents?: number
  dispatcherNotes?: unknown
  /** Sequence is assigned from array order — position IS the sequence. */
  stops: StopInput[]
}

function wholeNumber(
  value: unknown,
  field: string,
  max: number,
): number | null {
  const text = optionalText(value)
  if (text === null) return null
  const parsed = Number(text.replace(/[,\s]/g, ''))
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) {
    throw new ReferenceError('invalid_year', { field })
  }
  return parsed
}

/**
 * Total revenue, from its parts.
 *
 * Money is an integer of cents everywhere. Accessorials are the sum of
 * billable `LoadAccessorial` rows and are recomputed on write rather than
 * trusted — the schema says denormalized-for-reporting, which means it is a
 * cache and a cache that is written by hand goes stale.
 */
export async function recomputeTotals(
  tx: TxClient,
  loadId: string,
): Promise<void> {
  const load = await tx.load.findUnique({
    where: { id: loadId },
    select: { linehaulCents: true, fuelSurchargeCents: true },
  })
  if (!load) return

  const billable = await tx.loadAccessorial.findMany({
    where: { loadId, isBillable: true, status: { not: 'DENIED' } },
    select: { amountCents: true },
  })
  const accessorialsCents = billable.reduce(
    (total, row) => total + row.amountCents,
    0,
  )

  await tx.load.update({
    where: { id: loadId },
    data: {
      accessorialsCents,
      totalRevenueCents:
        load.linehaulCents + load.fuelSurchargeCents + accessorialsCents,
    },
  })
}

/** Replace a load's stops. Position in the array is the stop's sequence. */
async function writeStops(
  tx: TxClient,
  loadId: string,
  organizationId: string,
  stops: StopInput[],
): Promise<void> {
  if (stops.length < 2) {
    throw new ReferenceError('required', { field: 'stops' })
  }

  // Deleted and rewritten rather than diffed. A load's stops are small, and a
  // diff that gets `sequence` wrong produces a load whose delivery is before
  // its pickup — a bug worth more than the queries it would save.
  //
  // `createMany`, not a create per stop. Two round trips instead of N+1, and
  // that matters more than it looks: every one of these runs inside an
  // interactive transaction with a 5 second ceiling, and a round trip to Neon
  // is ~200ms from a laptop. A three-stop load written one row at a time spent
  // a fifth of the whole budget on stops alone.
  // A WINDOW THAT ENDS BEFORE IT STARTS IS REFUSED (Phase 5 verification
  // session). Every layer used to accept one: the extraction parser, because
  // both ends are valid ISO local times; the prefill; and this. A malformed
  // "0800-600" on a real rate confirmation produced windowStart 08:00 with
  // windowEnd 06:00, and the load saved.
  //
  // Refused rather than repaired, for the same reason the reader is told not
  // to straighten a malformed value: the correct end is unknown, and Phase 2's
  // §8 already refuses a load whose delivery precedes its pickup. This is the
  // same rule one level down, and it catches a typed window as well as a read
  // one.
  for (const [index, stop] of stops.entries()) {
    if (
      stop.windowStart instanceof Date &&
      stop.windowEnd instanceof Date &&
      stop.windowEnd.getTime() < stop.windowStart.getTime()
    ) {
      throw new ReferenceError('window_inverted', {
        field: `stops[${index}].windowEnd`,
      })
    }
  }

  await tx.loadStop.deleteMany({ where: { loadId } })

  await tx.loadStop.createMany({
    data: stops.map((stop, index) => ({
      loadId,
      organizationId,
      sequence: index + 1,
      type: stop.type,
      locationId: stop.locationId ?? null,
      name: optionalText(stop.name),
      addressLine1: optionalText(stop.addressLine1),
      city: optionalText(stop.city),
      state: stateCode(stop.state),
      postalCode: optionalText(stop.postalCode),
      appointmentType: stop.appointmentType ?? 'APPOINTMENT',
      scheduledAt: stop.scheduledAt ?? null,
      windowStart: stop.windowStart ?? null,
      windowEnd: stop.windowEnd ?? null,
      referenceNumber: optionalText(stop.referenceNumber),
      contactName: optionalText(stop.contactName),
      contactPhone: optionalText(stop.contactPhone),
      instructions: optionalText(stop.instructions),
      arrivedAt: stop.arrivedAt ?? null,
      departedAt: stop.departedAt ?? null,
      legMiles: stop.legMiles ?? null,
      legEmpty: stop.legEmpty ?? null,
    })),
  })
}

async function assertCompanyInScope(
  tx: TxClient,
  companyId: string,
): Promise<void> {
  const company = await tx.company.findFirst({
    where: { id: companyId, isActive: true },
    select: { id: true },
  })
  if (!company) {
    throw new ReferenceError('invalid_authority', { field: 'companyId' })
  }
}

/**
 * Refuse an unbookable broker, and report how they settle.
 *
 * The settlement terms come back from the same read rather than a second one:
 * inside a transaction with a 5s ceiling and a 200ms round trip, a query that
 * can ride along should.
 */
async function assertBookableCustomer(
  tx: TxClient,
  customerId: string,
): Promise<{ settlesDirectly: boolean }> {
  const customer = await tx.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: { status: true, name: true, settlesDirectly: true },
  })
  if (!customer) {
    throw new ReferenceError('not_found', { field: 'customerId' })
  }
  if (customer.status === 'BLOCKED') {
    // BIG M II. A blocked broker is a first-class state, and booking against
    // one is the exact thing blocking exists to stop.
    throw new ReferenceError('required', { field: 'customerId' })
  }
  return { settlesDirectly: customer.settlesDirectly }
}

export interface CreateLoadOptions {
  byUserId?: string | null
}

/**
 * Book a load.
 *
 * Order matters and is not arbitrary: everything that can be refused is
 * refused BEFORE the counter is touched, so a rejected create does not burn a
 * load number. The series stays contiguous, which is what §10 is protecting.
 */
export async function createLoad(
  tx: TxClient,
  organizationId: string,
  input: LoadInput,
  options: CreateLoadOptions = {},
) {
  const companyId = requiredText(input.companyId, 'companyId')
  await assertCompanyInScope(tx, companyId)
  const customerId = requiredText(input.customerId, 'customerId')
  const { settlesDirectly } = await assertBookableCustomer(tx, customerId)

  if (input.stops.length < 2) {
    throw new ReferenceError('required', { field: 'stops' })
  }

  // Conflicts before numbering, for the reason above. The window comes from
  // the stops we are about to write, not from the database.
  const points = input.stops
    .flatMap((stop) => [stop.windowStart, stop.scheduledAt, stop.windowEnd])
    .filter((value): value is Date => value instanceof Date)
    .map((value) => value.getTime())

  await assertAssignable(
    tx,
    {
      truckId: input.truckId ?? null,
      driverId: input.driverId ?? null,
      trailerId: input.trailerId ?? null,
    },
    {
      companyId,
      from: points.length ? new Date(Math.min(...points)) : null,
      to: points.length ? new Date(Math.max(...points)) : null,
    },
  )

  const number = await allocateNumber(tx, companyId, 'LOAD_NUMBER')
  const linehaulCents = input.linehaulCents ?? 0
  const fuelSurchargeCents = input.fuelSurchargeCents ?? 0

  let load
  try {
    load = await tx.load.create({
      data: {
        organizationId,
        companyId,
        loadNumber: String(number),
        referenceNumber: optionalText(input.referenceNumber),
        bolNumber: optionalText(input.bolNumber),
        poNumber: optionalText(input.poNumber),
        customerId,
        truckId: input.truckId ?? null,
        driverId: input.driverId ?? null,
        trailerId: input.trailerId ?? null,
        equipmentType: input.equipmentType ?? 'DRY_VAN',
        commodity: optionalText(input.commodity),
        weightLbs: wholeNumber(input.weightLbs, 'weightLbs', 200_000),
        dispatchedMiles: wholeNumber(
          input.dispatchedMiles,
          'dispatchedMiles',
          20_000,
        ),
        linehaulCents,
        fuelSurchargeCents,
        totalRevenueCents: linehaulCents + fuelSurchargeCents,
        dispatcherNotes: optionalText(input.dispatcherNotes),
        // COPIED from the customer, not joined to it. Amazon Relay settles by
        // weekly ACH statement, so its loads never become invoices — and a
        // customer whose terms change next year must not rewrite the billing
        // history of freight that has already run.
        directSettled: settlesDirectly,
        bookedByUserId: options.byUserId ?? null,
        // NOT set here. BOOKED is the schema default and the first status
        // event is written below, so the log starts where the load does.
      },
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ReferenceError('duplicate', { field: 'loadNumber' })
    }
    throw error
  }

  await writeStops(tx, load.id, organizationId, input.stops)

  // The opening entry in the log. Without it a load's history begins at its
  // first transition and the state it was created in is inferred rather than
  // recorded.
  await tx.loadStatusEvent.create({
    data: {
      loadId: load.id,
      organizationId,
      axis: 'OPERATIONAL',
      fromStatus: null,
      toStatus: 'BOOKED',
      source: 'MANUAL',
      changedByUserId: options.byUserId ?? null,
    },
  })

  // An assignment supplied at creation still goes through the engine, so
  // Dispatched is reached the same way it would be reached later — but from
  // state already in hand, rather than re-reading the row we just wrote.
  const moved = await applyAssignmentStatus(
    tx,
    load.id,
    options.byUserId ?? null,
    {
      operationalStatus: load.operationalStatus,
      truckId: load.truckId,
      driverId: load.driverId,
    },
  )

  // Returned from memory. A trailing `findUniqueOrThrow` was one more round
  // trip inside the 5 second ceiling, spent re-reading a row whose only
  // possible change is the one line below.
  return moved?.result === 'moved'
    ? { ...load, operationalStatus: moved.to }
    : load
}

/**
 * Re-derive the operational status from the current assignment (§7).
 *
 * Called after anything that changes truck or driver. Idempotent by
 * construction: `statusForAssignment` returns null when nothing should move,
 * and `transitionOperational` is itself idempotent.
 */
export async function applyAssignmentStatus(
  tx: TxClient,
  loadId: string,
  userId: string | null,
  /**
   * The load's state, when the caller already has it. Saves a round trip
   * inside a transaction with a 5 second ceiling — see `writeStops`.
   */
  known?: {
    operationalStatus: LoadOperationalStatus
    truckId: string | null
    driverId: string | null
  },
): Promise<TransitionOutcome | null> {
  const load =
    known ??
    (await tx.load.findUnique({
      where: { id: loadId },
      select: { operationalStatus: true, truckId: true, driverId: true },
    }))
  if (!load) return null

  const move = statusForAssignment(load.operationalStatus, {
    truckId: load.truckId,
    driverId: load.driverId,
  })
  if (!move) return null

  return transitionOperational(tx, loadId, move.to, {
    source: 'AUTOMATIC',
    userId,
    allowRewind: move.rewind,
    // Keys, localized at render. A note written in English here is a note
    // that stays English in the Russian timeline.
    note:
      move.to === 'DISPATCHED'
        ? 'status.note.assigned'
        : 'status.note.unassigned',
  })
}

export interface UpdateLoadInput extends Partial<Omit<LoadInput, 'companyId'>> {
  stops?: StopInput[]
}

/**
 * Edit a load.
 *
 * `companyId` is absent from the input type on purpose. Moving a load between
 * authorities would change which counter series its number belongs to, and a
 * load number that means something different depending on when you look is the
 * failure §10 is written against. If it is ever needed it needs its own
 * function, its own renumbering, and its own status event.
 */
export async function updateLoad(
  tx: TxClient,
  loadId: string,
  input: UpdateLoadInput,
  options: { byUserId?: string | null } = {},
) {
  const current = await tx.load.findUnique({
    where: { id: loadId },
    select: {
      organizationId: true,
      companyId: true,
      isCancelled: true,
      truckId: true,
      driverId: true,
    },
  })
  if (!current) throw new ReferenceError('not_found')
  if (current.isCancelled) {
    throw new ReferenceError('not_found', { field: 'isCancelled' })
  }

  if (input.customerId !== undefined) {
    await assertBookableCustomer(tx, input.customerId)
  }

  const truckId =
    input.truckId === undefined ? current.truckId : (input.truckId ?? null)
  const driverId =
    input.driverId === undefined ? current.driverId : (input.driverId ?? null)

  // Re-check conflicts against the window the load will have AFTER the edit.
  if (input.stops) {
    await writeStops(tx, loadId, current.organizationId, input.stops)
  }
  const window = await loadWindow(tx, loadId)
  await assertAssignable(
    tx,
    { truckId, driverId, trailerId: input.trailerId ?? null },
    { loadId, companyId: current.companyId, ...window },
  )

  const linehaulCents = input.linehaulCents
  const data = {
    ...(input.customerId !== undefined ? { customerId: input.customerId } : {}),
    ...(input.referenceNumber !== undefined
      ? { referenceNumber: optionalText(input.referenceNumber) }
      : {}),
    ...(input.bolNumber !== undefined
      ? { bolNumber: optionalText(input.bolNumber) }
      : {}),
    ...(input.poNumber !== undefined
      ? { poNumber: optionalText(input.poNumber) }
      : {}),
    ...(input.truckId !== undefined ? { truckId } : {}),
    ...(input.driverId !== undefined ? { driverId } : {}),
    ...(input.trailerId !== undefined
      ? { trailerId: input.trailerId ?? null }
      : {}),
    ...(input.equipmentType ? { equipmentType: input.equipmentType } : {}),
    ...(input.commodity !== undefined
      ? { commodity: optionalText(input.commodity) }
      : {}),
    ...(input.weightLbs !== undefined
      ? { weightLbs: wholeNumber(input.weightLbs, 'weightLbs', 200_000) }
      : {}),
    ...(input.dispatchedMiles !== undefined
      ? {
          dispatchedMiles: wholeNumber(
            input.dispatchedMiles,
            'dispatchedMiles',
            20_000,
          ),
        }
      : {}),
    ...(linehaulCents !== undefined ? { linehaulCents } : {}),
    ...(input.fuelSurchargeCents !== undefined
      ? { fuelSurchargeCents: input.fuelSurchargeCents }
      : {}),
    ...(input.dispatcherNotes !== undefined
      ? { dispatcherNotes: optionalText(input.dispatcherNotes) }
      : {}),
  }

  await tx.load.update({ where: { id: loadId }, data })
  await recomputeTotals(tx, loadId)
  await applyAssignmentStatus(tx, loadId, options.byUserId ?? null)

  return tx.load.findUniqueOrThrow({ where: { id: loadId } })
}

/**
 * Cancel a load. Never deletes anything (§7).
 *
 * The operational status is left exactly where it was. Cancelled is an
 * orthogonal flag, not a rung on the ladder — a load cancelled while in
 * transit was in transit, and overwriting that to hide the cancellation would
 * lose the fact that a truck was actually out there.
 */
export async function cancelLoad(
  tx: TxClient,
  loadId: string,
  reason: string,
  options: { byUserId?: string | null } = {},
) {
  const trimmed = requiredText(reason, 'cancelReason')

  const load = await tx.load.findUnique({
    where: { id: loadId },
    select: {
      organizationId: true,
      isCancelled: true,
      operationalStatus: true,
    },
  })
  if (!load) throw new ReferenceError('not_found')

  // Idempotent, like every other transition here. Cancelling twice is one
  // cancellation, not two events and a second reason overwriting the first.
  if (load.isCancelled)
    return tx.load.findUniqueOrThrow({ where: { id: loadId } })

  await tx.load.update({
    where: { id: loadId },
    data: {
      isCancelled: true,
      cancelledAt: new Date(),
      cancelReason: trimmed,
    },
  })

  await tx.loadStatusEvent.create({
    data: {
      loadId,
      organizationId: load.organizationId,
      axis: 'OPERATIONAL',
      fromStatus: load.operationalStatus,
      toStatus: 'CANCELLED',
      source: 'MANUAL',
      changedByUserId: options.byUserId ?? null,
      note: trimmed,
    },
  })

  return tx.load.findUniqueOrThrow({ where: { id: loadId } })
}

/** Undo a cancellation. The log keeps both events. */
export async function uncancelLoad(
  tx: TxClient,
  loadId: string,
  options: { byUserId?: string | null } = {},
) {
  const load = await tx.load.findUnique({
    where: { id: loadId },
    select: {
      organizationId: true,
      isCancelled: true,
      operationalStatus: true,
    },
  })
  if (!load) throw new ReferenceError('not_found')
  if (!load.isCancelled) {
    return tx.load.findUniqueOrThrow({ where: { id: loadId } })
  }

  await tx.load.update({
    where: { id: loadId },
    data: { isCancelled: false, cancelledAt: null, cancelReason: null },
  })

  await tx.loadStatusEvent.create({
    data: {
      loadId,
      organizationId: load.organizationId,
      axis: 'OPERATIONAL',
      fromStatus: 'CANCELLED',
      toStatus: load.operationalStatus,
      source: 'MANUAL',
      changedByUserId: options.byUserId ?? null,
    },
  })

  return tx.load.findUniqueOrThrow({ where: { id: loadId } })
}

/**
 * The one manual status click in the whole application (§7).
 *
 * Everything else on the operational axis is automatic. This is here rather
 * than as a bare `transitionOperational` call in a route so that the set of
 * statuses a human may set stays a list in one file.
 */
export async function markDelivered(
  tx: TxClient,
  loadId: string,
  userId: string | null,
): Promise<TransitionOutcome> {
  return transitionOperational(tx, loadId, 'DELIVERED', {
    source: 'MANUAL',
    userId,
  })
}

export const UI_OPERATIONAL_STATUSES: LoadOperationalStatus[] = [
  'BOOKED',
  'DISPATCHED',
  'DELIVERED',
  'POD_RECEIVED',
]

// Re-exported so callers keep one loads import. It lives in ./load-status
// because documents.ts needs it and has no business importing this module.
export { podConfirmed }

/**
 * The predicate behind the loads list's search box.
 *
 * CONTAINS, NOT EQUALS, AND THE DISTINCTION IS DELIBERATE. Exact matching is
 * the rule for JOINING a trip to a load — `planTripWrite` refuses to guess
 * that "T-115HXB4HH" and "115HXB4HH" are one reference, because guessing there
 * attaches freight to the wrong load and nobody sees it happen.
 *
 * SEARCHING IS THE OPPOSITE PROBLEM. A dispatcher holding a Relay screen types
 * what is printed in front of them, and both the prefixed and the bare form
 * exist in the wild. A substring match finds the load under either shape and a
 * human reads the answer — which is the whole question being asked: is this
 * trip in the system?
 *
 * THE LOAD NUMBER IS SEARCHED TOO. A box on a loads list that refused the
 * number printed down every other row of the same table would be a trap.
 *
 * An empty term is no filter at all, rather than a filter matching everything
 * — the caller spreads this into a `where` and `{}` is what "not filtering"
 * has to look like there.
 */
export function loadSearchWhere(term: string): Prisma.LoadWhereInput {
  const trimmed = term.trim()
  if (trimmed === '') return {}
  return {
    OR: [
      { referenceNumber: { contains: trimmed, mode: 'insensitive' } },
      { loadNumber: { contains: trimmed, mode: 'insensitive' } },
    ],
  }
}
