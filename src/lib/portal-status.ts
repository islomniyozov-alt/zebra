import type { LoadOperationalStatus } from '@/generated/prisma/client'
import type { TxClient } from './tenancy'
import { transitionOperational } from './load-status'
import { ownDriver } from './portal'

// ---------------------------------------------------------------------------
// THE DRIVER'S ONE WRITE ON A LOAD (Phase 7 step 4; §9 "The write rules";
// PHASE-7-BRIEF.md §4.4 and §4.5, ruled 2026-11-12).
//
// ONE FORWARD STEP AT A TIME, the engine's own rule. `transitionOperational`
// already refuses a backwards move and writes the refusal to the timeline;
// what it does NOT refuse is a jump forward (a dispatcher may press Delivered
// on a Dispatched load), so the portal narrows it here: the only status a
// driver may ask for is the next one on the driver's ladder, computed from
// the load's status AT THE MOMENT OF THE WRITE — a stale tap (the screen
// showed Dispatched, the office had already moved it) is refused in words,
// never applied as a second step. A missed tap is the office's correction on
// the board, where the timeline shows who moved what.
//
// THE DRIVER OF RECORD ONLY. A co-driver sees the load and never sets its
// status (§4.5): the button is not rendered for the second seat, and the
// write refuses the second seat by name, because a button that is not
// rendered is not a permission.
//
// SOURCE: DRIVER_PORTAL, WITH THE USER. The load's timeline prints "driver
// portal" beside the driver's name; the office reads it on /loads/[id].
// ---------------------------------------------------------------------------

/**
 * The driver's ladder, in order. BOOKED is the office's (dispatch assigns
 * the truck and the driver), POD_RECEIVED is the office's (the paperwork
 * landing, never a click — §7). The driver walks the six between.
 */
export const DRIVER_STEPS = [
  'DISPATCHED',
  'AT_PICKUP',
  'LOADED',
  'IN_TRANSIT',
  'AT_DELIVERY',
  'DELIVERED',
] as const satisfies readonly LoadOperationalStatus[]

export type DriverStep = (typeof DRIVER_STEPS)[number]

/**
 * The one status a driver may set next from `status`, or null when the
 * ladder has no next rung for them: before DISPATCHED (the office's), at
 * DELIVERED or after (finished, or the office's POD).
 */
export function nextStatusFor(
  status: LoadOperationalStatus,
): DriverStep | null {
  const index = (DRIVER_STEPS as readonly string[]).indexOf(status)
  if (index < 0) return null
  return DRIVER_STEPS[index + 1] ?? null
}

export type PortalStatusFailure =
  | 'no_driver_row'
  | 'not_own_load'
  | 'co_driver'
  | 'cancelled'
  | 'no_next_step'
  | 'not_the_next_step'

/** Which stop clock a rung stamps (flag 8, ruled 2026-11-12). */
export const STOP_CLOCK_FOR_STEP: Partial<
  Record<
    DriverStep,
    { type: 'PICKUP' | 'DELIVERY'; clock: 'arrivedAt' | 'departedAt' }
  >
> = {
  AT_PICKUP: { type: 'PICKUP', clock: 'arrivedAt' },
  LOADED: { type: 'PICKUP', clock: 'departedAt' },
  AT_DELIVERY: { type: 'DELIVERY', clock: 'arrivedAt' },
  DELIVERED: { type: 'DELIVERY', clock: 'departedAt' },
}

export interface StampedClock {
  stopId: string
  clock: 'arrivedAt' | 'departedAt'
}

/**
 * How far back a replayed tap may carry its clock (step 6; §9 offline
 * queue). A phone that kept "At pickup" for a day of no signal still knows
 * when the truck arrived; one that kept it for a week is telling a story the
 * office should hear from the driver, not from a clock.
 */
