// ---------------------------------------------------------------------------
// THE BATCH SCREEN'S STATEMENTS, TABS AND RAIL (§6.2.10 part 7 step 3, v11.32;
// owner's brief 2026-11-18, rulings R8, R11, R12 of 2026-11-17).
//
// PURE. Every figure here is a stored `Settlement` column or a sum of them —
// nothing is priced, nothing is derived from a rule. The engine wrote these
// numbers; this module only filters, counts and adds them, so the screen and
// the statements it lists cannot disagree.
// ---------------------------------------------------------------------------

/** What the screen needs of one statement, as the head reads it. */
export interface BatchStatementFigures {
  status: string
  lines: number
  grossCents: number
  earningsCents: number
  otherPayCents: number
  reimbursementsCents: number
  deductionsCents: number
  advancesCents: number
  netCents: number
}

// ── THE TABS: ALL · UNPOSTED · POSTED · PAID ─────────────────────────────

export const BATCH_TABS = ['all', 'unposted', 'posted', 'paid'] as const
export type BatchTab = (typeof BATCH_TABS)[number]

/**
 * The stored status each tab shows — `pay-status.ts`'s words, read backwards:
 * Unposted is DRAFT, Posted is APPROVED, Paid is PAID. All is null: every
 * statement, a VOID one included (struck through on the grid). No tab is
 * Void's alone.
 */
const TAB_STATUS: Record<BatchTab, string | null> = {
  all: null,
  unposted: 'DRAFT',
  posted: 'APPROVED',
  paid: 'PAID',
}

/** `?tab=` as typed; anything unknown is All, never an empty table. */
export function batchTabOf(raw: unknown): BatchTab {
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' &&
    (BATCH_TABS as readonly string[]).includes(value)
    ? (value as BatchTab)
    : 'all'
}

export function statementsForTab<T extends { status: string }>(
  statements: readonly T[],
  tab: BatchTab,
): T[] {
  const status = TAB_STATUS[tab]
  return status === null
    ? [...statements]
    : statements.filter((row) => row.status === status)
}

export function batchTabCounts(
  statements: readonly { status: string }[],
): Record<BatchTab, number> {
  return {
    all: statements.length,
    unposted: statementsForTab(statements, 'unposted').length,
    posted: statementsForTab(statements, 'posted').length,
    paid: statementsForTab(statements, 'paid').length,
  }
}

// ── THE RIGHT RAIL'S TOTALS ──────────────────────────────────────────────

export interface BatchTotals {
  trips: number
  statements: number
  unposted: number
  posted: number
  paid: number
  grossCents: number
  /** Total pay — the same stored figure as gross, by R12 as reversed. */
  totalPayCents: number
  earningsCents: number
  otherPayCents: number
  reimbursementsCents: number
  deductionsCents: number
  advancesCents: number
  netCents: number
}

/**
 * Each money total is the SUM of that stored column over the batch's
 * NON-VOID statements. A void statement is history, not money: it was struck,
 * and adding it would pay a week twice on the rail. Its count is not in
 * `statements` either; it is still listed under All.
 */
export function batchTotals(
  statements: readonly BatchStatementFigures[],
): BatchTotals {
  const live = statements.filter((row) => row.status !== 'VOID')
  const sum = (pick: (row: BatchStatementFigures) => number) =>
    live.reduce((total, row) => total + pick(row), 0)
  const counts = batchTabCounts(live)
  const grossCents = sum((row) => row.grossCents)
  return {
    trips: sum((row) => row.lines),
    statements: live.length,
    unposted: counts.unposted,
    posted: counts.posted,
    paid: counts.paid,
    grossCents,
    totalPayCents: grossCents,
    earningsCents: sum((row) => row.earningsCents),
    otherPayCents: sum((row) => row.otherPayCents),
    reimbursementsCents: sum((row) => row.reimbursementsCents),
    deductionsCents: sum((row) => row.deductionsCents),
    advancesCents: sum((row) => row.advancesCents),
    netCents: sum((row) => row.netCents),
  }
}

/**
 * Editable while any statement is Unposted — the batch is DRAFT or PARTIAL.
 * The server verbs ask `refreshDraft`'s own question; this only decides
 * whether the screen offers the controls.
 */
export function batchEditable(status: string): boolean {
  return status === 'DRAFT' || status === 'PARTIAL'
}

// ── THE WEEK NUMBER (R8, PROVISIONAL) ────────────────────────────────────

const DAY_MS = 86_400_000

/** The first Sunday of a UTC year. */
function firstSundayOf(year: number): number {
  const jan1 = Date.UTC(year, 0, 1)
  const weekday = new Date(jan1).getUTCDay()
  return jan1 + ((7 - weekday) % 7) * DAY_MS
}

/**
 * Datatruck's week number, from one sample (period 11/01–11/07/2026 → 44):
 * week 1 is the week starting the year's FIRST SUNDAY (2026-01-04). Neither
 * ISO nor US numbering gives 44 there. A period that starts before that
 * Sunday belongs to the previous year's count. PROVISIONAL until a second
 * batch confirms it (R8) — the rail says so beside the number.
 */
export function datatruckWeekNumber(periodStart: Date): number {
  const day = Date.UTC(
    periodStart.getUTCFullYear(),
    periodStart.getUTCMonth(),
    periodStart.getUTCDate(),
  )
  let first = firstSundayOf(periodStart.getUTCFullYear())
  if (day < first) first = firstSundayOf(periodStart.getUTCFullYear() - 1)
  return Math.floor((day - first) / (7 * DAY_MS)) + 1
}

// ── THE TABLE'S COLUMNS (R11, R12) ───────────────────────────────────────

/**
 * Ten, in the table's order. §7.1.7 caps a table at nine, so Truck goes
 * behind the chooser by default (R11). Statement is first and locked.
 */
export const BATCH_STATEMENT_COLUMNS = [
  'statement',
  'driverType',
  'truck',
  'payee',
  'status',
  'trips',
  'payRule',
  'totalPay',
  'totalGross',
  'netPay',
] as const

export const BATCH_STATEMENT_COLUMNS_HIDDEN = ['truck'] as const

// ── ADD DRIVER (R14 (b)) ─────────────────────────────────────────────────

/**
 * The drivers this batch has excluded a trip of, each with those trips — the
 * choices Add driver offers. Read from the preview's available trips, where
 * `excluded` is the persisted exclusion and nothing else.
 */
export function excludedDrivers(
  trips: readonly {
    excluded: boolean
    driverId: string | null
    driverName: string | null
    loadId: string
  }[],
): { driverId: string; driverName: string; loadIds: string[] }[] {
  const byDriver = new Map<
    string,
    { driverId: string; driverName: string; loadIds: string[] }
  >()
  for (const trip of trips) {
    if (!trip.excluded || trip.driverId === null) continue
    const entry = byDriver.get(trip.driverId) ?? {
      driverId: trip.driverId,
      driverName: trip.driverName ?? trip.driverId,
      loadIds: [],
    }
    entry.loadIds.push(trip.loadId)
    byDriver.set(trip.driverId, entry)
  }
  return [...byDriver.values()].sort((a, b) =>
    a.driverName.localeCompare(b.driverName),
  )
}
