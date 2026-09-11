import { readNamedSheets } from '../datatruck/xlsx'
import {
  DORMANT_MONEY_COLUMNS,
  GROSS_COLUMN,
  MONEY_COLUMNS,
  censusItemTypes,
  checkColumns,
  classifyItemType,
  type ColumnProblem,
  type ItemCensus,
  type ItemClass,
} from './remittance-shape'

// ---------------------------------------------------------------------------
// READING AN AMAZON REMITTANCE. NOTHING IS WRITTEN AND NOTHING IS MATCHED HERE.
//
// This turns a workbook into rows and totals it can vouch for. Matching those
// rows against freight is `remittance-preview.ts`, and writing money is not
// built at all.
//
// Every rule is measured off the six workbooks in `corpus/amazon`, 2026-07-26
// → 2026-09-05, read raw with no trimming.
// ---------------------------------------------------------------------------

/**
 * The summary sheet's labels, by EXACT match, with both colon forms named.
 *
 * ── WHY BOTH FORMS, AND WHY NEVER PROXIMITY ──────────────────────────────
 *
 * The file is inconsistent with itself: the left-hand block prints `Carrier:`
 * and `SCAC:` with one colon, the right-hand block prints `Invoice total::`
 * and `Work period::` with two. That is Amazon's inconsistency, not a
 * variation over time — all six weeks print it the same way.
 *
 * So both spellings are named for every field. The alternative — stripping
 * colons and comparing loosely — would match `Invoice date::` against a future
 * `Invoice date range::` and quietly read the wrong cell.
 *
 * AND THE VALUE IS TAKEN FROM THE SAME ROW, never from "nearby". The summary
 * sheet has values above, below and beside labels; a proximity rule on a
 * 33x18 grid is a coin toss that usually lands right.
 */
const LABELS = {
  carrier: ['Carrier:', 'Carrier::'],
  scac: ['SCAC:', 'SCAC::'],
  invoiceNumber: ['Invoice #::', 'Invoice #:'],
  invoiceDate: ['Invoice date::', 'Invoice date:'],
  invoiceTotal: ['Invoice total::', 'Invoice total:'],
  workPeriod: ['Work period::', 'Work period:'],
  paymentStatus: ['Payment Status::', 'Payment Status:'],
  paymentDate: ['Payment date::', 'Payment date:'],
  workType: ['Work type::', 'Work type:'],
  payTerm: ['Pay Term::', 'Pay Term:'],
  disputeId: ['Dispute Id::', 'Dispute Id:'],
} as const

export type SummaryField = keyof typeof LABELS

/**
 * A cell this reader must never accept as a figure.
 *
 * Summary row 31 of every workbook carries a leaked object:
 *
 *   {amount=152369.95, formattedAmount=$152.369,95}
 *
 * — with EUROPEAN separators on a USD amount. It sits beside a `Total` label,
 * so a proximity rule or a scan for "the total" finds it. Reading
 * `formattedAmount` would parse $152.369,95 as 152.369 and be wrong by five
 * orders of magnitude, silently, in the direction of underpaying.
 */
const LEAKED_OBJECT = /formattedAmount/

export interface RemittanceRow {
  /** The row's position in the sheet, 1-based, for naming it in a refusal. */
  at: number
  invoiceNumber: string
  tripId: string | null
  loadId: string | null
  itemType: string
  item: ItemClass | null
  /** Cents per money column, keyed by the column's printed name. */
  money: Record<string, number>
  grossCents: number
  startDate: string
  endDate: string
  route: string
}

export interface RemittanceSummary {
  carrier: string | null
  scac: string | null
  invoiceNumber: string | null
  invoiceDate: string | null
  invoiceTotalCents: number | null
  workPeriod: string | null
  paymentStatus: string | null
  paymentDate: string | null
  workType: string | null
  payTerm: string | null
  /** Every adjustment line, as printed. Zero in all six weeks profiled. */
  adjustments: { type: string; description: string; cents: number }[]
  adjustmentTotalCents: number
}

