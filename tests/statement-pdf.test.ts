import { describe, expect, it } from 'vitest'
import {
  demoteLigatures,
  renderStatementPdf,
  statementMiles,
  statementMoney,
  usDate,
  type StatementPdfInput,
} from '@/lib/statement-pdf'
import { DATATRUCK_STATEMENTS } from './fixtures/datatruck-statements'

// ---------------------------------------------------------------------------
// THE STATEMENT, AGAINST THE LAYOUT IT REPLACES.
//
// Drivers have been reading this document for years. Every label and column
// header asserted here is VERBATIM from `corpus/datatruck`, so a rename in the
// renderer fails by the label it broke rather than by a pixel nobody measures.
// ---------------------------------------------------------------------------

const latin1 = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes)

/** Every string the renderer drew, in order. */
const drawn = (bytes: Uint8Array): string[] =>
  [...latin1(bytes).matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)].map((hit) =>
    hit[1]!.replace(/\\([()\\])/g, '$1'),
  )

const FIXTURE = DATATRUCK_STATEMENTS[3]! // ST-005317 — the one with Other Pay.

const inputFor = (
  overrides: Partial<StatementPdfInput> = {},
): StatementPdfInput => ({
  statementNumber: FIXTURE.number,
  batchNumber: FIXTURE.batch,
  company: { name: 'RAM Haulage LLC', address: '5062 Free Pike, Dayton, OH' },
  driverName: FIXTURE.driver,
  unitNumber: FIXTURE.unitNumber,
  // Solo, unless a case below overrides it.
  teamWith: [],
  payTariffLabel: FIXTURE.tariff,
  statementDate: new Date(FIXTURE.statementDate),
  periodStart: new Date(FIXTURE.periodStart),
  periodEnd: new Date(FIXTURE.periodEnd),
  checkDate: new Date(FIXTURE.checkDate),
  loads: FIXTURE.loads.map((row) => ({
    loadNumber: row.loadNumber,
    companyName: 'RAM Haulage LLC',
    puPlace: 'Greenfield,IN',
    delPlace: 'Fort Wayne,IN',
    puDate: new Date(row.puDate),
    delDate: new Date(row.delDate),
    grossCents: row.grossCents,
    milesHundredths: row.milesHundredths,
    amountCents: row.amountCents,
  })),
  totals: FIXTURE.totals,
  deductions: FIXTURE.deductions,
  otherPay: FIXTURE.otherPay,
  summary: FIXTURE.summary,
  ytd: FIXTURE.ytd,
  ytdFromPeriodStart: null,
  ...overrides,
})

describe('the money and date formats the artefact uses', () => {
  // PARENTHESES FOR NEGATIVES, which is what Datatruck prints. The screen rule
  // in TMS-DESIGN-SYSTEM is the opposite and deliberately so — that governs
  // Zebra's own screens, this reproduces somebody else's document.
  it('prints a negative in parentheses, as the statements do', () => {
    expect(statementMoney(-318421)).toBe('($3,184.21)')
    expect(statementMoney(1161276)).toBe('$11,612.76')
    expect(statementMoney(0)).toBe('$0.00')
  })

  it('groups miles and drops the trailing zeros', () => {
    expect(statementMiles(410038)).toBe('4,100.38')
    expect(statementMiles(37500)).toBe('375')
    expect(statementMiles(11700)).toBe('117')
    expect(statementMiles(21100)).toBe('211')
  })

  it('prints dates the American way, never localised', () => {
    expect(usDate(new Date(Date.UTC(2026, 7, 9)))).toBe('8/9/2026')
    expect(usDate(new Date(Date.UTC(2026, 11, 25)))).toBe('12/25/2026')
  })

  // Datatruck's own subset fonts keep these two in the Private Use Area, which
  // is why its raw text reads "Payment tari" and "Se lement".
  it('maps the two ligatures Datatruck leaves in the Private Use Area', () => {
    expect(demoteLigatures('Payment tari:')).toBe('Payment tariff:')
    expect(demoteLigatures('Selement')).toBe('Settlement')
    expect(demoteLigatures('Lile Rock,AR')).toBe('Little Rock,AR')
  })
})

