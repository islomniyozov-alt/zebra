// ---------------------------------------------------------------------------
// THE STATEMENT PAGE'S SEVEN TABS (TMS §6.2.10 part 7 step 4, v11.33; ruling
// R16, reaffirmed by the owner 2026-11-18).
//
// PURE. Which tab a line belongs to, decided once, so the counts on the tab
// strip and the rows under each tab cannot disagree. Every tab is shown with
// its count, a zero included: the strip is the same on every statement, so a
// zero reads "Zebra looked and there is none" (R16).
// ---------------------------------------------------------------------------

export const STATEMENT_TABS = [
  'trips',
  'fuel',
  'toll',
  'balances',
  'recurring',
  'oneTime',
  'attachments',
] as const
export type StatementTab = (typeof STATEMENT_TABS)[number]

/** `?tab=` as typed; anything unknown is Trips, never an empty page. */
export function statementTabOf(raw: unknown): StatementTab {
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' &&
    (STATEMENT_TABS as readonly string[]).includes(value)
    ? (value as StatementTab)
    : 'trips'
}

/** What the tab mapping needs of a batch deduction line. */
export interface DeductionLineKind {
  /** The engine's label: 'Escrow', 'Fuel', 'Tolls', 'Insurance', … */
  type: string
  /** Set when a recurring rule (or standing charge) wrote the line. */
  recurringDeductionId: string | null
}

export type LineTab = 'fuel' | 'toll' | 'balances' | 'recurring' | 'oneTime'

/**
 * A batch statement's `SettlementDeductionLine`, to its tab. ORDER MATTERS:
 * escrow is a rule too, and it belongs with the balances, not the recurring
 * charges; fuel and tolls come from the imports, not a rule; a line from a
 * rule is recurring; the rest — the one-time charges the engine took — are
 * one-time. The engine's own two behavioural labels (`Escrow`, `Fuel`,
 * `deduction-types.ts`) and the toll line's (`Tolls`, `fuel-charge.ts`).
 */
export function deductionLineTab(line: DeductionLineKind): LineTab {
  if (line.type === 'Escrow') return 'balances'
  if (line.type === 'Fuel') return 'fuel'
  if (line.type === 'Tolls') return 'toll'
  if (line.recurringDeductionId !== null) return 'recurring'
  return 'oneTime'
}

/**
 * A line added by hand (`SettlementLine`), to its tab: escrow with the
 * balances, everything else one-time — a hand-added line is a one-off by
 * construction. `LOAD_PAY` is not a line here; the trips are their own rows.
 */
export function handLineTab(type: string): 'balances' | 'oneTime' {
  return type === 'DEDUCTION_ESCROW' ? 'balances' : 'oneTime'
}

/** Each tab's count, from the rows the tabs render. */
export function statementTabCounts(input: {
  trips: number
  fuelRows: number
  tollRows: number
  deductionLines: readonly DeductionLineKind[]
  handLineTypes: readonly string[]
  documents: number
  hasNotes: boolean
}): Record<StatementTab, number> {
  const counts: Record<StatementTab, number> = {
    trips: input.trips,
    fuel: input.fuelRows,
    toll: input.tollRows,
    balances: 0,
    recurring: 0,
    oneTime: 0,
    attachments: input.documents + (input.hasNotes ? 1 : 0),
  }
  for (const line of input.deductionLines) {
    const tab = deductionLineTab(line)
    // The fuel and toll TABS count their transactions; the statement's own
    // fuel or toll line is shown under them and is not a second row to count.
    if (tab === 'fuel' || tab === 'toll') continue
    counts[tab] += 1
  }
  for (const type of input.handLineTypes) counts[handLineTab(type)] += 1
  return counts
}
