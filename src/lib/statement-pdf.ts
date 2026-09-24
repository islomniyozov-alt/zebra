import { assemblePdf, pdfString, winAnsi } from './pdf'

// ---------------------------------------------------------------------------
// THE DRIVER PAY STATEMENT, IN DATATRUCK'S LAYOUT.
//
// Every label, column header and summary word below is VERBATIM from the six
// statements in `corpus/datatruck`, read out of the PDFs themselves. Drivers
// have been receiving this document for years; a statement that rearranges it
// is a statement each of them has to learn to read again, in the same week
// their pay changes systems.
//
// ── WHY THIS IS NOT `settlement-pdf.ts` ──────────────────────────────────
//
// That one is Phase 3's, and it is a different document with a different
// argument behind it: it shows its working — "L-1042 30% of $2,450.00" — for a
// driver who wants to check the arithmetic. This one reproduces a layout that
// already exists and whose whole value is that it is unchanged. Merging them
// into one renderer with a mode flag would make both worse, which is the
// reasoning `pdf.ts` already records for the invoice and the settlement.
//
// ── THE TWO LIGATURES ────────────────────────────────────────────────────
//
// Datatruck's own font subsets keep `ff` at U+E007 and `tt` at U+E009, so its
// raw text says "Payment tari" and "Se lement". That is a defect in ITS font
// embedding, not a thing to reproduce: `winAnsi` would turn both into `?`. The
// words are spelled out here, and `demoteLigatures` maps the two codepoints
// wherever a string arrives from a Datatruck-derived source.
//
// ── SECTION ORDER, FROM THE ARTEFACT ─────────────────────────────────────
//
//   header (two columns)  ->  six summary rows  ->  Earnings  ->  Deductions
//   ->  Other Pay  ->  "Powered by"
//
// Deductions and Other Pay are OMITTED ENTIRELY when they have no rows — both
// Dolphins statements have no Deductions block at all while their summary still
// reads $0.00. Two rules that have to hold at once.
// ---------------------------------------------------------------------------