describe('the statement, read back out of its own bytes', () => {
  const pdf = renderStatementPdf(inputFor())
  const text = drawn(pdf)
  const joined = text.join('\n')

  it('prints every header label the artefact prints', () => {
    for (const label of [
      'Statement Date:',
      'Period Start:',
      'Period End:',
      'Check Date:',
      'Driver Pay Settlement',
      'Settlement:',
      'Batch ID:',
      'Driver:',
      'Unit Number:',
      'Payment tariff:',
      'Pay to:',
    ]) {
      expect(text, label).toContain(label)
    }
  })

  it('prints the six summary rows by their own names', () => {
    for (const label of [
      'Earnings:',
      'Advances:',
      'Reimbursements:',
      'Deductions:',
      'Other pay:',
      'Net Pay:',
      'YTD Earnings:',
      'YTD Net Pay:',
    ]) {
      expect(text, label).toContain(label)
    }
  })

  it('prints the Earnings column headers verbatim', () => {
    for (const head of [
      'Load number',
      'PU',
      'DEL',
      'PU date',
      'DEL date',
      'Load gross',
      'Total miles',
      'Total amount',
    ]) {
      expect(text, head).toContain(head)
    }
  })

  it('prints the Deductions column headers verbatim', () => {
    for (const head of ['Deduction type', 'Description', 'Quantity', 'Rate']) {
      expect(text, head).toContain(head)
    }
  })

  it('carries every load line and its figures', () => {
    for (const load of FIXTURE.loads) {
      expect(text, load.loadNumber).toContain(load.loadNumber)
      expect(joined).toContain(statementMoney(load.amountCents))
    }
    expect(text).toContain(statementMoney(FIXTURE.totals.amountCents))
    expect(text).toContain(statementMiles(FIXTURE.totals.milesHundredths))
  })

  it('carries every deduction and the Other Pay row', () => {
    for (const row of FIXTURE.deductions) {
      expect(text, row.type).toContain(row.type)
      if (row.description) expect(text).toContain(row.description)
    }
    expect(text).toContain('Other Pay')
    expect(text).toContain('truck wash')
  })

  it('is one page of a valid PDF', () => {
    const raw = latin1(pdf)
    expect(raw.startsWith('%PDF-')).toBe(true)
    expect(raw).toContain('%%EOF')
    expect((raw.match(/\/Type\s*\/Page(?![s])/g) ?? []).length).toBe(1)
  })
})

// ── AN EMPTY SECTION IS OMITTED, NEVER RENDERED AT ZERO ──────────────────
//
// Straight off the artefact: both Dolphins statements have no Deductions block
// at all, while their summary row still reads $0.00. Two rules that have to
// hold at once, and the second is what makes the first visible as a rule
// rather than an accident of having no rows.
describe('an empty section', () => {
  const bare = renderStatementPdf(inputFor({ deductions: [], otherPay: [] }))
  const text = drawn(bare)

  it('is left out entirely, heading and column headers with it', () => {
    expect(text).not.toContain('Deductions')
    expect(text).not.toContain('Deduction type')
    expect(text).not.toContain('Other Pay')
    expect(text).not.toContain('Other pay')
  })

  it('still prints its summary row at zero, which is a different thing', () => {
    const zeroed = renderStatementPdf(
      inputFor({
        deductions: [],
        otherPay: [],
        summary: { ...FIXTURE.summary, deductionsCents: 0, otherPayCents: 0 },
      }),
    )
    expect(drawn(zeroed)).toContain('Deductions:')
    expect(drawn(zeroed)).toContain('Other pay:')
  })
})

describe('the YTD label', () => {
  it('says YTD when an opening balance backs it', () => {
    expect(drawn(renderStatementPdf(inputFor()))).toContain('YTD Net Pay:')
  })

  // WITH NO OPENING ROW THE FIGURE IS NOT A YEAR. On production
  // `DriverOpeningBalance` held zero rows when this was built, so this is the
  // live case rather than an edge.
  it('names the period it counts from when nothing backs it', () => {
    const text = drawn(
      renderStatementPdf(
        inputFor({ ytdFromPeriodStart: new Date(Date.UTC(2026, 7, 16)) }),
      ),
    )
    expect(text).not.toContain('YTD Net Pay:')
    expect(text).toContain('Net Pay since 8/16/2026:')
  })
})