export type RemittanceRefusal =
  | { kind: 'sheet_missing'; detail: string }
  | { kind: 'columns_changed'; problems: ColumnProblem[] }
  | { kind: 'unrecognised_item_type'; values: string[] }
  | { kind: 'no_invoice_total'; detail: string }
  | { kind: 'leaked_object'; detail: string }
  | { kind: 'totals_disagree'; body: number; header: number; footer: number }

export interface RemittanceReading {
  summary: RemittanceSummary
  rows: RemittanceRow[]
  /** The rows after the header that carry no Invoice Number. */
  footer: string[][]
  census: ItemCensus
  /** Dormant columns that carried a non-zero figure. Loud on purpose. */
  dormantColumnsSeen: { column: string; cents: number; rows: number }[]
  totals: {
    bodyCents: number
    headerCents: number
    footerCents: number | null
    perColumn: Record<string, number>
  }
}

export type RemittanceOutcome =
  | { ok: true; reading: RemittanceReading }
  | { ok: false; reason: RemittanceRefusal }

/**
 * `"1,234.56"` as integer cents.
 *
 * The file prints bare decimals — `505.05`, `0.0` — with no currency symbol
 * and no thousands separators anywhere in six weeks. Separators are stripped
 * anyway because the day one appears, refusing the whole file over a comma
 * would be worse than reading it.
 */
export function remittanceCents(raw: string): number {
  const text = raw.trim().replace(/[$,]/g, '')
  if (text === '') return 0
  const value = Number(text)
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 100)
}

/** The first non-empty cell to the right of an exact label, in its own row. */
function valueFor(rows: readonly string[][], names: readonly string[]) {
  for (const row of rows) {
    for (const name of names) {
      const at = row.indexOf(name)
      if (at === -1) continue
      for (let i = at + 1; i < row.length; i++) {
        const cell = (row[i] ?? '').trim()
        if (cell !== '') return cell
      }
    }
  }
  return null
}

function readSummary(rows: readonly string[][]): {
  summary: RemittanceSummary
  leaked: string | null
} {
  const read = (field: SummaryField) => valueFor(rows, LABELS[field])

  const total = read('invoiceTotal')
  if (total && LEAKED_OBJECT.test(total)) {
    return {
      summary: emptySummary(),
      leaked: `the invoice total cell reads ${JSON.stringify(total)}`,
    }
  }

  // ── THE ADJUSTMENTS BLOCK, READ GENERICALLY ────────────────────────────
  //
  // Rows between the `Adjustment & Deductions` heading and its Total line.
  // Every one is zero in all six weeks, so nothing branches on the type — the
  // lines are carried and the total is summed, and a non-zero one is reported
  // by the caller rather than handled here.
  const adjustments: { type: string; description: string; cents: number }[] = []
  let inBlock = false
  let adjustmentTotalCents = 0
  for (const row of rows) {
    const cells = row.map((cell) => cell.trim())
    if (cells.includes('Adjustment & Deductions')) {
      inBlock = true
      continue
    }
    if (!inBlock) continue

    const totalCell = cells.findIndex((cell) =>
      cell.startsWith('Adjustment & Deductions Total'),
    )
    if (totalCell !== -1) {
      const figure = cells.slice(totalCell + 1).find((cell) => cell !== '')
      adjustmentTotalCents = remittanceCents(figure ?? '0')
      inBlock = false
      continue
    }

    const filled = cells.filter((cell) => cell !== '')
    if (filled.length === 0 || filled[0] === 'Type') continue
    const figure = filled[filled.length - 1]!
    if (!/^-?[\d.,$]+$/.test(figure)) continue
    adjustments.push({
      type: filled[0] ?? '',
      description: filled.length > 2 ? (filled[1] ?? '') : '',
      cents: remittanceCents(figure),
    })
  }

  return {
    summary: {
      carrier: read('carrier'),
      scac: read('scac'),
      invoiceNumber: read('invoiceNumber'),
      invoiceDate: read('invoiceDate'),
      invoiceTotalCents: total === null ? null : remittanceCents(total),
      workPeriod: read('workPeriod'),
      paymentStatus: read('paymentStatus'),
      paymentDate: read('paymentDate'),
      workType: read('workType'),
      payTerm: read('payTerm'),
      adjustments,
      adjustmentTotalCents,
    },
    leaked: null,
  }
}

