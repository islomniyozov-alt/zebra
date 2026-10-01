import type { Prisma } from '@/generated/prisma/client'
import { readPreference, writePreference } from './preferences'
import { visibleColumns } from './list-view'

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
  // THE WORKBENCH'S TRIPS GRID. Eleven columns, nine shown — §6.2.2 as
  // corrected in v10.2, because §7.1 caps a table at nine and throws above
  // it. This is the grid that found the cap.
  'settlements.trips',
] as const

export type GridId = (typeof GRID_IDS)[number]

export function isGridId(value: string): value is GridId {
  return (GRID_IDS as readonly string[]).includes(value)
}

const keyFor = (grid: GridId) => `columns.${grid}`

/**
 * The columns this person sees on this grid, in the table's own order.
 *
 * ORDER COMES FROM THE TABLE, NOT THE PREFERENCE. A stored list is a SET of
 * what to show; letting it reorder columns too would mean a five-phase-old
 * preference deciding that money sits left of a load number.
 */
export async function readGridColumns(
  tx: TxClient,
  userId: string,
  grid: GridId,
  available: readonly string[],
): Promise<string[]> {
  return visibleColumns(
    available,
    await readPreference(tx, userId, keyFor(grid)),
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