export const TAP_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * The time a stop is clocked at: THE TAP, when the queue replays one the
 * phone kept, as long as it is inside the window and not in the future (a
 * phone's clock ahead of ours is not an arrival that has not happened); else
 * the write. The status event keeps the write's time either way — when the
 * office learned — and the stop's clock is when the truck was there.
 */
export function clockTimeFor(tappedAt: Date | undefined, now: Date): Date {
  if (!tappedAt || Number.isNaN(tappedAt.getTime())) return now
  const age = now.getTime() - tappedAt.getTime()
  if (age < 0 || age > TAP_WINDOW_MS) return now
  return tappedAt
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/

/**
 * The form's `tappedAt`: an ISO instant with a Z, as the portal writes it,
 * or nothing. A bare date or a word is nothing — the stop then clocks at the
 * write, never at midnight.
 */
export function tappedAtFrom(value: unknown): Date | undefined {
  if (typeof value !== 'string' || !ISO_INSTANT.test(value)) return undefined
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

/**
 * Stamp the clock a rung means, on the first stop of that type whose clock
 * is still empty — "At pickup" the pickup's arrival, "Loaded" its departure,
 * the same pair for delivery. NEVER OVER A VALUE THE OFFICE PUT THERE: a
 * stop already clocked is left alone, and the tap stamps nothing, which is
 * what `null` says. A departure on a stop with no arrival stamps both, since
 * a truck that left was there. Intermediate stops are not on the ladder and
 * are the office's to clock.
 */
export async function stampStopForStep(
  tx: TxClient,
  loadId: string,
  step: DriverStep,
  at: Date,
): Promise<StampedClock | null> {
  const rule = STOP_CLOCK_FOR_STEP[step]
  if (!rule) return null
  const stop = await tx.loadStop.findFirst({
    where: { loadId, type: rule.type, [rule.clock]: null },
    orderBy: { sequence: 'asc' },
    select: { id: true, arrivedAt: true },
  })
  if (!stop) return null
  await tx.loadStop.update({
    where: { id: stop.id },
    data: {
      [rule.clock]: at,
      ...(rule.clock === 'departedAt' && stop.arrivedAt === null
        ? { arrivedAt: at }
        : {}),
    },
  })
  return { stopId: stop.id, clock: rule.clock }
}

export type PortalStatusOutcome =
  | {
      ok: true
      from: LoadOperationalStatus
      to: DriverStep
      /** The clock the tap stamped, or null when the office had it already. */
      stamped: StampedClock | null
    }
  /** The load was already there — a double tap. Nothing written. */
  | { ok: true; already: DriverStep }
  | { ok: false; reason: PortalStatusFailure; at?: LoadOperationalStatus }

/**
 * Record one forward step from the portal.
 *
 * `to` is what the screen offered; it is checked against the ladder from the
 * load's CURRENT status, so the tap that arrives after the office moved the
 * load is refused rather than stacked. The engine does the write and the
 * timeline row.
 */
export async function recordPortalStatus(
  tx: TxClient,
  session: { userId: string },
  loadId: string,
  to: LoadOperationalStatus,
  options: {
    /** When the driver tapped — a replayed tap from the phone's queue. */
    tappedAt?: Date
  } = {},
): Promise<PortalStatusOutcome> {
  const driver = await ownDriver(tx, session)
  if (!driver) return { ok: false, reason: 'no_driver_row' }

  const load = await tx.load.findFirst({
    where: { id: loadId, deletedAt: null },
    select: {
      driverId: true,
      coDriverId: true,
      isCancelled: true,
      operationalStatus: true,
    },
  })
  if (!load) return { ok: false, reason: 'not_own_load' }
  if (load.driverId !== driver.id) {
    // THE SECOND SEAT IS NAMED, NOT HIDDEN INSIDE "not yours": the sentence
    // on the screen says who may set it.
    return load.coDriverId === driver.id
      ? { ok: false, reason: 'co_driver', at: load.operationalStatus }
      : { ok: false, reason: 'not_own_load' }
  }
  if (load.isCancelled) {
    return { ok: false, reason: 'cancelled', at: load.operationalStatus }
  }

  const next = nextStatusFor(load.operationalStatus)
  if (next === null) {
    return { ok: false, reason: 'no_next_step', at: load.operationalStatus }
  }
  if (to !== next) {
    // The screen offered a step the load has moved past (or has not reached):
    // the office's hand, or a second tap after the first landed. Refused in
    // words; the page re-reads and offers the real next one.
    return {
      ok: false,
      reason: 'not_the_next_step',
      at: load.operationalStatus,
    }
  }

  const outcome = await transitionOperational(tx, loadId, next, {
    source: 'DRIVER_PORTAL',
    userId: session.userId,
  })
  if (outcome.result === 'moved') {
    // THE TAP IS THE STOP'S CHECK-IN (flag 8, ruled 2026-11-12): the rung
    // stamps the clock it means, in the same transaction, under the driver's
    // own attribution — so the load's stop table and its timeline both say
    // the driver, and the office's later edit is a second audited write. A
    // tap the phone kept while offline carries its own time (step 6), and
    // the clock is that time when it is inside the window.
    const stamped = await stampStopForStep(
      tx,
      loadId,
      next,
      clockTimeFor(options.tappedAt, new Date()),
    )
    return { ok: true, from: outcome.from, to: next, stamped }
  }
  if (outcome.result === 'unchanged') return { ok: true, already: next }
  if (outcome.result === 'cancelled') {
    return { ok: false, reason: 'cancelled', at: outcome.at }
  }
  // `stale` cannot happen past the checks above — the engine's rank guard is
  // the belt to this file's braces — but the type says it can, and a refusal
  // in words beats a throw.
  return { ok: false, reason: 'not_the_next_step', at: outcome.at }
}