/** U+E007 is `ff` and U+E009 is `tt` in Datatruck's subset fonts. */
export function demoteLigatures(value: string): string {
  return value.replace(//g, 'ff').replace(//g, 'tt')
}

/** `8/19/2026` — the statements' own date format, never localised. */
export function usDate(day: Date): string {
  return `${String(day.getUTCMonth() + 1)}/${String(day.getUTCDate())}/${String(day.getUTCFullYear())}`
}

/**
 * `$11,612.76`, and `($3,184.21)` for a negative.
 *
 * PARENTHESES, NOT A MINUS SIGN, because that is what the artefact prints and
 * this document's entire job is to look like the one before it. Note that
 * `TMS-DESIGN-SYSTEM.md` §"Money" requires a LEADING MINUS on screen and says
 * why — dispatchers read parentheses as a footnote. The two are deliberately
 * different: the rule governs Zebra's own screens, and this is a reproduction
 * of somebody else's document. Flagged rather than silently resolved.
 */
export function statementMoney(cents: number): string {
  const absolute = (Math.abs(cents) / 100).toFixed(2)
  const withCommas = absolute.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return cents < 0 ? `($${withCommas})` : `$${withCommas}`
}

/** `4,100.38` — miles, in hundredths, as the Total row prints them. */
export function statementMiles(hundredths: number): string {
  const value = (hundredths / 100).toFixed(2).replace(/\.?0+$/, '')
  const [whole, fraction] = value.split('.')
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return fraction === undefined ? grouped : `${grouped}.${fraction}`
}

export interface StatementLoadRow {
  loadNumber: string
  /** Whose freight this line is. Printed only when a statement has more than
   * one — see `renderStatementPdf`. */
  companyName: string
  puPlace: string
  delPlace: string
  puDate: Date
  delDate: Date
  grossCents: number
  milesHundredths: number
  amountCents: number
}

export interface StatementChargeRow {
  type: string
  description: string
  quantity: number
  rateCents: number
  totalCents: number
}

export interface StatementPdfInput {
  /** `ST-005284`. */
  statementNumber: string
  /** `SB-000436`. */
  batchNumber: string
  company: { name: string; address: string }
  driverName: string
  unitNumber: string | null
  /**
   * The other crew members, printed under the driver as "Team with X".
   *
   * Empty on a solo period. Present when ANY line in the period is a team
   * line — a driver who ran three solo loads and one team load still gets the
   * header, because that one line is the one that looks wrong without it.
   */
  teamWith: readonly string[]
  /**
   * The REFERRAL PAYEES in the second seat, printed as "Referral: X".
   *
   * Separate from `teamWith` because they are a different claim. A commission
   * sitting in `coDriverId` printed as "Team with" tells the driver somebody
   * was in the cab with them, on the document they read to check their own pay.
   */
  referralWith: readonly string[]
  /**
   * Who the cheque is made out to, when it is not the driver.
   *
   * An owner-operator invoices through their own LLC. Null prints the
   * driver's own name, which is the normal case.
   */
  payToName: string | null
  payToAddress: string | null
  /** `88% from gross`, verbatim. */
  payTariffLabel: string | null
  statementDate: Date
  periodStart: Date
  periodEnd: Date
  /** The driver's payout date — batch check date plus their lag. */
  checkDate: Date
  loads: readonly StatementLoadRow[]
  totals: { grossCents: number; milesHundredths: number; amountCents: number }
  deductions: readonly StatementChargeRow[]
  otherPay: readonly StatementChargeRow[]
  summary: {
    earningsCents: number
    advancesCents: number
    reimbursementsCents: number
    deductionsCents: number
    otherPayCents: number
    netCents: number
  }
  ytd: {
    earningsCents: number
    advancesCents: number
    reimbursementsCents: number
    deductionsCents: number
    otherPayCents: number
    netCents: number
  }
  /**
   * Set when the driver has no opening balance for the year.
   *
   * The YTD column is then a sum over what Zebra itself has settled, which is
   * not a year — so the label says which period it counts from rather than
   * printing "YTD" over a figure that is not one.
   */
  ytdFromPeriodStart: Date | null
}

const LEFT = 40
const RIGHT = 572
const TOP = 780

/** The Earnings table's column origins, measured off the artefact's spacing. */
const EARN_X = [40, 118, 216, 314, 370, 426, 492, 540] as const
const DED_X = [40, 118, 396, 452, 520] as const

export function renderStatementPdf(input: StatementPdfInput): Uint8Array {
  const ops: string[] = []
  let y = TOP

  const text = (value: string, x: number, size = 8, bold = false) => {
    const clean = pdfString(winAnsi(demoteLigatures(value)))
    ops.push(
      `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${y} Td (${clean}) Tj ET`,
    )
  }
  /** Right-aligned, which is how every money column on the artefact sits. */
  const right = (value: string, x: number, size = 8, bold = false) => {
    text(value, x - value.length * size * 0.5, size, bold)
  }
  const rule = () => {
    ops.push(`${LEFT} ${y} m ${RIGHT} ${y} l 0.5 w S`)
  }

  // ── header: the company on the left, the four dates on the right ───────
  text(input.company.name, LEFT, 11, true)
  text('Statement Date:', 380, 8, true)
  text(usDate(input.statementDate), 470, 8)
  y -= 12
  text(input.company.address, LEFT, 8)
  text('Period Start:', 380, 8, true)
  text(usDate(input.periodStart), 470, 8)
  y -= 12
  text('Period End:', 380, 8, true)
  text(usDate(input.periodEnd), 470, 8)
  y -= 12
  text('Check Date:', 380, 8, true)
  text(usDate(input.checkDate), 470, 8)
  y -= 22

  text('Driver Pay Settlement', LEFT, 13, true)
  y -= 18

  // ── the identifying row ────────────────────────────────────────────────
  const pairs: [string, string][] = [
    ['Settlement:', input.statementNumber],
    ['Batch ID:', input.batchNumber],
    ['Driver:', input.driverName],
    ['Unit Number:', input.unitNumber ?? ''],
  ]
  let x = LEFT
  for (const [label, value] of pairs) {
    text(label, x, 8, true)
    text(value, x + label.length * 4.2, 8)
    x += 133
  }
  y -= 13
  if (input.payTariffLabel) {
    text('Payment tariff:', LEFT, 8, true)
    text(input.payTariffLabel, LEFT + 62, 8)
  }
  text('Pay to:', 306, 8, true)
  // THE PAYEE, WHICH IS USUALLY BUT NOT ALWAYS THE DRIVER. An
  // owner-operator is paid through their LLC and the statement has to say
  // whose name is on the cheque — printing the driver there would be a
  // document that disagrees with the payment it accompanies.
  text(input.payToName ?? input.driverName, 306 + 32, 8)
  if (input.payToAddress) {
    y -= 11
    text(input.payToAddress, 306 + 32, 8)
  }

  // ── WHO ELSE WAS IN THE CAB ──────────────────────────────────────────
  //
  // Under the driver, and only when some line in the period is a team line.
  //
  // A team member is paid their OWN percentage of the shared gross — 20% each,
  // not 40% split — so a statement carrying 20% lines from a driver everybody
  // remembers at 30% reads as an error. This sentence is what makes the number
  // legible, and it is the reason the field exists rather than the reader
  // inferring teaming from the amounts.
  if (input.teamWith.length > 0) {
    y -= 11
    text('Team with', LEFT, 8, true)
    text(input.teamWith.join(' and '), LEFT + 44, 8)
  }
  // A SEPARATE LINE, NOT A SECOND NAME ON THE SAME ONE. A driver can have both
  // — a team run and a referral on the same week — and merging them would put
  // a commission under a heading that says who was in the truck.
  if (input.referralWith.length > 0) {
    y -= 11
    text('Referral', LEFT, 8, true)
    text(input.referralWith.join(' and '), LEFT + 44, 8)
  }

  y -= 8
  rule()
  y -= 14

  // ── six summary rows, this period on the left and YTD on the right ─────
  //
  // THE YTD LABEL SAYS WHAT IT IS. With no opening balance for the year the
  // figure is a sum over Zebra's own settlements and NOT a year, so it is
  // labelled by the period it counts from rather than called YTD.
  const ytdLabel = (word: string) =>
    input.ytdFromPeriodStart === null
      ? `YTD ${word}:`
      : `${word} since ${usDate(input.ytdFromPeriodStart)}:`

  const rows: [string, number, number][] = [
    ['Earnings', input.summary.earningsCents, input.ytd.earningsCents],
    ['Advances', input.summary.advancesCents, input.ytd.advancesCents],
    [
      'Reimbursements',
      input.summary.reimbursementsCents,
      input.ytd.reimbursementsCents,
    ],
    ['Deductions', input.summary.deductionsCents, input.ytd.deductionsCents],
    ['Other pay', input.summary.otherPayCents, input.ytd.otherPayCents],
    ['Net Pay', input.summary.netCents, input.ytd.netCents],
  ]
  for (const [word, now, ytd] of rows) {
    const last = word === 'Net Pay'
    text(`${word}:`, LEFT, 8, last)
    right(statementMoney(now), 210, 8, last)
    text(ytdLabel(word), 280, 8, last)
    right(statementMoney(ytd), RIGHT, 8, last)
    y -= 12
  }
  y -= 8

  // ── Earnings ───────────────────────────────────────────────────────────
  text('Earnings', LEFT, 10, true)
  y -= 13
  const earnHeads = [
    'Load number',
    'PU',
    'DEL',
    'PU date',
    'DEL date',
    'Load gross',
    'Total miles',
    'Total amount',
  ]
  earnHeads.forEach((head, index) => {
    if (index >= 5) right(head, EARN_X[index]! + 46, 7, true)
    else text(head, EARN_X[index]!, 7, true)
  })
  y -= 4
  rule()
  y -= 11

  // ── SUB-HEADINGS ONLY WHEN THERE IS SOMETHING TO DISTINGUISH ────────
  //
  // A DELIBERATE DEPARTURE FROM THE ARTEFACT, and the first one this document
  // makes. Datatruck's Earnings table is a flat list, because a statement there
  // could only ever hold one authority's freight. Settlement is org-wide now
  // (Islom, 2026-09-11), so a driver who pulled RAM and Dolphins loads in one
  // week gets ONE statement — and an unlabelled flat list would tell him the
  // total without telling him which authority owed which half of it.
  //
  // THE SINGLE-COMPANY STATEMENT IS UNCHANGED, which is the other half of the
  // ruling and the reason this is a branch rather than a new layout. Almost
  // every statement has one company, and those must stay byte-identical in
  // shape to the document drivers have been reading for years.
  const companies = [...new Set(input.loads.map((load) => load.companyName))]
  const grouped = companies.length > 1

  let currentCompany: string | null = null
  for (const load of input.loads) {
    if (grouped && load.companyName !== currentCompany) {
      currentCompany = load.companyName
      y -= 2
      text(load.companyName, EARN_X[0]!, 8, true)
      y -= 11
    }
    text(load.loadNumber, EARN_X[0]!, 7)
    text(load.puPlace, EARN_X[1]!, 7)
    text(load.delPlace, EARN_X[2]!, 7)
    text(usDate(load.puDate), EARN_X[3]!, 7)
    text(usDate(load.delDate), EARN_X[4]!, 7)
    right(statementMoney(load.grossCents), EARN_X[5]! + 46, 7)
    right(statementMiles(load.milesHundredths), EARN_X[6]! + 46, 7)
    right(statementMoney(load.amountCents), EARN_X[7]! + 32, 7)
    y -= 11
  }

  y -= 2
  rule()
  y -= 12
  text('Total:', EARN_X[0]!, 8, true)
  right(statementMoney(input.totals.grossCents), EARN_X[5]! + 46, 8, true)
  right(statementMiles(input.totals.milesHundredths), EARN_X[6]! + 46, 8, true)
  right(statementMoney(input.totals.amountCents), EARN_X[7]! + 32, 8, true)
  y -= 20

  // ── Deductions and Other Pay, each OMITTED when it has no rows ─────────
  const chargeSection = (
    heading: string,
    firstHead: string,
    rows_: readonly StatementChargeRow[],
  ) => {
    if (rows_.length === 0) return
    text(heading, LEFT, 10, true)
    y -= 13
    const heads = [firstHead, 'Description', 'Quantity', 'Rate', 'Total amount']
    heads.forEach((head, index) => {
      if (index >= 2) right(head, DED_X[index]! + 46, 7, true)
      else text(head, DED_X[index]!, 7, true)
    })
    y -= 4
    rule()
    y -= 11
    let total = 0
    for (const row of rows_) {
      total += row.totalCents
      text(row.type, DED_X[0]!, 7)
      text(row.description, DED_X[1]!, 7)
      right(String(row.quantity), DED_X[2]! + 46, 7)
      right(statementMoney(row.rateCents), DED_X[3]! + 46, 7)
      right(statementMoney(row.totalCents), DED_X[4]! + 46, 7)
      y -= 11
    }
    y -= 2
    rule()
    y -= 12
    text('Total:', DED_X[0]!, 8, true)
    right(statementMoney(total), DED_X[4]! + 46, 8, true)
    y -= 20
  }

  chargeSection('Deductions', 'Deduction type', input.deductions)
  chargeSection('Other Pay', 'Other pay', input.otherPay)

  // The artefact's footer says "Powered by datatruck.io". Ours says who made
  // it, because a document that names the wrong system is a document somebody
  // takes their question to the wrong place about.
  y = 36
  text('Generated by Zebra', LEFT, 7)

  return assemblePdf(ops.join('\n'))
}
