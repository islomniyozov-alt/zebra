import { formatCents } from './money'
import { assemblePdf, pdfString, winAnsi } from './pdf'

// ---------------------------------------------------------------------------
// NO LONGER SERVED OVER HTTP. Retired as a route on 2026-09-30.
//
// THERE WERE TWO SETTLEMENT PDFs and one settlement, which is how the owner
// came to report "the statement PDF is a stub — gross and net only, no
// lines". It was true of THIS one, and the workbench's Export PDF pointed at
// it while the batch detail page had been linking the full Datatruck-layout
// renderer (`statement-pdf.ts`) all along. The route is gone; the link now
// goes where the batch page's already went.
//
// WHAT IT IS STILL FOR: `tests/integration/settlements.test.ts` renders a
// settlement through it twice — before and after a driver's raise — to assert
// that the document does not change, which is the observable form of "a
// frozen snapshot is frozen". `statement-pdf.ts` cannot take that job today
// because it needs a batch and those settlements come from the older
// per-driver path, which makes none.
//
// So it survives as that comparator and NOT as a document anybody is handed.
// Do not link it. If the per-driver path ever gains a batch, this and its
// test go together.
//
// THE SETTLEMENT PDF.
//
// The document a driver is handed on Friday, and the one they bring back in
// three weeks when they think the fuel deduction was wrong. So every line
// SHOWS ITS WORKING: not "$735.00" but "L-1042  30% of $2,450.00  $735.00".
// A settlement a driver cannot check by hand is a settlement they have to
// argue about instead.
//
// Same construction as the invoice PDF and for the same reasons — no library,
// eight objects, Helvetica from the base fourteen, WinAnsi. The shared
// machinery moved to pdf.ts when this became the second one; the layout is
// deliberately not shared, because two documents that must look different are
// not helped by one function with a mode flag.
//
// ENGLISH-ONLY, same parked flag as the invoice: base-14 fonts cannot render
// Cyrillic or Farsi. A driver's NAME can, though — Latin-1 covers the accented
// characters that actually appear on a licence.
// ---------------------------------------------------------------------------

export interface SettlementPdfLine {
  loadNumber: string | null
  description: string
  /** "30% of $2,450.00" — how the figure was reached. Blank where obvious. */
  basis: string
  amountCents: number
  /**
   * The driver's sheet dates, already formatted, and whether each is a RECORD.
   *
   * A MONEY DOCUMENT NEVER PRESENTS A PLAN AS AN ACTUAL SILENTLY. When the
   * load carried no check-in the plan is printed with a marker beside it and a
   * footnote explaining the marker — the driver is entitled to know which of
   * these dates is what happened and which is what was intended.
   */
  puDate: string
  puActual: boolean
  delDate: string
  delActual: boolean
}

export interface SettlementPdfInput {
  settlementNumber: string
  periodStart: string
  periodEnd: string
  carrier: { name: string; dotNumber?: string | null; mcNumber?: string | null }
  driver: { name: string; phone?: string | null }
  lines: readonly SettlementPdfLine[]
  grossCents: number
  deductionsCents: number
  reimbursementsCents: number
  netCents: number
  status: string
  paidOn?: string | null
  paymentReference?: string | null
}

const LEFT = 56
const RIGHT = 556
const TOP = 786

/** How many lines fit on the one page this renders. */
export const MAX_SETTLEMENT_LINES = 30

