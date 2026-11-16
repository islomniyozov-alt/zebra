import type { LoadOperationalStatus, Prisma } from '@/generated/prisma/client'
import { unpaidWhere, upcomingWhere, type ViewContext } from './load-views'

// ---------------------------------------------------------------------------
// THE LOADS LIST'S SIX TABS (TMS-DESIGN-SYSTEM.md §6.7, the second pass,
// owner's brief 2026-11-16): All loads · Upcoming · Dispatched · In transit ·
// Delivered · Unpaid. `?tab=`; no tab is All loads.
//
// ONE PREDICATE PER TAB, and this is the Prisma spelling. The grouped count
// restates the three status tabs in SQL from `TAB_STATUSES` below, so the two
// spellings share their lists, and Upcoming and Unpaid ARE the two views item
// 6 already defined — the same function, not a copy. The agreement test in
// `tests/integration/load-list.test.ts` holds each tab's count to its rows,
// both above zero.
// ---------------------------------------------------------------------------

export const LOAD_TABS = [
  'upcoming',
  'dispatched',
  'inTransit',
  'delivered',
  'unpaid',
] as const

export type LoadTab = (typeof LOAD_TABS)[number]

export function isLoadTab(value: string | undefined): value is LoadTab {
  return value !== undefined && (LOAD_TABS as readonly string[]).includes(value)
}

/**
 * The statuses of the three status tabs. A cancelled load is in none of them:
 * a cancelled load is not in transit, whatever its status column last said.
 */
export const TAB_STATUSES = {
  dispatched: ['DISPATCHED', 'AT_PICKUP'],
  inTransit: ['LOADED', 'IN_TRANSIT', 'AT_DELIVERY'],
  // Closed history is included: it was delivered.
  delivered: ['DELIVERED', 'POD_RECEIVED'],
} as const satisfies Record<string, readonly LoadOperationalStatus[]>

/** A tab's rows. An absent or unknown tab narrows nothing: All loads. */
export function tabWhere(
  tab: string | undefined,
  ctx: ViewContext,
): Prisma.LoadWhereInput {
  if (!isLoadTab(tab)) return {}
  if (tab === 'upcoming') return upcomingWhere(ctx)
  if (tab === 'unpaid') return unpaidWhere()
  return {
    isCancelled: false,
    operationalStatus: { in: [...TAB_STATUSES[tab]] },
  }
}
