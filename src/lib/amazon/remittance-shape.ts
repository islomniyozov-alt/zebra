// ---------------------------------------------------------------------------
// WHAT AN AMAZON REMITTANCE WORKBOOK IS, AND THE GUARDS THAT SAY WHEN IT ISN'T.
//
// Every name and every rule below was measured off the six workbooks in
// `corpus/amazon`, covering 2026-07-26 → 2026-09-05, read raw. Nothing here
// comes from a description of the file.
//
// ── THE COLUMN LIST IS A CONTRACT, NOT A CONVENIENCE ──────────────────────
//
// The 20 detail columns were byte-identical across all six weeks: same names,
// same order, no BOM, no double spaces, no trailing whitespace. Six stable
// weeks is not a guarantee — this operation has already been bitten once by a
// column Amazon renamed between exports, and that cost a real defect.
//
// So the reader addresses every column BY NAME from the header row, and
// `checkColumns` fails by name when a 21st appears or one of the 20 goes. The
// guard costs nothing today and cannot be added honestly later: once an
// importer has run against a changed file, the evidence of what changed is
// gone. Same reasoning `trips-csv.ts` records for its own discovery guard.
// ---------------------------------------------------------------------------

/** The detail sheet's 20 columns, in the order the file prints them. */
export const REMITTANCE_COLUMNS = [
  'Invoice Number',
  'Block ID',
  'Trip ID',
  'Load ID',
  'Start Date',
  'End Date',
  'Route',
  'Operator Type',
  'Equipment',
  'Distance (Mi)',
  'Item Type',
  'Program Type',
  'Base Rate',
  'Fuel Surcharge',
  'Tolls',
  'Detention',
  'TONU',
  'Others',
  'Gross Pay',
  'Comments',
] as const

export type RemittanceColumn = (typeof REMITTANCE_COLUMNS)[number]

/**
 * The money columns, as a LIST rather than as named fields.
 *
 * ── COLUMN-LIST DRIVEN SO A NON-ZERO VALUE NEEDS NO NEW CODE ─────────────
 *
 * `Detention` and `Others` are zero in all six weeks. So is every row of the
 * summary's Adjustments block. Writing bespoke handling for them would be
 * writing code no artefact has ever exercised — which this codebase has paid
 * for before, and which cannot be verified by anything except the day it
 * finally runs.
 *
 * They flow through the same sum as every other money column, so the day a
 * real detention arrives it is simply carried. What is NOT silent is the
 * arrival itself: `dormantColumnsSeen` reports the first non-zero, because a
 * column that has been zero for six weeks going non-zero is exactly the event
 * somebody needs to hear about.
 */
export const MONEY_COLUMNS = [
  'Base Rate',
  'Fuel Surcharge',
  'Tolls',
  'Detention',
  'TONU',
  'Others',
] as const

/** The column the six components must add up to. */
export const GROSS_COLUMN = 'Gross Pay'

/**
 * Columns that carried nothing but zero across every workbook profiled.
 *
 * Not a rule about what Amazon may send — a record of what has been SEEN, so
 * the first departure from it is announced rather than absorbed.
 */
export const DORMANT_MONEY_COLUMNS = ['Detention', 'Others'] as const

export type ColumnProblem =
  | { kind: 'missing'; column: string }
  | { kind: 'added'; column: string; at: number }
  | { kind: 'moved'; column: string; from: number; to: number }

/**
 * Does this header row still say what the contract says?
 *
 * FAILS BY NAME, in all three directions. A missing column, an unknown extra,
 * and a column that merely moved are different problems with different fixes,
 * and a guard that reported only "the header changed" would send somebody
 * diffing two spreadsheets by eye.
 */
export function checkColumns(header: readonly string[]): ColumnProblem[] {
  const problems: ColumnProblem[] = []
  const expected = new Set<string>(REMITTANCE_COLUMNS)

  for (const column of REMITTANCE_COLUMNS) {
    if (!header.includes(column)) problems.push({ kind: 'missing', column })
  }
  header.forEach((column, at) => {
    if (!expected.has(column)) problems.push({ kind: 'added', column, at })
  })
  REMITTANCE_COLUMNS.forEach((column, to) => {
    const from = header.indexOf(column)
    if (from !== -1 && from !== to) {
      problems.push({ kind: 'moved', column, from, to })
    }
  })

  return problems
}

// ── ITEM TYPE, ON TWO INDEPENDENT AXES ─────────────────────────────────────
//
// The file prints `TOUR - COMPLETED`, `LOAD - COMPLETED`, `LOAD - CANCELLED`
// and `TOUR - CANCELLED`. Four values — but they are not four kinds of thing.
// They are two questions answered independently: WHAT the row is, and HOW it
// ended.
//
// TREATING THEM AS A SET OF FOUR IS WRONG ON THE EVIDENCE. `TOUR - CANCELLED`
// is absent from two of the six weeks and never exceeds five rows. A reader
// built around four expected values would have been correct on four weeks and
// would have had to change on the other two — and a reader that had only ever
// seen those two weeks would not know the type exists.
//
// Derived from the string, so `TOUR - DISPUTED` classifies its scope on the
// day it appears and fails only on the axis it actually breaks.

export type ItemScope = 'TOUR' | 'LOAD'
export type ItemOutcome = 'COMPLETED' | 'CANCELLED'

export interface ItemClass {
  scope: ItemScope
  outcome: ItemOutcome
}

const SCOPES = new Set(['TOUR', 'LOAD'])
const OUTCOMES = new Set(['COMPLETED', 'CANCELLED'])

/** `TOUR - COMPLETED` -> `{scope, outcome}`; anything unrecognised -> null. */
export function classifyItemType(raw: string): ItemClass | null {
  const parts = raw.split(' - ')
  if (parts.length !== 2) return null
  const [scope, outcome] = parts as [string, string]
  if (!SCOPES.has(scope) || !OUTCOMES.has(outcome)) return null
  return { scope: scope as ItemScope, outcome: outcome as ItemOutcome }
}

/**
 * Every distinct Item Type in a file, with counts — and which ones this
 * system does not recognise.
 *
 * THE CENSUS IS THE ASSERTION. It reports what was actually there rather than
 * checking against a list of four, so a fifth value is a named finding and not
 * a silent skip. `unrecognised` being non-empty is a refusal, and the value is
 * quoted so nobody has to go looking for it.
 */
export interface ItemCensus {
  counts: { value: string; rows: number; scope: ItemScope | null }[]
  unrecognised: string[]
}

export function censusItemTypes(values: readonly string[]): ItemCensus {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)

  const rows = [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, n]) => ({
      value,
      rows: n,
      scope: classifyItemType(value)?.scope ?? null,
    }))

  return {
    counts: rows,
    unrecognised: rows.filter((r) => r.scope === null).map((r) => r.value),
  }
}
