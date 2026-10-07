import type { DriverStatus, Prisma } from '@/generated/prisma/client'
import type { TxClient } from './tenancy'

// ---------------------------------------------------------------------------
// THE DRIVERS LIST TAKES DATATRUCK'S SHAPE (§6.4 part 1, queue item 16).
//
// Two things the page cannot own, because a page cannot be unit-tested and
// both are rules: which rows each TAB selects, and when a driver is READY TO
// GO. Both are pure where they can be and asked of the database in one place
// where they cannot.
// ---------------------------------------------------------------------------

/**
 * Five tabs over one grid (§7.1.6), each a different QUESTION:
 *
 *   active      the roster at work — not removed, not INACTIVE, not VACATION
 *   unassigned  active, with no truck — the dispatcher's own question
 *   all         every roster row; a REMOVED row is a mistake, not a person,
 *               and stays behind the existing toggle rather than in a tab
 *   terminated  INACTIVE, with the termination date as a column
 *   vacation    VACATION, or an off-duty return date still ahead
 */
export const DRIVER_TABS = [
  'active',
  'unassigned',
  'all',
  'terminated',
  'vacation',
] as const

export type DriverTab = (typeof DRIVER_TABS)[number]

export function isDriverTab(value: string): value is DriverTab {
  return (DRIVER_TABS as readonly string[]).includes(value)
}

/** The roster "at work": everything that is not on holiday and not gone. */
export const WORKING_STATUSES: readonly DriverStatus[] = [
  'AVAILABLE',
  'DISPATCHED',
  'ON_ROUTE',
  'OFF_DUTY',
]

/**
 * The rows a tab selects. `includeRemoved` is the page's existing toggle and
 * widens the tab to the rows somebody soft-deleted — it is a question about
 * mistakes, orthogonal to every tab, which is why it is a flag and not a sixth.
 */
export function driverTabWhere(
  tab: DriverTab,
  now: Date,
  includeRemoved = false,
): Prisma.DriverWhereInput {
  const kept: Prisma.DriverWhereInput = includeRemoved
    ? {}
    : { deletedAt: null }
  switch (tab) {
    case 'active':
      return { ...kept, status: { in: [...WORKING_STATUSES] } }
    case 'unassigned':
      return {
        ...kept,
        status: { in: [...WORKING_STATUSES] },
        assignedTruckId: null,
      }
    case 'all':
      return kept
    case 'terminated':
      return { ...kept, status: 'INACTIVE' }
    case 'vacation':
      return {
        ...kept,
        OR: [{ status: 'VACATION' }, { offDutyUntil: { gt: now } }],
      }
  }
}

/**
 * Every tab's count, by a COUNT(*) of its own question (§6.2.8) — never by the
 * length of a capped list. Five statements for the whole page.
 */
export async function countDriverTabs(
  tx: TxClient,
  base: Prisma.DriverWhereInput,
  now: Date,
  includeRemoved = false,
): Promise<Record<DriverTab, number>> {
  const counts = await Promise.all(
    DRIVER_TABS.map((tab) =>
      tx.driver.count({
        where: { AND: [base, driverTabWhere(tab, now, includeRemoved)] },
      }),
    ),
  )
  return Object.fromEntries(
    DRIVER_TABS.map((tab, index) => [tab, counts[index] ?? 0]),
  ) as Record<DriverTab, number>
}

// ── ASSIGN STATUS — READY TO GO / NOT READY ────────────────────────────────

export type NotReadyReason =
  | 'not_qualifiable'
  | 'dqf'
  | 'no_truck'
  | 'truck_expired'

export interface Readiness {
  ready: boolean
  /** The FIRST reason, in the order a dispatcher would fix them. Null when ready. */
  reason: NotReadyReason | null
}

export interface ReadinessFacts {
  /** On the roster and a person — §6.2's DQF rule (`isQualifiable`). */
  qualifiable: boolean
  /** Missing or expired DQF entries (`dqfIncompleteCount`). */
  dqfIncomplete: number
  truckAssigned: boolean
  /** The assigned truck carries an expired compliance item. */
  truckExpired: boolean
}

/**
 * Derived on read, never stored (§6.4). A driver is ready when they are
 * qualifiable, their DQF has nothing missing or expired, a truck is assigned,
 * and that truck carries no expired compliance. "Not ready" names the FIRST
 * reason, because a red that does not say why is a red people learn to ignore.
 */
export function readinessFor(facts: ReadinessFacts): Readiness {
  if (!facts.qualifiable) return { ready: false, reason: 'not_qualifiable' }
  if (facts.dqfIncomplete > 0) return { ready: false, reason: 'dqf' }
  if (!facts.truckAssigned) return { ready: false, reason: 'no_truck' }
  if (facts.truckExpired) return { ready: false, reason: 'truck_expired' }
  return { ready: true, reason: null }
}
