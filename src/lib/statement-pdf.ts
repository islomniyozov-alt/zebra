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
  /** Zebra's own id, `DT-016018`. The fallback, and always present. */
  loadNumber: string
  /**
   * The BROKER's number for this load — `116RX75DK` — and what the Load
   * number column prints when there is one.
   *
   * Owner's ruling, 2026-09-30, off the artefact: ST-005562 lists Amazon's
   * references, because a driver checking a line against his own paperwork
   * has the broker's number in front of him and `DT-016018` means nothing
   * outside this system.
   *
   * NOT FROZEN, WHICH IS A COMPROMISE. The snapshot keeps `loadNumber` and
   * not this, so it is read through the relation at render time — see the
   * route. A frozen column is the proper fix and is a migration.
   */
  referenceNumber?: string | null
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
  /**
   * Stamp DRAFT across the sheet.
   *
   * Owner's ruling, 2026-09-30: every statement exports, and a draft's PDF
   * says so on its face. THE WATERMARK IS WHAT REPLACED THE REFUSAL — the
   * route used to answer 409 for a draft because its figures are rebuilt on
   * every refresh, and a sheet with DRAFT across it cannot be mistaken for
   * the one somebody was paid on, which is the whole thing the refusal was
   * protecting.
   */
  draft?: boolean
}

const LEFT = 40
const RIGHT = 572
const TOP = 780

// ---------------------------------------------------------------------------
// HOW WIDE A STRING IS, IN HELVETICA.
//
// THIS REPLACED `length * size * 0.5`, WHICH WAS WRONG IN BOTH DIRECTIONS AND
// PUT TWO COLUMNS ON TOP OF EACH OTHER. Owner, 2026-09-30: the Earnings
// table printed `310$1,503.26` and the header ran `Driver:` into
// `Unit Number:`.
//
// The approximation under-counted capitals badly — Helvetica's uppercase
// averages about 0.70 em against the 0.50 it assumed, so a 21-character
// driver name was measured 34pt narrower than it draws and sailed through the
// next column. On the totals row it under-counted digits just enough to put
// the mileage 2pt INSIDE the amount: measured, not guessed — see the test.
//
// SO THE WIDTHS ARE THE REAL ONES. Adobe's Helvetica advance widths, in
// 1/1000 em, for printable ASCII. Two properties of this font do most of the
// work: every DIGIT is 556, so figures are tabular and a column of them lines
// up, and `,` and `.` are both 278, so money strings of the same shape are
// the same width.
//
// UNKNOWN CHARACTERS COUNT AS 556, the digit width — a deliberate
// over-estimate for the narrow punctuation that might slip in, because
// over-estimating pushes a right-aligned cell LEFT, away from its neighbour.
// Wrong in the safe direction.
// ---------------------------------------------------------------------------

const HELVETICA_WIDTHS: Record<string, number> = {
  ' ': 278,
  '!': 278,
  '"': 355,
  '#': 556,
  $: 556,
  '%': 889,
  '&': 667,
  "'": 191,
  '(': 333,
  ')': 333,
  '*': 389,
  '+': 584,
  ',': 278,
  '-': 333,
  '.': 278,
  '/': 278,
  0: 556,
  1: 556,
  2: 556,
  3: 556,
  4: 556,
  5: 556,
  6: 556,
  7: 556,
  8: 556,
  9: 556,
  ':': 278,
  ';': 278,
  '<': 584,
  '=': 584,
  '>': 584,
  '?': 556,
  '@': 1015,
  A: 667,
  B: 667,
  C: 722,
  D: 722,
  E: 667,
  F: 611,
  G: 778,
  H: 722,
  I: 278,
  J: 500,
  K: 667,
  L: 556,
  M: 833,
  N: 722,
  O: 778,
  P: 667,
  Q: 778,
  R: 722,
  S: 667,
  T: 611,
  U: 722,
  V: 667,
  W: 944,
  X: 667,
  Y: 667,
  Z: 611,
  '[': 278,
  '\\': 278,
  ']': 278,
  '^': 469,
  _: 556,
  '`': 333,
  a: 556,
  b: 556,
  c: 500,
  d: 556,
  e: 556,
  f: 278,
  g: 556,
  h: 556,
  i: 222,
  j: 222,
  k: 500,
  l: 222,
  m: 833,
  n: 556,
  o: 556,
  p: 556,
  q: 556,
  r: 333,
  s: 500,
  t: 278,
  u: 556,
  v: 500,
  w: 722,
  x: 500,
  y: 500,
  z: 500,
  '{': 334,
  '|': 260,
  '}': 334,
  '~': 584,
}