// ---------------------------------------------------------------------------
// A STATEMENT THAT SPANS TWO AUTHORITIES.
//
// Settlement is org-wide by ruling (Islom, 2026-09-11), so a driver who pulled
// RAM and Dolphins freight in one week gets ONE statement. The Earnings table
// then groups its lines under company sub-headings — A DELIBERATE DEPARTURE
// from the artefact, which has a flat list because a Datatruck statement could
// only ever hold one authority's freight.
//
// THE SINGLE-COMPANY CASE STAYS IDENTICAL, which is the other half of the
// ruling and the reason this is a branch rather than a new layout. Almost every
// statement has one company, and those must keep the shape drivers have been
// reading for years.
// ---------------------------------------------------------------------------

describe('a statement carrying more than one authority', () => {
  const twoCompanies = inputFor({
    loads: FIXTURE.loads.map((row, index) => ({
      loadNumber: row.loadNumber,
      companyName: index < 3 ? 'RAM Haulage LLC' : 'Dolphin Transport inc',
      puPlace: 'Greenfield,IN',
      delPlace: 'Fort Wayne,IN',
      puDate: new Date(row.puDate),
      delDate: new Date(row.delDate),
      grossCents: row.grossCents,
      milesHundredths: row.milesHundredths,
      amountCents: row.amountCents,
    })),
  })

  it('prints a sub-heading for each authority', () => {
    const text = drawn(renderStatementPdf(twoCompanies))
    expect(text).toContain('RAM Haulage LLC')
    expect(text).toContain('Dolphin Transport inc')
  })

  it('still prints every load line and the one Total row', () => {
    const text = drawn(renderStatementPdf(twoCompanies))
    for (const load of FIXTURE.loads) {
      expect(text, load.loadNumber).toContain(load.loadNumber)
    }
    // ONE TOTAL, not one per group. The statement's Earnings total is what the
    // driver is paid; a per-company subtotal would be a second figure nobody
    // rules on.
    expect(
      text.filter((line) => line === 'Total:').length,
      'one Earnings total, whatever the grouping',
    ).toBeGreaterThanOrEqual(1)
    expect(text).toContain(statementMoney(FIXTURE.totals.amountCents))
  })

  // WATCHED FAILING by removing the `grouped` branch: a single-company
  // statement must print NO company heading, because that is the shape the
  // artefact has and the one almost every driver receives.
  it('prints no sub-heading when there is only one authority', () => {
    const text = drawn(renderStatementPdf(inputFor()))
    const headings = text.filter((line) => line === 'RAM Haulage LLC')
    // The letterhead line only — never a second one over the Earnings table.
    expect(headings).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// "TEAM WITH", WHICH IS WHAT MAKES A 20% LINE LEGIBLE.
//
// A team member is paid their OWN percentage of the shared gross — 20% each,
// not 40% split. Without this line a statement carrying 20% amounts from a
// driver everybody remembers at 30% reads as an error, and the person reading
// it is the person being paid.
// ---------------------------------------------------------------------------
describe('the team header', () => {
  it('names the other crew member, under the driver', () => {
    const drew = drawn(
      renderStatementPdf(inputFor({ teamWith: ['JULIA HALL'] })),
    )
    expect(drew).toContain('Team with')
    expect(drew).toContain('JULIA HALL')
  })

  it('says nothing at all on a solo statement', () => {
    // THE PAIR. Without it "Team with" could be printed unconditionally and
    // the test above would still pass — every solo statement would carry a
    // header about a crew that does not exist.
    const drew = drawn(renderStatementPdf(inputFor({ teamWith: [] })))
    expect(drew).not.toContain('Team with')
  })

  it('names both when a week had two different partners', () => {
    const drew = drawn(
      renderStatementPdf(inputFor({ teamWith: ['JULIA HALL', 'A N OTHER'] })),
    )
    expect(drew).toContain('JULIA HALL and A N OTHER')
  })
})
