import type { Prisma } from '@/generated/prisma/client'
import { readPreference, writePreference } from './preferences'
import { visibleColumns } from './list-view'
import { visibleWithinCap } from './list-columns'
import type { Resource } from './permissions'

type TxClient = Prisma.TransactionClient

// ---------------------------------------------------------------------------
// WHICH COLUMNS A PERSON KEEPS, PER TABLE (§7.1.4).
//
// §7.1 has required a columns chooser since Phase 1 for anything past nine
// columns, and never said where the choice lives. It lives here, in
// `UserPreference` under `columns.<table>` — the namespace `schema.prisma`'s own
// comment on that model reserved before anything used it.
//
// ── EVERY TAB IS ITS OWN TABLE ────────────────────────────────────────────
//
// §7.1.6: each tab owns its columns. `columns.payroll.batches` and
// `columns.payroll.balances` are different keys, because they are different grids
// and a shared key would hide a column in one by name that only exists in the
// other.
//
// ── THE GRID IDS ARE A CLOSED LIST ────────────────────────────────────────
//
// Not free text. A typo'd id writes a preference row nothing reads and hides
// nothing, which is the most boring possible bug and takes an afternoon: the
// control appears to work, the choice appears to save, and the next page load
// shows every column again.
// ---------------------------------------------------------------------------

export const GRID_IDS = [
  'invoices.invoices',
  'invoices.ready',
  'invoices.direct',
  'payments.payments',
  'payments.unapplied',
  'payroll.batches',
  'payroll.statements',
  'payroll.balances',
  'payroll.oneTime',
  'payroll.scheduled',
  'charges.scheduled',
  // §6.2.4, migration 61. Nine columns, which is exactly §7.1's cap — so the
  // chooser here hides rather than reveals, and `Table` would throw if a tenth
  // were added without one going behind it.
  'charges.standing',
  'charges.oneTime',
  'reports.driver',
  // §6.2.10 part 4 — every pay line in a window, by driver. Added 2026-10-06.
  'reports.transactions',
  // THE WORKBENCH'S TRIPS GRID. Eleven columns, nine shown — §6.2.2 as
  // corrected in v10.2, because §7.1 caps a table at nine and throws above
  // it. This is the grid that found the cap.
  'settlements.trips',
  // THE TWO OPERATIONAL LISTS, §7.1.7, added 2026-10-04. Not Accounting, and
  // the first entries here that are not: ten and eleven columns respectively,
  // both over the cap, both returning 500 until they got a chooser. See
  // `src/lib/list-columns.ts`.
  'loads.loads',
  'trucks.trucks',
] as const

export type GridId = (typeof GRID_IDS)[number]

export function isGridId(value: string): value is GridId {
  return (GRID_IDS as readonly string[]).includes(value)
}

/**
 * The resource whose `read` permission the chooser asks about.
 *
 * YOU MAY TIDY A GRID YOU MAY READ, and that is the whole rule. Hiding a column
 * writes a `UserPreference` row belonging to the person who pressed it, so the
 * question is only whether they are entitled to be looking at the grid at all.
 *
 * THIS IS HERE BECAUSE THE CHOOSER ASKED ABOUT `settlement` FOR EVERY GRID.
 * True of the Accounting tabs it was built for, and false the moment §7.1.7 put
 * one on `/loads` and `/trucks`: a DISPATCHER has `load:read` and `truck:read`
 * and no settlement permission at all, so the control would have rendered,
 * submitted, and thrown ForbiddenError for the role that lives on those screens.
 */
export function gridResource(grid: GridId): Resource {
  if (grid === 'loads.loads') return 'load'
  if (grid === 'trucks.trucks') return 'truck'
  return 'settlement'
}

/**
 * The path to revalidate after a choice is stored.
 *
 * A PREFERENCE IS PER USER AND NOT PER PAGE: the same grid may be open in
 * another window. Accounting revalidates its whole layout because its tabs share
 * one; the two operational lists are their own routes.
 */
export function gridRevalidate(grid: GridId): {
  path: string
  type: 'page' | 'layout'
} {
  if (grid === 'loads.loads') return { path: '/loads', type: 'page' }
  if (grid === 'trucks.trucks') return { path: '/trucks', type: 'page' }
  return { path: '/accounting', type: 'layout' }
}

const keyFor = (grid: GridId) => `columns.${grid}`

/**
 * The columns this person sees on this grid, in the table's own order.
 *
 * ORDER COMES FROM THE TABLE, NOT THE PREFERENCE. A stored list is a SET of
 * what to show; letting it reorder columns too would mean a five-phase-old
 * preference deciding that money sits left of a load number.
 *
 * ── AND IT NEVER RETURNS MORE THAN §7.1's NINE (§7.1.7) ───────────────────
 *
 * THE CAP IS HERE BECAUSE THREE PAGES PROVED IT CANNOT BE PER PAGE. A grid with
 * no stored preference gets EVERYTHING back — correct for eight columns, a 500
 * for eleven, since `Table` throws above nine. `/loads` and `/trucks` were down
 * for two weeks that way; `/payroll/batches` joined them the day §6.2.9 added
 * three columns to it, with a chooser already on the page and a guard already
 * checking its key list against its `Column` array. Neither noticed, because
 * both were asking a different question.
 *
 * So the one function every grid already calls is where the count gets bounded.
 * `defaultHidden` is how a page says WHICH columns go first, and a page over the
 * cap that does not say loses its last columns — visibly, and to a control that
 * puts them back, rather than to a stack trace.
 */
export async function readGridColumns(
  tx: TxClient,
  userId: string,
  grid: GridId,
  available: readonly string[],
  defaultHidden: readonly string[] = [],
): Promise<string[]> {
  return visibleWithinCap(
    available,
    defaultHidden,
    visibleColumns(available, await readPreference(tx, userId, keyFor(grid))),
  )
}

export type SaveColumnsFailure = 'unknown_grid' | 'no_columns'

export type SaveColumnsResult =
  | { ok: true }
  | { ok: false; reason: SaveColumnsFailure }

/**
 * Store a choice. Refuses an empty one.
 *
 * A GRID WITH NO COLUMNS IS NOT A PREFERENCE, it is a blank screen somebody
 * would report as a broken page. `visibleColumns` already falls back to
 * everything on read, so this refusal is belt and braces on the way in — and the
 * two together mean neither a bad write nor a stale row can produce one.
 */
export async function saveGridColumns(
  tx: TxClient,
  organizationId: string,
  userId: string,
  grid: string,
  columns: readonly string[],
): Promise<SaveColumnsResult> {
  if (!isGridId(grid)) return { ok: false, reason: 'unknown_grid' }
  const kept = columns.filter((name) => name.length > 0)
  if (kept.length === 0) return { ok: false, reason: 'no_columns' }
  await writePreference(tx, organizationId, userId, keyFor(grid), kept)
  return { ok: true }
}
