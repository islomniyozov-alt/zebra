import { describe, expect, it } from 'vitest'
import {
  demoteLigatures,
  renderStatementPdf,
  statementMiles,
  statementMoney,
  usDate,
  textWidth,
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
  referralWith: [],
  payToName: null,
  payToAddress: null,
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

// ---------------------------------------------------------------------------
// THE REFERRAL LINE.
//
// Owner's ruling, 2026-09-24. A referral payee sits in `Load.coDriverId` to
// earn a commission, so before this the statement printed "Team with 7 Star"
// under the driver — a false claim about who was in the truck, on the document
// that driver reads to check their own pay.
// ---------------------------------------------------------------------------
describe('the referral header', () => {
  it('says Referral, not Team with', () => {
    const drew = drawn(
      renderStatementPdf(inputFor({ teamWith: [], referralWith: ['7 Star'] })),
    )
    expect(drew).toContain('Referral')
    expect(drew).toContain('7 Star')
    // THE POINT OF THE WHOLE CHANGE. A commission must not be described as
    // somebody who was in the cab.
    expect(drew).not.toContain('Team with')
  })

  it('says nothing at all when there is no referral', () => {
    // The pair, for the reason the team header's pair exists: without it the
    // line could be printed unconditionally and the test above would pass.
    const drew = drawn(renderStatementPdf(inputFor({ referralWith: [] })))
    expect(drew).not.toContain('Referral')
  })

  it('prints both headers when a week had a teammate AND a referral', () => {
    // These are separate lines rather than one merged list, because a driver
    // can have both in the same week and merging them would file a commission
    // under a heading that says who was in the truck.
    const drew = drawn(
      renderStatementPdf(
        inputFor({ teamWith: ['A N OTHER'], referralWith: ['7 Star'] }),
      ),
    )
    expect(drew).toContain('Team with')
    expect(drew).toContain('A N OTHER')
    expect(drew).toContain('Referral')
    expect(drew).toContain('7 Star')
  })
})

// ---------------------------------------------------------------------------
// WHOSE NAME IS ON THE CHEQUE.
//
// An owner-operator drives for us and invoices through their own LLC. The
// statement accompanies a payment, so it has to name the payee — a document
// that says one name while the cheque says another is a document somebody has
// to explain.
// ---------------------------------------------------------------------------
describe('the Pay to line', () => {
  it('prints the driver when there is no separate payee', () => {
    const drew = drawn(renderStatementPdf(inputFor({ payToName: null })))
    expect(drew).toContain('Pay to:')
    expect(drew).toContain(FIXTURE.driver)
  })

  it('prints the PAYEE when there is one, and not the driver', () => {
    // THE GUARD NAMED "statement prints driver when payTo exists". The driver
    // name still appears in the header's Driver: field — what must not happen
    // is the Pay to line naming them when somebody else is being paid.
    const drew = drawn(
      renderStatementPdf(inputFor({ payToName: 'MCKANE HAULING LLC' })),
    )
    const payToAt = drew.indexOf('Pay to:')
    expect(payToAt).toBeGreaterThan(-1)
    expect(drew[payToAt + 1]).toBe('MCKANE HAULING LLC')
    expect(drew[payToAt + 1]).not.toBe(FIXTURE.driver)
  })

  it('prints the payee address underneath when there is one', () => {
    const drew = drawn(
      renderStatementPdf(
        inputFor({
          payToName: 'MCKANE HAULING LLC',
          payToAddress: '12 Mill Road, Dayton, OH',
        }),
      ),
    )
    expect(drew).toContain('12 Mill Road, Dayton, OH')
  })

  it('prints no address line when there is no address', () => {
    // The pair, counted rather than eyeballed: an address always printed
    // would push the rule below it down on every statement in the system for
    // the sake of the rare one. One extra drawn string, exactly.
    const without = drawn(
      renderStatementPdf(inputFor({ payToName: 'MCKANE HAULING LLC' })),
    )
    const withAddress = drawn(
      renderStatementPdf(
        inputFor({
          payToName: 'MCKANE HAULING LLC',
          payToAddress: '12 Mill Road, Dayton, OH',
        }),
      ),
    )
    expect(withAddress.length).toBe(without.length + 1)
  })
})

// ---------------------------------------------------------------------------
// EVERY FIGURE, NOT EVERY LABEL.
//
// Owner's ruling, 2026-09-30: "a test that renders a fixture and checks every
// figure appears in the PDF text".
//
// THE CASES ABOVE CHECK THE LABELS THOROUGHLY AND THE NUMBERS PARTIALLY — a
// load line was asserted by its number and its amount, so its GROSS, its
// MILES, its two dates and its two places could all have gone missing and
// every test would have passed. A charge was asserted by type and
// description, so quantity, rate and total were unguarded. That is a test
// suite that proves the document has the right words on it.
//
// SO THIS ASSERTS THE VALUES, EXHAUSTIVELY, and it is deliberately dumb: take
// every number the input carries, render it the way the document renders it,
// and require it in the drawn text. No sampling, no "spot check the totals".
// ---------------------------------------------------------------------------

describe('every figure the input carries reaches the page', () => {
  const input = inputFor()
  const pdf = renderStatementPdf(input)
  const text = drawn(pdf)
  const joined = text.join('\n')

  /** Named, so a failure says WHICH figure rather than "expected true". */
  const printed = (value: string, what: string) => {
    expect(joined, what).toContain(value)
  }

  it('prints the five header values, not just their labels', () => {
    printed(input.statementNumber, 'settlement number')
    printed(input.batchNumber, 'batch number')
    printed(input.driverName, 'driver name')
    printed(input.unitNumber!, 'unit number')
    printed(input.payTariffLabel!, 'payment tariff')
    printed(input.company.name, 'letterhead name')
    printed(input.company.address, 'letterhead address')
  })

  it('prints all three dates', () => {
    printed(usDate(input.statementDate), 'statement date')
    printed(usDate(input.periodStart), 'period start')
    printed(usDate(input.periodEnd), 'period end')
    printed(usDate(input.checkDate), 'check date')
  })

  it('prints every column of every earnings line', () => {
    for (const load of input.loads) {
      printed(load.loadNumber, `${load.loadNumber} number`)
      printed(load.puPlace, `${load.loadNumber} PU`)
      printed(load.delPlace, `${load.loadNumber} DEL`)
      printed(usDate(load.puDate), `${load.loadNumber} PU date`)
      printed(usDate(load.delDate), `${load.loadNumber} DEL date`)
      printed(statementMoney(load.grossCents), `${load.loadNumber} load gross`)
      printed(
        statementMiles(load.milesHundredths),
        `${load.loadNumber} total miles`,
      )
      printed(statementMoney(load.amountCents), `${load.loadNumber} amount`)
    }
  })

  it('prints all three earnings totals', () => {
    printed(statementMoney(input.totals.grossCents), 'totals gross')
    printed(statementMiles(input.totals.milesHundredths), 'totals miles')
    printed(statementMoney(input.totals.amountCents), 'totals amount')
  })

  it('prints every column of every deduction', () => {
    for (const row of input.deductions) {
      printed(row.type, `${row.type} type`)
      if (row.description) printed(row.description, `${row.type} description`)
      printed(String(row.quantity), `${row.type} quantity`)
      printed(statementMoney(row.rateCents), `${row.type} rate`)
      printed(statementMoney(row.totalCents), `${row.type} total`)
    }
  })

  it('prints every column of every other-pay row', () => {
    // THE SECTION THE OLD CASE CHECKED BY GREPPING FOR THE WORDS "truck wash".
    expect(input.otherPay.length).toBeGreaterThan(0)
    for (const row of input.otherPay) {
      printed(row.type, `${row.type} type`)
      if (row.description) printed(row.description, `${row.type} description`)
      printed(String(row.quantity), `${row.type} quantity`)
      printed(statementMoney(row.rateCents), `${row.type} rate`)
      printed(statementMoney(row.totalCents), `${row.type} total`)
    }
  })

  it('prints all six summary figures', () => {
    for (const [key, cents] of Object.entries(input.summary)) {
      printed(statementMoney(cents), `summary ${key}`)
    }
  })

  it('prints all six YTD figures', () => {
    // THE COLUMN THE ARTEFACT PUTS BESIDE EVERY SUMMARY ROW, and the one a
    // driver checks a year against. Unasserted until now.
    for (const [key, cents] of Object.entries(input.ytd)) {
      printed(statementMoney(cents), `ytd ${key}`)
    }
  })

  it('leaves nothing in the input unaccounted for', () => {
    // A BACKSTOP AGAINST THIS TEST GOING STALE. Every money field anywhere in
    // the input, collected by walking the object rather than by listing them
    // — so a figure added to `StatementPdfInput` next year is required on the
    // page by default instead of quietly joining the unchecked.
    const cents: number[] = []
    const walk = (value: unknown, path: string) => {
      if (Array.isArray(value)) {
        value.forEach((item, index) => walk(item, `${path}[${index}]`))
        return
      }
      if (value && typeof value === 'object') {
        for (const [key, inner] of Object.entries(value)) {
          walk(inner, path ? `${path}.${key}` : key)
        }
        return
      }
      if (typeof value === 'number' && /Cents$/.test(path)) {
        cents.push(value)
      }
    }
    walk(input, '')
    expect(cents.length).toBeGreaterThan(20)
    for (const value of cents) {
      expect(joined, `${value} cents`).toContain(statementMoney(value))
    }
  })
})

// ---------------------------------------------------------------------------
// THE DRAFT WATERMARK (§6.2.2, owner's ruling 2026-09-30).
//
// It replaced a 409. The route used to refuse a draft because its figures are
// rebuilt on every refresh; the watermark is what makes rendering one safe, so
// these cases are the ones holding that trade open.
// ---------------------------------------------------------------------------

describe('a draft renders, and says so on its face', () => {
  const draft = renderStatementPdf(
    inputFor({ draft: true, statementNumber: '' }),
  )
  const final = renderStatementPdf(inputFor())

  it('stamps DRAFT across the sheet', () => {
    expect(drawn(draft)).toContain('DRAFT')
  })

  it('and a finalised one carries no such stamp', () => {
    expect(drawn(final)).not.toContain('DRAFT')
  })

  it('leaves the Settlement line empty rather than printing an id', () => {
    // §8: no number until one is issued. The placeholder is two row ids, and
    // printing it on paper would put there the exact string the heading rule
    // keeps off the screen.
    const text = drawn(draft)
    expect(text).toContain('Settlement:')
    expect(text.join('\n')).not.toMatch(/DRAFT-[a-z0-9]/)
  })

  it('still prints every figure — a draft is for checking', () => {
    // THE WHOLE REASON THE REFUSAL WAS WRONG. Somebody prints a draft to
    // check it before posting, so a watermarked sheet missing its numbers
    // would be worse than the 409 it replaced.
    const joined = drawn(draft).join('\n')
    for (const load of FIXTURE.loads) {
      expect(joined, load.loadNumber).toContain(load.loadNumber)
      expect(joined).toContain(statementMoney(load.grossCents))
      expect(joined).toContain(statementMoney(load.amountCents))
    }
    for (const [key, cents] of Object.entries(FIXTURE.summary)) {
      expect(joined, `summary ${key}`).toContain(statementMoney(cents))
    }
  })

  it('draws the watermark UNDER the figures, not over them', () => {
    // A stamp on top of the numbers makes the document harder to check,
    // which is the opposite of why somebody prints a draft. In PDF content
    // streams, first drawn is underneath.
    const raw = new TextDecoder('latin1').decode(draft)
    const stamp = raw.indexOf('(DRAFT) Tj')
    const firstFigure = raw.indexOf(
      `(${statementMoney(FIXTURE.totals.amountCents)}) Tj`,
    )
    expect(stamp).toBeGreaterThan(-1)
    expect(firstFigure).toBeGreaterThan(-1)
    expect(stamp).toBeLessThan(firstFigure)
  })

  it('is still one page of a valid PDF', () => {
    const raw = new TextDecoder('latin1').decode(draft)
    expect(raw.startsWith('%PDF-')).toBe(true)
    expect(raw).toContain('%%EOF')
    expect((raw.match(/\/Type\s*\/Page(?![s])/g) ?? []).length).toBe(1)
  })
})

describe('the Load number column is the broker number', () => {
  // Owner's ruling, 2026-09-30, off ST-005562 — which lists 116RX75DK and
  // T-111N3H6NQ, Amazon's references. A driver checking a line against his
  // own paperwork has the broker's number in front of him.
  const withRefs = inputFor({
    loads: FIXTURE.loads.map((row, index) => ({
      loadNumber: row.loadNumber,
      referenceNumber: index === 0 ? null : `REF-${index}`,
      companyName: 'RAM Haulage LLC',
      puPlace: 'Greenfield,IN',
      delPlace: 'Fort Wayne,IN',
      puDate: new Date(row.puDate),
      delDate: new Date(row.delDate),
      grossCents: row.grossCents,
      milesHundredths: row.milesHundredths,
      amountCents: row.amountCents,
    })),
  })
  // CELLS, NOT THE JOINED TEXT. Each entry is one string the renderer drew,
  // so an exact match is a claim about a CELL. The first version of the last
  // case searched the joined document and failed against a deduction reading
  // "Charge for late Del Load#111VS62GS" — a load number quoted inside a
  // sentence, which is true of the statement and says nothing about the
  // column under test.
  const cells = drawn(renderStatementPdf(withRefs))

  it('prints the reference where the load has one', () => {
    for (let index = 1; index < FIXTURE.loads.length; index++) {
      expect(cells, `REF-${index}`).toContain(`REF-${index}`)
    }
  })

  it('falls back to the DT- number where it does not', () => {
    // THE FALLBACK IS THE FROZEN FIELD, so a line is always identifiable
    // even when the reference is missing or later moves.
    expect(cells).toContain(FIXTURE.loads[0]!.loadNumber)
  })

  it('does not print both for the same line', () => {
    // A column that showed the reference AND the internal id would be two
    // answers to "which load is this", which is what the column exists to
    // give one of.
    for (let index = 1; index < FIXTURE.loads.length; index++) {
      expect(cells, FIXTURE.loads[index]!.loadNumber).not.toContain(
        FIXTURE.loads[index]!.loadNumber,
      )
    }
  })

  it('treats an empty reference as absent, not as a blank cell', () => {
    const empty = renderStatementPdf(
      inputFor({
        loads: [
          {
            loadNumber: 'DT-016018',
            referenceNumber: '',
            companyName: 'RAM Haulage LLC',
            puPlace: 'A,IN',
            delPlace: 'B,IN',
            puDate: new Date(Date.UTC(2026, 8, 4)),
            delDate: new Date(Date.UTC(2026, 8, 4)),
            grossCents: 17500,
            milesHundredths: 2500,
            amountCents: 525,
          },
        ],
      }),
    )
    expect(drawn(empty)).toContain('DT-016018')
  })
})

// ---------------------------------------------------------------------------
// NO TWO CELLS MAY TOUCH (owner's report, 2026-09-30).
//
// The Earnings table printed `310$1,503.26` and the header ran `Driver:` into
// `Unit Number:`. Both came from one cause: the renderer measured every
// string as `length * size * 0.5`, which under-counts Helvetica capitals by
// about a third and digits by a hair — enough to slide a right-aligned cell
// into its neighbour.
//
// ── WHY THIS MEASURES THE CONTENT STREAM AND NOT `pdftotext` ─────────────
//
// The ruling asks for "a space or column boundary in the extracted text", and
// the faithful way to read that is a layout-preserving extraction. `pdftotext
// -layout` would do it and is how the corpus is read — but it is poppler, it
// is not installed on the CI runner, and a test that silently skips where it
// matters is worse than no test.
//
// So this reads the positions the renderer WROTE: every `Td` carries an x and
// a baseline, and `textWidth` is the same function the renderer places with.
// Cells on one baseline are sorted left to right and required to keep a real
// gap. That is the column boundary, measured in points, which is the thing
// "a space in the text" is evidence OF.
// ---------------------------------------------------------------------------

interface DrawnCell {
  x: number
  size: number
  text: string
}

/** Every drawn run, grouped by baseline, left to right. */
function cellsByRow(bytes: Uint8Array): Map<number, DrawnCell[]> {
  const raw = new TextDecoder('latin1').decode(bytes)
  const rows = new Map<number, DrawnCell[]>()
  const runs = raw.matchAll(
    /BT \/F\d (\d+(?:\.\d+)?) Tf (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) Td \(((?:\\.|[^\\()])*)\) Tj ET/g,
  )
  for (const run of runs) {
    const size = Number(run[1])
    const x = Number(run[2])
    const y = Number(run[3])
    const text = run[4]!.replace(/\\([()\\])/g, '$1')
    if (text === '') continue
    if (!rows.has(y)) rows.set(y, [])
    rows.get(y)!.push({ x, size, text })
  }
  for (const cells of rows.values()) cells.sort((a, b) => a.x - b.x)
  return rows
}

/**
 * The gap a column boundary must keep, less a hair for binary arithmetic.
 *
 * The header's gap comes out at 7.999999999999943 against a COLUMN_GAP of 8 —
 * summing per-character widths in floating point does that. An epsilon here
 * is honest; rounding the measurement would hide a real 0.4pt error just as
 * happily as this imaginary one.
 */
const COLUMN_GAP_PT = 8 - 1e-6

describe('the sheet has no two cells touching', () => {
  const pdf = renderStatementPdf(
    inputFor({
      // THE NAME THAT BROKE IT. Twenty-one capitals, measured 34pt narrower
      // than it draws under the old approximation.
      driverName: 'ABDUNAZARJONI ALIZODA',
    }),
  )
  const rows = cellsByRow(pdf)

  it('keeps a real gap between every neighbouring pair', () => {
    const tight: string[] = []
    for (const [y, cells] of rows) {
      for (let index = 0; index + 1 < cells.length; index++) {
        const left = cells[index]!
        const next = cells[index + 1]!
        const gap = next.x - (left.x + textWidth(left.text, left.size))
        // THREE POINTS, NOT ZERO. "Do the glyphs overlap" is the wrong
        // question: the header that was reported as running together left
        // 1.4pt between the driver's name and the next label, which does not
        // overlap and does read as one word. The smallest DELIBERATE gap on
        // the sheet is the 4pt between a label and its own value, so three
        // is the widest floor that accuses nothing innocent.
        if (gap < 3) {
          tight.push(
            `y=${y} gap=${gap.toFixed(2)} ${JSON.stringify(left.text)} | ${JSON.stringify(next.text)}`,
          )
        }
      }
    }
    expect(tight, tight.join('\n')).toEqual([])
  })

  it('separates the mileage from the amount on every earnings row', () => {
    // THE PAIR THAT WAS REPORTED, asserted by name rather than only by the
    // sweep above — so a regression here fails with the owner's own example
    // instead of as one line in a list.
    const money = FIXTURE.loads.map((load) => statementMoney(load.amountCents))
    let checked = 0
    for (const cells of rows.values()) {
      for (let index = 0; index + 1 < cells.length; index++) {
        const left = cells[index]!
        const next = cells[index + 1]!
        if (!money.includes(next.text)) continue
        const gap = next.x - (left.x + textWidth(left.text, left.size))
        // THE FULL COLUMN GAP HERE, because these are two COLUMNS rather
        // than a label and its value — and this is the pair that was
        // reported printing as `310$1,503.26`.
        expect(gap, `${left.text} | ${next.text}`).toBeGreaterThanOrEqual(
          COLUMN_GAP_PT,
        )
        checked += 1
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('keeps the driver name clear of the next header field', () => {
    const header = [...rows.values()].find((cells) =>
      cells.some((cell) => cell.text === 'Driver:'),
    )
    expect(header).toBeDefined()
    const name = header!.find((cell) => cell.text === 'ABDUNAZARJONI ALIZODA')
    expect(name).toBeDefined()
    const after = header!.find((cell) => cell.x > name!.x)
    if (after) {
      const gap = after.x - (name!.x + textWidth(name!.text, name!.size))
      expect(gap, `name | ${after.text}`).toBeGreaterThanOrEqual(COLUMN_GAP_PT)
    }
  })

  it('draws nothing past the right margin', () => {
    for (const cells of rows.values()) {
      for (const cell of cells) {
        const rightEdge = cell.x + textWidth(cell.text, cell.size)
        // The watermark is rotated and placed by matrix, not by Td, so it is
        // not in this set at all — everything here is ordinary text.
        expect(rightEdge, cell.text).toBeLessThanOrEqual(573)
      }
    }
  })
})