/** Advance width in points. Exported so the layout test measures what draws. */
export function textWidth(value: string, size: number): number {
  let thousandths = 0
  for (const character of value) {
    thousandths += HELVETICA_WIDTHS[character] ?? 556
  }
  return (thousandths / 1000) * size
}

/**
 * The gap every pair of neighbouring cells must keep.
 *
 * A COLUMN BOUNDARY IS A DISTANCE, NOT A HOPE. The old layout left the
 * mileage's right edge 2pt from the amount's left edge and relied on no
 * figure ever being wide enough to close it; a five-digit mileage was.
 */
const COLUMN_GAP = 8

/** The Earnings table's column origins, measured off the artefact's spacing. */
const EARN_X = [40, 118, 216, 314, 370, 426, 492, 540] as const

/**
 * The three right-aligned Earnings columns, as RIGHT EDGES.
 *
 * Stated as edges rather than as `EARN_X[i] + 46`, which was an offset nobody
 * could check against anything. Budgeted from the page edge inwards: the
 * amount gets room for `$123,456.78` at 8pt, the mileage for `123,456.78`,
 * and `COLUMN_GAP` sits between them.
 */
const EARN_GROSS_RIGHT = 464
const EARN_MILES_RIGHT = 516
const EARN_AMOUNT_RIGHT = RIGHT

/** Header index -> the edge its column is right-aligned on. */
const EARN_RIGHT_FOR: Record<number, number> = {
  5: EARN_GROSS_RIGHT,
  6: EARN_MILES_RIGHT,
  7: EARN_AMOUNT_RIGHT,
}

const DED_X = [40, 118, 396, 452, 520] as const

/** The Deductions table's right-aligned columns, on the same discipline. */
const DED_QTY_RIGHT = 452
const DED_RATE_RIGHT = 512
const DED_TOTAL_RIGHT = RIGHT