export function renderSettlementPdf(input: SettlementPdfInput): Uint8Array {
  const ops: string[] = []
  let y = TOP

  const text = (value: string, x: number, size: number, bold = false) => {
    ops.push(
      `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${y} Td (${pdfString(winAnsi(value))}) Tj ET`,
    )
  }
  const money = (cents: number, size: number, bold = false) => {
    const rendered = formatCents(cents, 'en-US')
    // Helvetica's 0.5-em average. Money is short, so the approximation never
    // drifts far enough to matter — the same one the invoice uses.
    const width = rendered.length * size * 0.5
    text(rendered, RIGHT - width, size, bold)
  }
  const rule = () => {
    ops.push(`${LEFT} ${y} m ${RIGHT} ${y} l 0.6 w S`)
  }

  text('DRIVER SETTLEMENT', LEFT, 18, true)
  text(
    input.settlementNumber,
    RIGHT - input.settlementNumber.length * 9,
    18,
    true,
  )
  y -= 24

  text(input.carrier.name, LEFT, 11, true)
  y -= 14
  const identifiers = [
    input.carrier.dotNumber ? `USDOT ${input.carrier.dotNumber}` : null,
    input.carrier.mcNumber ? `MC ${input.carrier.mcNumber}` : null,
  ]
    .filter(Boolean)
    .join('   ')
  if (identifiers) {
    text(identifiers, LEFT, 9)
    y -= 18
  } else {
    y -= 4
  }

  rule()
  y -= 18

  text('DRIVER', LEFT, 8, true)
  text('PERIOD', 320, 8, true)
  text('STATUS', 470, 8, true)
  y -= 13
  text(input.driver.name, LEFT, 10)
  text(`${input.periodStart} - ${input.periodEnd}`, 320, 10)
  text(input.status, 470, 10)
  y -= 12
  if (input.driver.phone) text(input.driver.phone, LEFT, 9)
  y -= 20

  rule()
  y -= 16
  text('LOAD', LEFT, 8, true)
  text('PU', LEFT + 60, 8, true)
  text('DEL', LEFT + 118, 8, true)
  text('DESCRIPTION', LEFT + 176, 8, true)
  text('HOW IT WAS CALCULATED', 330, 8, true)
  text('AMOUNT', RIGHT - 40, 8, true)
  y -= 6
  rule()
  y -= 16

  // THE MARKER, ONCE, so the footnote below can be written once. An asterisk
  // rather than a word: the column is narrow and a driver reading a row of
  // dates needs the exception to catch the eye, not to be explained twice.
  const SCHEDULED_MARK = '*'
  let anyScheduled = false

  for (const line of input.lines.slice(0, MAX_SETTLEMENT_LINES)) {
    text(line.loadNumber ?? '', LEFT, 9)

    // A DATE WITH NO ACTUAL BEHIND IT IS MARKED WHERE IT IS PRINTED. Marking
    // the line instead would tell the driver one of the two is a plan without
    // saying which.
    if (line.puDate && !line.puActual) anyScheduled = true
    if (line.delDate && !line.delActual) anyScheduled = true
    text(
      line.puDate + (line.puDate && !line.puActual ? SCHEDULED_MARK : ''),
      LEFT + 60,
      9,
    )
    text(
      line.delDate + (line.delDate && !line.delActual ? SCHEDULED_MARK : ''),
      LEFT + 118,
      9,
    )

    text(line.description, LEFT + 176, 9)
    // THE WORKING. This column is why the document is worth printing.
    if (line.basis) text(line.basis, 330, 9)
    money(line.amountCents, 9)
    y -= 14
  }

  y -= 4
  rule()
  y -= 16

  text('Gross pay', 380, 10)
  money(input.grossCents, 10)
  y -= 14
  if (input.reimbursementsCents !== 0) {
    text('Reimbursements', 380, 10)
    money(input.reimbursementsCents, 10)
    y -= 14
  }
  if (input.deductionsCents !== 0) {
    // Shown NEGATIVE, because that is what it does to the total below it. A
    // deductions line printed positive next to a smaller net is the single
    // most common thing a driver queries.
    text('Deductions', 380, 10)
    money(-input.deductionsCents, 10)
    y -= 14
  }
  text('NET PAY', 380, 12, true)
  money(input.netCents, 12, true)
  y -= 26

  if (input.paidOn) {
    text(
      `Paid ${input.paidOn}${input.paymentReference ? ` - ${input.paymentReference}` : ''}`,
      LEFT,
      9,
    )
    y -= 14
  }

  if (input.lines.length > MAX_SETTLEMENT_LINES) {
    // Said on the document rather than silently dropped. A settlement that
    // prints 30 of 34 loads and totals all 34 is a document that looks wrong
    // and is right, which is worse than either.
    // No parentheses in the sentence: they are structural inside a PDF
    // string and `pdfString` escapes them, so the file would carry
    // "line\(s\)" and anything grepping the bytes for the message would miss
    // it. Plain words survive the escaping unchanged.
    text(
      `${input.lines.length - MAX_SETTLEMENT_LINES} further lines not shown - see the screen`,
      LEFT,
      9,
    )
  }

  // THE FOOTNOTE, PRINTED ONLY WHEN A MARKER APPEARS. A legend explaining a
  // symbol that is not on the page teaches the reader to ignore legends.
  //
  // Plain words and a hyphen: parentheses are PDF syntax and would be escaped
  // in the byte stream, so anything grepping the file for this sentence would
  // miss it. Same reasoning as the truncation notice above.
  if (anyScheduled) {
    y -= 10
    text(
      `${SCHEDULED_MARK} scheduled date - no arrival was recorded at this stop`,
      LEFT,
      8,
    )
  }

  return assemblePdf(ops.join('\n'))
}
