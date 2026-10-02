import type { Prisma } from '@/generated/prisma/client'
import { NOT_CLOSED_HISTORY } from './billing-status'
import { readyToInvoiceWhere } from './invoices'

// ---------------------------------------------------------------------------
// NAMED VIEWS OF THE LOADS LIST. ONE PREDICATE, THREE READERS.
//
// Owner's ruling, 2026-10-01, on three dashboard rows that disagreed with their
// own links. MEASURED ON DEV BEFORE THIS EXISTED:
//
//   podMissing          counted     1   its href listed 13,500
//   noRate              counted     0   its href listed    858
//   unassignedFinished  counted   101   its href listed    858
//
// The rows filtered on closed history, cancellation and revenue; the list
// filtered on `operationalStatus` alone. So "1 delivered, waiting on a POD"
// opened a list of thirteen and a half thousand rows — `dashboard.ts`'s own
// header warning, come true: "a dashboard whose numbers are computed a second
// way is a dashboard that eventually disagrees with the screen it sends you to,
// and the person stops believing both."
//
// ── A NAME IN THE URL, NEVER A RAW FILTER ───────────────────────────────
//
// The ruling: `?view=podMissing`, resolved through the SAME function the count
// uses. Not `?status=DELIVERED&closed=false&cancelled=false`, which would put
// the predicate in the link — where it can be edited to something the count
// never meant, cannot be changed without breaking every bookmark, and has to be
// kept in step by whoever next edits either end.
//
// A NAME IS A PROMISE THAT ONE FUNCTION KEEPS. The row counts it, the list
// lists it, the SQL translates it, and `tests/integration/dashboard.test.ts`
// requires the count and the listing to be the same number per row.
//
// ── THE GENERALISATION OF SOMETHING THAT ALREADY WORKED ─────────────────
//
// `readyToInvoiceWhere` has been shared between the dashboard row, the invoice
// queue and the loads list since Phase 5 — it is the one row that never
// disagreed with its link, and it is the shape the other three now take. The
// loads list already resolved `?billing=READY_TO_INVOICE` through it; this
// turns that one special case into a registry.
//
// ── NO VIEW MEANS TODAY'S BEHAVIOUR, INCLUDING CLOSED HISTORY ───────────
//
// Ruling 3. `/loads` with no `?view=` lists what it has always listed — every
// load, archive included — because "show me everything" is a real question and
// the archive is 13,517 of the answer. Closed history is excluded only where a
// VIEW says so, and each view says so in its own predicate rather than the list
// applying a rule nobody asked for.
// ---------------------------------------------------------------------------

/**
 * Delivered, and no POD. The load cannot be billed and the clock is running.
 *
 * NOT CANCELLED AND NOT ARCHIVE. A cancelled load is not waiting for anything,
 * and a load Datatruck closed two years ago has a POD somewhere nobody here
 * needs to chase.
 */
export function podMissingWhere(): Prisma.LoadWhereInput {
  return {
    ...NOT_CLOSED_HISTORY,
    deletedAt: null,
    isCancelled: false,
    operationalStatus: 'DELIVERED',
  }
}

/**
 * POD in, no rate. Nobody can invoice it and nobody is looking at it.
 *
 * `lte: 0` RATHER THAN `equals: 0`, because a negative total is also a load
 * nobody can bill and is a data problem besides — it belongs in the queue that
 * gets looked at, not in the gap between two predicates.
 */
export function noRateWhere(): Prisma.LoadWhereInput {
  return {
    ...NOT_CLOSED_HISTORY,
    deletedAt: null,
    isCancelled: false,
    operationalStatus: 'POD_RECEIVED',
    totalRevenueCents: { lte: 0 },
  }
}

/**
 * Finished, billable, and attached to nobody.
 *
 * MOVED HERE FROM `dashboard.ts`, where it was exported and read by no screen —
 * which is how its row came to point at `/loads?status=POD_RECEIVED` and list
 * 858 rows against a count of 101.
 *
 * EITHER HALF MISSING IS THE ALARM. Driver is the one that stops the pay; truck
 * is the owner's ruling and the evidence that a POD arrived for a movement
 * nobody witnessed.
 */
export function unassignedFinishedWhere(): Prisma.LoadWhereInput {
  return {
    ...NOT_CLOSED_HISTORY,
    deletedAt: null,
    isCancelled: false,
    operationalStatus: 'POD_RECEIVED',
    totalRevenueCents: { gt: 0 },
    OR: [{ driverId: null }, { truckId: null }],
  }
}

/**
 * Booked or available, with no truck or no driver on it.
 *
 * ITS ROW POINTS AT `/dispatch`, NOT AT THIS VIEW, and the view exists anyway:
 * the dispatch board is a different screen with its own shape, and a reader who
 * wants the same set as a LIST should be able to ask for it. The row's link is
 * unchanged by ruling — dispatch is where that work is done.
 */
export function unassignedWhere(): Prisma.LoadWhereInput {
  return {
    ...NOT_CLOSED_HISTORY,
    deletedAt: null,
    isCancelled: false,
    operationalStatus: { in: ['AVAILABLE', 'BOOKED'] },
    OR: [{ driverId: null }, { truckId: null }],
  }
}

/**
 * Every named view, by the name that appears in `?view=`.
 *
 * THE KEYS ARE THE DASHBOARD ROW KEYS, deliberately: the row's href is its own
 * name, so a reader comparing `dash.action.podMissing` to `?view=podMissing`
 * sees one word. A separate URL vocabulary would be a second name for one set,
 * which is the thing this module exists to stop.
 */
export const LOAD_VIEWS = {
  podMissing: podMissingWhere,
  noRate: noRateWhere,
  unassignedFinished: unassignedFinishedWhere,
  unassigned: unassignedWhere,
  readyToInvoice: readyToInvoiceWhere,
} satisfies Record<string, () => Prisma.LoadWhereInput>

export type LoadViewName = keyof typeof LOAD_VIEWS

export function isLoadViewName(value: string): value is LoadViewName {
  return Object.hasOwn(LOAD_VIEWS, value)
}

/**
 * The predicate for a `?view=` parameter, or `{}` for anything else.
 *
 * AN UNKNOWN NAME NARROWS NOTHING rather than matching nothing. A typo'd view
 * that returned an impossible predicate would render an empty list, which reads
 * as "no loads are in this state" — a confident answer to a question nobody
 * asked. An unfiltered list is obviously not what was meant.
 */
export function viewWhere(value: string | undefined): Prisma.LoadWhereInput {
  if (value === undefined || !isLoadViewName(value)) return {}
  return LOAD_VIEWS[value]()
}
