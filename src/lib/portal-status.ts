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

export type PortalStatusOutcome =
  | { ok: true; from: LoadOperationalStatus; to: DriverStep }
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
    return { ok: true, from: outcome.from, to: next }
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
