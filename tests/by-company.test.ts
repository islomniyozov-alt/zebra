import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  assembleReport,
  type CompanyPeriodRow,
  type DriverPayRow,
} from '@/lib/by-company'

// ---------------------------------------------------------------------------
// WHAT THE PAGE DOES WITH TWO ANSWERS, WITHOUT A DATABASE.
//
// The SQL is graded in `tests/integration/by-company.test.ts` against seeded
// freight. This half is the rule that has nothing to do with Postgres: when
// driver pay is KNOWN and when it is merely absent, which are different facts
// and must not print the same.
// ---------------------------------------------------------------------------

const WEEK_1 = new Date(Date.UTC(2026, 7, 30))
const WEEK_2 = new Date(Date.UTC(2026, 8, 6))
const WEEK_3 = new Date(Date.UTC(2026, 8, 13))

const gross = (
  periodStart: Date,
  companyId: string,
  companyName: string,
  grossCents: number,
  atRateCents = 0,
): CompanyPeriodRow => ({
  periodStart,
  companyId,
  companyName,
  grossCents,
  atRateCents,
})

const pay = (
  periodStart: Date,
  companyId: string,
  driverPayCents: number,
): DriverPayRow => ({ periodStart, companyId, driverPayCents })

describe('after driver pay, before anything has been settled', () => {
  it('is a dash, not a zero, for periods before the first FINAL batch', () => {
    // THE MOST EXPENSIVE WRONG NUMBER THIS PAGE COULD PRINT. Datatruck paid
    // those drivers; Zebra never saw it. Zero would say the freight cost
    // nothing to drive.
    const report = assembleReport({
      gross: [gross(WEEK_1, 'ram', 'RAM', 100_000)],
      pay: [],
      firstSettledPeriodStart: WEEK_2,
    })
    expect(report.periods[0]!.companies[0]!.afterDriverPayCents).toBeNull()
    expect(report.periods[0]!.all.afterDriverPayCents).toBeNull()
  })

  it('is a real zero for a settled period that simply had no lines', () => {
    // THE PAIR, and the distinction the dash exists to make. A period after
    // the cutover with no settlement lines really did cost nothing in
    // Zebra-settled pay, and that zero is a fact rather than an absence.
    const report = assembleReport({
      gross: [gross(WEEK_2, 'ram', 'RAM', 100_000)],
      pay: [],
      firstSettledPeriodStart: WEEK_2,
    })
    expect(report.periods[0]!.companies[0]!.afterDriverPayCents).toBe(100_000)
  })

  it('dashes every period when nothing has ever been settled', () => {
    const report = assembleReport({
      gross: [gross(WEEK_1, 'ram', 'RAM', 1), gross(WEEK_3, 'ram', 'RAM', 2)],
      pay: [],
      firstSettledPeriodStart: null,
    })
    for (const period of report.periods) {
      expect(period.companies[0]!.afterDriverPayCents).toBeNull()
    }
  })
})

describe('the numbers', () => {
  const report = () =>
    assembleReport({
      gross: [
        gross(WEEK_2, 'ram', 'RAM', 500_000),
        gross(WEEK_2, 'dolphins', 'Dolphins', 300_000, 300_000),
      ],
      pay: [pay(WEEK_2, 'ram', 150_000), pay(WEEK_2, 'dolphins', 60_000)],
      firstSettledPeriodStart: WEEK_2,
    })

  it('subtracts each company from its own gross', () => {
    const [dolphins, ram] = report().periods[0]!.companies
    expect(ram!.afterDriverPayCents).toBe(350_000)
    expect(dolphins!.afterDriverPayCents).toBe(240_000)
  })

  it('sums the All companies row across both', () => {
    const all = report().periods[0]!.all
    expect(all.grossCents).toBe(800_000)
    expect(all.afterDriverPayCents).toBe(590_000)
  })

  it('carries the at-rate marker up into the total', () => {
    // A reader comparing two authorities deserves to know which of them is
    // quoting itself rather than billing anybody.
    expect(report().periods[0]!.all.atRateCents).toBe(300_000)
  })

  it('never pairs one company with another company lines', () => {
    // THE GUARD NAMED "a company's bar drawn from another's lines". Pairing
    // by period alone would hand Dolphins' pay to RAM and still produce two
    // plausible-looking numbers.
    const crossed = assembleReport({
      gross: [gross(WEEK_2, 'ram', 'RAM', 500_000)],
      pay: [pay(WEEK_2, 'dolphins', 999_999)],
      firstSettledPeriodStart: WEEK_2,
    })
    expect(crossed.periods[0]!.companies[0]!.afterDriverPayCents).toBe(500_000)
  })

  it('orders periods oldest first whatever order they arrive in', () => {
    const report = assembleReport({
      gross: [gross(WEEK_3, 'ram', 'RAM', 3), gross(WEEK_1, 'ram', 'RAM', 1)],
      pay: [],
      firstSettledPeriodStart: null,
    })
    expect(report.periods.map((p) => p.periodStart.getTime())).toEqual([
      WEEK_1.getTime(),
      WEEK_3.getTime(),
    ])
  })
})

// ── THE GROUPING IS SQL'S JOB ──────────────────────────────────────────
//
// The ruling is one query per number, grouped in SQL, inside five seconds on
// 14,464 loads. A version that pulled loads and grouped them here would pass
// every test above — the shape of the answer is identical — so what is checked
// is the source: the two readers group, and the assembler does not.
describe('where the grouping happens', () => {
  const source = readFileSync('src/lib/by-company.ts', 'utf8')

  // THREE SINCE 2026-09-28, not two: `driverTotals` is Reports' by-driver cut
  // (§6.2) and it aggregates settlements the same way, so it is under the same
  // rule and counted by the same instrument. The number is the number of
  // aggregate queries in this file, and a fourth has to come and say so here.
  it('groups every aggregate in SQL', () => {
    expect(source.match(/GROUP BY/g) ?? []).toHaveLength(3)
  })

  it('reads loads through the grouped queries and nowhere else', () => {
    // `findMany` over loads is the shape this forbids: it would mean rows
    // crossing the wire to be summed in a worker.
    expect(source).not.toMatch(/load\.findMany|loads\.map\(/)
  })
})
