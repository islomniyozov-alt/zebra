import type { DriverStatus } from '@/generated/prisma/client'
import { ReferenceError } from './reference'

// ---------------------------------------------------------------------------
// WHAT THE ROSTER SAYS ABOUT A PERSON — AND NOTHING ABOUT THEIR FREIGHT.
//
// `Driver.status` used to carry six values answering two questions. Three of
// them described the freight, which item 11 now derives on every read, and a
// fourth described something no freight can show, which item 11 gave a column
// of its own. Migration 55 moved the rows; this file is why they cannot come
// back.
//
// ── THE THREE THAT REMAIN ────────────────────────────────────────────────
//
//   AVAILABLE — on the roster and working. The interface calls it ACTIVE, and
//               the label matters: "Available" is a sentence about today's
//               freight, and the freight is not what this column knows.
//   VACATION  — a person on holiday. A roster fact somebody types.
//   INACTIVE  — no longer drives here. 69 of these arrived with the Datatruck
//               import and they are the reason 4,118 historical loads can
//               point at a driver at all.
//
// ── WHY THIS IS A LIST AND NOT THE ENUM ──────────────────────────────────
//
// Postgres cannot drop an enum value, and recreating `DriverStatus` would mean
// rewriting a table every settlement points at in order to delete three
// strings no row holds. So the three dead values stay reachable by the type
// system and unreachable by the application, and the gap between those two is
// exactly what `assertRosterStatus` closes — by name, at the one place a
// status is written.
// ---------------------------------------------------------------------------

export const ROSTER_STATUSES = [
  'AVAILABLE',
  'VACATION',
  'INACTIVE',
] as const satisfies readonly DriverStatus[]

export type RosterStatus = (typeof ROSTER_STATUSES)[number]

/**
 * The one roster value that means "working here, now".
 *
 * Everything else on the roster is an exception worth showing on a list, which
 * is what `rosterBadge` turns it into.
 */
export const ACTIVE_ROSTER = 'AVAILABLE' satisfies RosterStatus

/**
 * The three the freight answers for. Nothing may write them.
 *
 * Listed rather than derived from the enum so that adding a genuinely new
 * roster value — LEAVE_OF_ABSENCE, say — does not silently land here.
 */
export const DERIVED_STATUSES = [
  'DISPATCHED',
  'ON_ROUTE',
  'OFF_DUTY',
] as const satisfies readonly DriverStatus[]

export function isRosterStatus(value: DriverStatus): value is RosterStatus {
  return (ROSTER_STATUSES as readonly DriverStatus[]).includes(value)
}

/**
 * Refuse a status the roster does not get to state.
 *
 * THE REFUSAL IS THE POINT, not a fallback. Quietly coercing DISPATCHED to
 * AVAILABLE would let a form, an import or a script keep writing a value that
 * means nothing and never say so — and the last time this column was written
 * by hand, it disagreed with the freight for months.
 */
export function assertRosterStatus(
  value: DriverStatus | undefined,
): RosterStatus | undefined {
  if (value === undefined) return undefined
  if (!isRosterStatus(value)) {
    throw new ReferenceError('not_roster_status', { field: 'status' })
  }
  return value
}

/**
 * The roster badge for a list, or null when there is nothing to say.
 *
 * ONE STATUS PER ROW (owner's ruling, 2026-09-21). The derived dispatch status
 * is what a list shows; the roster only interrupts when it contradicts the
 * assumption that the person works here — on holiday, or gone. An active
 * driver's roster value adds nothing a dispatcher can act on, so it is not a
 * second badge saying so.
 */
export function rosterBadge(status: DriverStatus): RosterStatus | null {
  if (status === ACTIVE_ROSTER) return null
  return isRosterStatus(status) ? status : null
}