const DED_RIGHT_FOR: Record<number, number> = {
  2: DED_QTY_RIGHT,
  3: DED_RATE_RIGHT,
  4: DED_TOTAL_RIGHT,
}

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
    // MEASURED, NOT ESTIMATED. `length * size * 0.5` was the bug: it
    // under-counted capitals by about a third and digits by a hair, which is
    // enough to slide a right-aligned cell into its neighbour.
    text(value, x - textWidth(value, size), size, bold)
  }
  const rule = () => {
    ops.push(`${LEFT} ${y} m ${RIGHT} ${y} l 0.5 w S`)
  }

  // ── THE DRAFT WATERMARK, DRAWN FIRST ───────────────────────────────────
  //
  // Before anything else, so every figure sits ON TOP of it and stays
  // readable — a stamp over the numbers would make the document harder to
  // check, which is the opposite of why somebody prints a draft.
  //
  // LIGHT GREY AND ROTATED, not a box in a corner. It has to survive being
  // photocopied, faxed to a factor, and photographed on a phone in a cab; a
  // corner label survives none of those as well as a diagonal across the
  // page. Roughly 45 degrees, by the rotation matrix, because PDF has no
  // `rotate` operator.
  if (input.draft) {
    const cos = 0.7071
    ops.push(
      'q 0.88 0.88 0.88 rg BT /F2 96 Tf ' +
        `${cos} ${cos} ${-cos} ${cos} 120 200 Tm (DRAFT) Tj ET Q`,
    )
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
  // ── LAID OUT BY MEASUREMENT, AND IT WRAPS ─────────────────────────────
  //
  // Four pairs every 133pt, with the value placed at `label.length * 4.2`,
  // which is the 0.5-em guess again wearing a different constant. A
  // 21-character driver name draws about 118pt wide and was allotted 84, so
  // `ABDUNAZARJONI ALIZODA` ran straight through `Unit Number:` — the second
  // half of what the owner reported on 2026-09-30.
  //
  // NOW EACH PAIR TAKES THE ROOM IT NEEDS AND THE ROW WRAPS when the next one
  // will not fit. A name is not a field with a maximum length; truncating one
  // on the document a driver checks their own pay against would be choosing
  // the wrong thing to protect.
  let x = LEFT
  for (const [label, value] of pairs) {
    // THE LABEL ALWAYS DRAWS, EVEN WITH NOTHING AFTER IT. Skipping the pair
    // when the value is empty dropped `Settlement:` from a draft — and §8's
    // rule is that a draft shows the line BLANK, not that it hides it. A
    // labelled blank says "no number yet"; an absent label says nothing, and
    // the reader cannot tell it from a sheet that never had the field.
    const labelWidth = textWidth(label, 8)
    const valueWidth = textWidth(value, 8)
    const pairWidth = labelWidth + 4 + valueWidth

    // WRAP RATHER THAN OVERFLOW. A pair that would cross the right margin
    // starts the next line instead of running off the sheet.
    if (x > LEFT && x + pairWidth > RIGHT) {
      y -= 12
      x = LEFT
    }

    text(label, x, 8, true)
    text(value, x + labelWidth + 4, 8)

    // AT LEAST THE OLD PITCH, SO THE COMMON CASE STILL LINES UP in columns —
    // a short Settlement and Batch ID keep the artefact's spacing, and only a
    // pair that genuinely needs more room pushes its neighbour along.
    x += Math.max(133, pairWidth + COLUMN_GAP)
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
    if (index >= 5) right(head, EARN_RIGHT_FOR[index]!, 7, true)
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
    // THE BROKER'S NUMBER, FALLING BACK TO ZEBRA'S. An empty string is a
    // load that never carried a reference, and `||` catches it where `??`
    // would print a blank cell.
    text(load.referenceNumber || load.loadNumber, EARN_X[0]!, 7)
    text(load.puPlace, EARN_X[1]!, 7)
    text(load.delPlace, EARN_X[2]!, 7)
    text(usDate(load.puDate), EARN_X[3]!, 7)
    text(usDate(load.delDate), EARN_X[4]!, 7)
    right(statementMoney(load.grossCents), EARN_GROSS_RIGHT, 7)
    right(statementMiles(load.milesHundredths), EARN_MILES_RIGHT, 7)
    right(statementMoney(load.amountCents), EARN_AMOUNT_RIGHT, 7)
    y -= 11
  }

  y -= 2
  rule()
  y -= 12
  text('Total:', EARN_X[0]!, 8, true)
  right(statementMoney(input.totals.grossCents), EARN_GROSS_RIGHT, 8, true)
  right(statementMiles(input.totals.milesHundredths), EARN_MILES_RIGHT, 8, true)
  right(statementMoney(input.totals.amountCents), EARN_AMOUNT_RIGHT, 8, true)
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
      if (index >= 2) right(head, DED_RIGHT_FOR[index]!, 7, true)
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
      right(String(row.quantity), DED_QTY_RIGHT, 7)
      right(statementMoney(row.rateCents), DED_RATE_RIGHT, 7)
      right(statementMoney(row.totalCents), DED_TOTAL_RIGHT, 7)
      y -= 11
    }
    y -= 2
    rule()
    y -= 12
    text('Total:', DED_X[0]!, 8, true)
    right(statementMoney(total), DED_TOTAL_RIGHT, 8, true)
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