const emptySummary = (): RemittanceSummary => ({
  carrier: null,
  scac: null,
  invoiceNumber: null,
  invoiceDate: null,
  invoiceTotalCents: null,
  workPeriod: null,
  paymentStatus: null,
  paymentDate: null,
  workType: null,
  payTerm: null,
  adjustments: [],
  adjustmentTotalCents: 0,
})

/** The sheet whose name says what it is, not the sheet that came first. */
const sheetNamed = (
  sheets: { name: string; rows: string[][] }[],
  want: string,
) => sheets.find((sheet) => sheet.name.trim() === want) ?? null

export async function readRemittance(
  bytes: Uint8Array,
): Promise<RemittanceOutcome> {
  const sheets = await readNamedSheets(bytes)

  const summarySheet = sheetNamed(sheets, 'Payment Summary')
  const detailSheet = sheetNamed(sheets, 'Payment Details')
  if (!summarySheet || !detailSheet) {
    return {
      ok: false,
      reason: {
        kind: 'sheet_missing',
        detail: `expected "Payment Summary" and "Payment Details"; found ${sheets
          .map((sheet) => JSON.stringify(sheet.name))
          .join(', ')}`,
      },
    }
  }

  const { summary, leaked } = readSummary(summarySheet.rows)
  if (leaked)
    return { ok: false, reason: { kind: 'leaked_object', detail: leaked } }
  if (summary.invoiceTotalCents === null) {
    return {
      ok: false,
      reason: {
        kind: 'no_invoice_total',
        detail: 'no cell matched any spelling of the invoice-total label',
      },
    }
  }

  // ── THE COLUMN CONTRACT, BEFORE ANY VALUE IS READ ──────────────────────
  const header = (detailSheet.rows[0] ?? []).filter(
    (_, i, all) => i < all.length,
  )
  const problems = checkColumns(header)
  if (problems.length > 0) {
    return { ok: false, reason: { kind: 'columns_changed', problems } }
  }
  const at = (name: string) => header.indexOf(name)

  // ── FOOTERS BY EMPTY COLUMN A ──────────────────────────────────────────
  //
  // Every data row carries an Invoice Number; the three footer rows — blank,
  // total, "Paid <date>" — carry none. One test rather than three shapes, and
  // it does not care how many footer rows a future file grows.
  const invoiceAt = at('Invoice Number')
  const body: string[][] = []
  const footer: string[][] = []
  for (const row of detailSheet.rows.slice(1)) {
    ;((row[invoiceAt] ?? '').trim() === '' ? footer : body).push(row)
  }

  const rows: RemittanceRow[] = body.map((row, index) => {
    const money: Record<string, number> = {}
    for (const column of MONEY_COLUMNS) {
      money[column] = remittanceCents(row[at(column)] ?? '')
    }
    const itemType = (row[at('Item Type')] ?? '').trim()
    return {
      at: index + 2,
      invoiceNumber: (row[invoiceAt] ?? '').trim(),
      tripId: (row[at('Trip ID')] ?? '').trim() || null,
      loadId: (row[at('Load ID')] ?? '').trim() || null,
      itemType,
      item: classifyItemType(itemType),
      money,
      grossCents: remittanceCents(row[at(GROSS_COLUMN)] ?? ''),
      startDate: (row[at('Start Date')] ?? '').trim(),
      endDate: (row[at('End Date')] ?? '').trim(),
      route: (row[at('Route')] ?? '').trim(),
    }
  })

  const census = censusItemTypes(rows.map((row) => row.itemType))
  if (census.unrecognised.length > 0) {
    return {
      ok: false,
      reason: { kind: 'unrecognised_item_type', values: census.unrecognised },
    }
  }

  const perColumn: Record<string, number> = {}
  for (const column of MONEY_COLUMNS) {
    perColumn[column] = rows.reduce((sum, row) => sum + row.money[column]!, 0)
  }
  const bodyCents = rows.reduce((sum, row) => sum + row.grossCents, 0)

  // The footer's own copy of the total: the one figure in those rows.
  const grossAt = at(GROSS_COLUMN)
  const footerFigure = footer
    .map((row) => (row[grossAt] ?? '').trim())
    .find((cell) => cell !== '')
  const footerCents =
    footerFigure === undefined ? null : remittanceCents(footerFigure)

  // ── THE FIRST NON-ZERO IN A DORMANT COLUMN IS AN EVENT ─────────────────
  const dormantColumnsSeen = DORMANT_MONEY_COLUMNS.map((column) => ({
    column: column as string,
    cents: perColumn[column] ?? 0,
    rows: rows.filter((row) => (row.money[column] ?? 0) !== 0).length,
  })).filter((seen) => seen.cents !== 0)

  return {
    ok: true,
    reading: {
      summary,
      rows,
      footer,
      census,
      dormantColumnsSeen,
      totals: {
        bodyCents,
        headerCents: summary.invoiceTotalCents,
        footerCents,
        perColumn,
      },
    },
  }
}

/**
 * The three-way total check, as its own function so it can be asserted.
 *
 * THREE COPIES OF ONE NUMBER: the body's Gross Pay sum, the summary's
 * `Invoice total::`, and the footer row. All three agree in all six weeks.
 * Comparing only two of them would leave whichever pair happened to be checked
 * as the definition of correct.
 */
export function totalsAgree(reading: RemittanceReading): boolean {
  const { bodyCents, headerCents, footerCents } = reading.totals
  if (bodyCents !== headerCents) return false
  return footerCents === null || footerCents === bodyCents
}

// ---------------------------------------------------------------------------
// THE WORK PERIOD, AS A PAIR OF DAYS.
//
// Amazon prints it in the Payment Summary as one string. All six weeks in
// `corpus/amazon`, verbatim:
//
//   "Jul 26 - Aug 1, 2026"    "Aug 2 - Aug 8, 2026"     "Aug 9 - Aug 15, 2026"
//   "Aug 16 - Aug 22, 2026"   "Aug 23 - Aug 29, 2026"   "Aug 30 - Sep 5, 2026"
//
// THE YEAR IS STATED ONCE, AT THE END, and that is the whole difficulty. It
// belongs to the SECOND date; the first inherits it unless the period crosses
// a new year, where "Dec 27 - Jan 2, 2027" means December of 2026. Two of the
// six cross a month already, so this is not a hypothetical shape — the year
// crossing is the same shape one week further on.
//
// AND IT IS CHECKED AGAINST THE WEEK RULE. All six parse to Sunday-Saturday,
// which is what MONEY-DESIGN §0 says a period is. A string that parses to
// anything else is not a work period this system understands, and returning
// null sends the caller to the fallback rather than storing a wrong week.
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
]

export function parseWorkPeriod(
  raw: string | null,
): { start: Date; end: Date } | null {
  if (!raw) return null

  const match =
    /^\s*([A-Za-z]{3,})\.?\s+(\d{1,2})\s*[-–—]\s*([A-Za-z]{3,})\.?\s+(\d{1,2}),\s*(\d{4})\s*$/.exec(
      raw,
    )
  if (!match) return null

  const startMonth = MONTH_NAMES.indexOf(match[1]!.slice(0, 3).toLowerCase())
  const endMonth = MONTH_NAMES.indexOf(match[3]!.slice(0, 3).toLowerCase())
  if (startMonth === -1 || endMonth === -1) return null

  const endYear = Number(match[5])
  // THE ONLY PLACE THE YEAR IS INFERRED. A period whose first month is LATER
  // than its last has crossed into January, so the start belongs to the year
  // before the one printed.
  const startYear = startMonth > endMonth ? endYear - 1 : endYear

  const start = new Date(Date.UTC(startYear, startMonth, Number(match[2])))
  const end = new Date(Date.UTC(endYear, endMonth, Number(match[4])))

  // SUNDAY TO SATURDAY OR NOTHING. Six days apart, opening on a Sunday — the
  // same rule `isSettlementWeek` holds settlements to. Anything else is a
  // string this does not understand, and a null is better than a stored week
  // that quietly disagrees with every period beside it.
  if (start.getUTCDay() !== 0) return null
  if (end.getTime() - start.getTime() !== 6 * 86_400_000) return null

  return { start, end }
}
