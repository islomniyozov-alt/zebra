import { describe, expect, it } from 'vitest'
import {
  computeBatch,
  computeDriverSettlement,
  grossFor,
  isSettlementWeek,
  payoutDateFor,
  tariffLabel,
  weekOf,
  payWeekFor,
  __rounding,
  type DriverSettlementInput,
  type SettleableLoad,
} from '@/lib/settlement-week'
import type { RecurringRule, OneOffCharge } from '@/lib/deductions'
import type { PayRule } from '@/lib/driver-pay'
import {
  DATATRUCK_STATEMENTS,
  DATATRUCK_STATEMENT_ST005395,
  type StatementFixture,
} from './fixtures/datatruck-statements'

// ---------------------------------------------------------------------------
// THE SIX STATEMENTS, REPRODUCED.
//
// The acceptance for MONEY-DESIGN item 3: given those loads at those grosses,
// those rules and those charges, the engine must reproduce every per-line Total
// amount, every deduction line, and Earnings / Deductions / Net Pay to the cent.
//
// EACH STATEMENT IS ITS OWN TEST, so a failure names the statement rather than
// reporting "reproduction failed". Inside each, the per-line comparison is
// built as a LIST and asserted once, so a mismatch prints every line that
// differs with the arithmetic beside it — the brief asks for the line that
// differs, which a per-line `expect` in a loop cannot give you (it stops at the
// first one).
//
// ── WHAT IS SUPPLIED AND WHAT IS COMPUTED ────────────────────────────────
//
// Supplied: the loads with their grosses and dates, the pay percentage, the
// standing deduction rules, the one-off charges, and the escrow balance.
// Computed: every Total amount, every deduction line's description and figure,
// the section totals, and Net Pay.
//
// The printed amounts are NEVER fed in. `fixture.loads[].amountCents` is only
// ever on the right-hand side of an assertion.
// ---------------------------------------------------------------------------

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`

const SUNDAY = (ms: number) => new Date(ms)

/** A percentage rule in force for the whole period. */
const percentRule = (bps: number, from: number): PayRule => ({
  id: 'rule-1',
  type: 'PERCENT_GROSS',
  percentBps: bps,
  perMileCents: null,
  flatCents: null,
  effectiveFrom: new Date(from - 365 * 86_400_000),
  effectiveTo: null,
})

/** Broker freight: settles on the rate, waits for nothing. */
const loadsOf = (fixture: StatementFixture): SettleableLoad[] =>
  fixture.loads.map((row, index) => ({
    id: `load-${String(index)}`,
    loadNumber: row.loadNumber,
    // ONE AUTHORITY PER STATEMENT IN THE ARTEFACT. Settlement is org-wide now
    // and a statement CAN span companies, but none of the six does — each of
    // these drivers pulled for one authority that week, which is why all six
    // still reproduce unchanged.
    companyId: 'co-1',
    companyName: fixture.company,
    puPlace: 'PU',
    delPlace: 'DEL',
    puDate: new Date(row.puDate),
    delDate: new Date(row.delDate),
    rateCents: row.grossCents,
    milesHundredths: row.milesHundredths,
    direct: null,
  }))

const WEEKLY = 'WEEKLY' as const
const MONTHLY = 'MONTHLY_SPLIT_WEEKLY' as const

const rule = (
  id: string,
  type: string,
  description: string | null,
  amountCents: number,
  extra: Partial<RecurringRule> = {},
): RecurringRule => ({
  id,
  type,
  description,
  amountCents,
  cadence: WEEKLY,
  monthlyTotalCents: null,
  targetCents: null,
  effectiveFrom: new Date(Date.UTC(2020, 0, 1)),
  effectiveTo: null,
  ...extra,
})

/**
 * The standing rules behind each statement's Deductions block.
 *
 * TRANSCRIBED FROM WHAT THE STATEMENTS PRINT, then left to the engine to
 * render. `Insurance (GL, AL, Cargo, TI) for {month} {split}` is ONE stored
 * rule that produces both `for August $1800/$450` and `for August 24days` —
 * which is the thing item 2 was accepted on and is re-proved here through the
 * settlement rather than through the deduction engine alone.
 */
function setupFor(fixture: StatementFixture): {
  recurring: RecurringRule[]
  charges: OneOffCharge[]
  escrowHeldCents: number
  fuelCents: number | null
  collectedThisMonthCents: Record<string, number>
} {
  const find = (type: string) =>
    fixture.deductions.find((row) => row.type === type) ?? null
  const recurring: RecurringRule[] = []
  const charges: OneOffCharge[] = []
  const collectedThisMonthCents: Record<string, number> = {}
  let escrowHeldCents = 0
  let fuelCents: number | null = null

  const fuel = find('Fuel')
  if (fuel) {
    recurring.push(rule('fuel', 'Fuel', 'Auto calculated Fuel cost', 0))
    fuelCents = fuel.rateCents
  }

  const insurance = find('Insurance')
  if (insurance) {
    // ONE STORED RULE, TWO PRINTED STRINGS — the thing item 2 was accepted on.
    //
    //   ST-005284  "for August $1800/$450"   the ordinary weekly instalment
    //   ST-005310  "for August 24days"       the month-end true-up
    //
    // The second is not a different rule; it is the SAME rule whose cover ended
    // 24 days into August. `{split}` renders as the target/instalment pair
    // normally and as `24days` when the month is the rule's last — which is why
    // the fixture supplies `effectiveTo` and what the month had already
    // collected, and NOT the $43.55. That figure is the engine's to find.
    //
    // $1,350 is three weekly instalments of $450, already taken in August
    // before this period. A fact about the month, read off the rate the other
    // statement prints — never derived from the answer being checked.
    const prorated = /(\d+)days/.exec(insurance.description)
    const WEEKLY_INSTALMENT = 45_000
    recurring.push(
      rule(
        'insurance',
        'Insurance',
        'Insurance (GL, AL, Cargo, TI) for {month} {split}',
        WEEKLY_INSTALMENT,
        {
          cadence: MONTHLY,
          monthlyTotalCents: 180_000,
          ...(prorated
            ? {
                effectiveTo: new Date(Date.UTC(2026, 7, Number(prorated[1]!))),
              }
            : {}),
        },
      ),
    )
    if (prorated) collectedThisMonthCents.insurance = 3 * WEEKLY_INSTALMENT
  }

  const tolls = find('Tolls')
  if (tolls) {
    recurring.push(
      rule('tolls', 'Tolls', 'TollPrePass {from} to {to}', tolls.rateCents),
    )
  }

  for (const type of ['Ifta', 'Admin Fee']) {
    const row = find(type)
    // NULL DESCRIPTION IS THE POINT: both print a blank Description cell on
    // the real statement, and a blank there is a fact about the charge.
    if (row) recurring.push(rule(type.toLowerCase(), type, null, row.rateCents))
  }

  const escrow = find('Escrow')
  if (escrow) {
    // `Security Deposit $2500/$500` then `$2500/$250` on consecutive weeks —
    // the remaining falling by exactly the instalment, which is what says the
    // second figure is REMAINING rather than anything else it could have been.
    const remaining = Number(
      /\$[\d,]+\/\$([\d,]+)/.exec(escrow.description)?.[1]?.replace(/,/g, '') ??
        '0',
    )
    recurring.push(
      rule('escrow', 'Escrow', 'Security Deposit {split}', escrow.rateCents, {
        targetCents: 250_000,
      }),
    )
    escrowHeldCents = 250_000 - remaining * 100
  }

  // One-offs: anything the statement prints that is not a standing rule.
  for (const row of fixture.deductions) {
    if (
      ['Fuel', 'Insurance', 'Tolls', 'Ifta', 'Admin Fee', 'Escrow'].includes(
        row.type,
      )
    ) {
      continue
    }
    charges.push({
      id: `charge-${row.description}`,
      type: row.type,
      description: row.description,
      amountCents: row.totalCents,
      appliesOn: new Date(fixture.periodEnd),
    })
  }
  for (const row of fixture.otherPay) {
    charges.push({
      id: `credit-${row.description}`,
      type: row.type,
      description: row.description,
      amountCents: row.totalCents,
      appliesOn: new Date(fixture.periodEnd),
    })
  }

  return {
    recurring,
    charges,
    escrowHeldCents,
    fuelCents,
    collectedThisMonthCents,
  }
}

function inputFor(fixture: StatementFixture): DriverSettlementInput {
  const setup = setupFor(fixture)
  return {
    driverId: 'driver-1',
    driverName: fixture.driver,
    // The six reproduced Datatruck statements are all SOLO. Team driving
    // starts 2026-09-04 and every load on these delivered long before it.
    teamWith: [],
    // The six reproduced statements are all paid to the driver.
    payToName: null,
    payToAddress: null,
    unitNumber: fixture.unitNumber,
    period: {
      start: SUNDAY(fixture.periodStart),
      end: SUNDAY(fixture.periodEnd),
    },
    loads: loadsOf(fixture),
    payRules: [percentRule(fixture.percentBps, fixture.periodStart)],
    recurring: setup.recurring,
    charges: setup.charges,
    escrowHeldCents: setup.escrowHeldCents,
    fuelCents: setup.fuelCents,
    collectedThisMonthCents: setup.collectedThisMonthCents,
    // THE ARTEFACT SHOWS NO LAG, and 2026-09-11 explained why: there is no
    // per-driver lag to see. The company pays two weeks behind uniformly, so
    // every driver's `payoutLagWeeks` is 0 and the cadence lives in the check
    // date somebody types (§0). Reported at the time as a discrepancy between
    // the ruling and the six statements; the statements were right.
    payoutLagWeeks: 0,
    letterheadCompanyId: 'co-1',
    checkDate: new Date(fixture.checkDate),
    openingBalances: {},
    priorThisYear: [],
    firstSettledPeriodStart: null,
  }
}

describe('the six Datatruck statements, reproduced line by line', () => {
  for (const fixture of DATATRUCK_STATEMENTS) {
    describe(`${fixture.number} — ${fixture.driver}, ${fixture.tariff}`, () => {
      const settlement = computeDriverSettlement(inputFor(fixture))

      it('reproduces every per-line Total amount', () => {
        expect(settlement.lines).toHaveLength(fixture.loads.length)
        const differ = settlement.lines
          .map((line, index) => ({ line, printed: fixture.loads[index]! }))
          .filter(
            ({ line, printed }) => line.amountCents !== printed.amountCents,
          )
          .map(
            ({ line, printed }) =>
              `${printed.loadNumber}: ${money(printed.grossCents)} at ${fixture.percentBps / 100}% computed ${money(line.amountCents)}, printed ${money(printed.amountCents)}`,
          )
        expect(differ, `${fixture.number} per-line amounts`).toEqual([])
      })

      it('reproduces the Earnings total row', () => {
        expect(settlement.earningsCents).toBe(fixture.totals.amountCents)
        expect(settlement.grossCents).toBe(fixture.totals.grossCents)
        expect(settlement.milesHundredths).toBe(fixture.totals.milesHundredths)
      })

      it('reproduces every deduction line, description included', () => {
        const printed = fixture.deductions.map(
          (row) =>
            `${row.type} | ${row.description} | ${row.quantity} | ${money(row.rateCents)} | ${money(row.totalCents)}`,
        )
        const computed = settlement.deductionLines.map(
          (line) =>
            `${line.type} | ${line.description} | ${line.quantity} | ${money(line.rateCents)} | ${money(line.totalCents)}`,
        )
        expect(computed.sort(), `${fixture.number} deductions`).toEqual(
          printed.sort(),
        )
      })

      it('reproduces the Other Pay section', () => {
        const printed = fixture.otherPay.map(
          (row) =>
            `${row.type} | ${row.description} | ${money(row.totalCents)}`,
        )
        const computed = settlement.otherPayLines.map(
          (line) =>
            `${line.type} | ${line.description} | ${money(line.totalCents)}`,
        )
        expect(computed.sort()).toEqual(printed.sort())
      })

      it('reproduces Earnings, Deductions and Net Pay to the cent', () => {
        expect({
          earnings: settlement.earningsCents,
          deductions: settlement.deductionsCents,
          otherPay: settlement.otherPayCents,
          net: settlement.netCents,
        }).toEqual({
          earnings: fixture.summary.earningsCents,
          deductions: fixture.summary.deductionsCents,
          otherPay: fixture.summary.otherPayCents,
          net: fixture.summary.netCents,
        })
      })

      it('prints the payment tariff exactly as the statement does', () => {
        expect(settlement.payTariffLabel).toBe(fixture.tariff)
      })

      // OMITTED, NOT ZEROED. Both Dolphins statements have no Deductions block
      // at all while their summary still reads $0.00 — two different rules that
      // have to hold at once.
      it('omits an empty section rather than printing it at zero', () => {
        expect(settlement.deductionLines.length === 0).toBe(
          fixture.deductions.length === 0,
        )
        expect(settlement.otherPayLines.length === 0).toBe(
          fixture.otherPay.length === 0,
        )
      })
    })
  }
})

// ---------------------------------------------------------------------------
// PER LINE, NOT ON THE TOTAL — AND FOUR OF THE SIX SETTLE IT.
//
// MONEY-DESIGN §6 recorded this as UNCONFIRMED: "the per-line rounding claim
// still needs checking against a line whose per-line and on-total results
// actually differ — none of the six happens to be one".
//
// Four of them are. Rounding the whole gross at once gives a DIFFERENT cent
// from summing the rounded lines on ST-005310, ST-005317, ST-005336 and
// ST-005352, and in every case the statement prints the per-line answer:
//
//   ST-005310   $9,210.76 x 88%  -> on-total $8,105.47   printed $8,105.46
//   ST-005317  $10,839.15 x 30%  -> on-total $3,251.75   printed $3,251.74
//   ST-005336   $9,490.80 x 32%  -> on-total $3,037.06   printed $3,037.05
//   ST-005352   $5,556.01 x 30%  -> on-total $1,666.80   printed $1,666.81
//
// A cent a week per driver is not the point; being unable to say which rule
// the software follows is. This is the assertion that says it.
// ---------------------------------------------------------------------------

describe('rounding happens per line and not once on the total', () => {
  const onTotal = (fixture: StatementFixture) =>
    __rounding.percentOfCents(fixture.totals.grossCents, fixture.percentBps)

  it('disagrees with the on-total answer on four of the six', () => {
    const differing = DATATRUCK_STATEMENTS.filter(
      (fixture) => onTotal(fixture) !== fixture.totals.amountCents,
    ).map((fixture) => fixture.number)
    expect(differing).toEqual([
      'ST-005310',
      'ST-005317',
      'ST-005336',
      'ST-005352',
    ])
  })

  it('prints the per-line answer every time they differ', () => {
    for (const fixture of DATATRUCK_STATEMENTS) {
      const perLine = fixture.loads.reduce(
        (sum, row) =>
          sum + __rounding.percentOfCents(row.grossCents, fixture.percentBps),
        0,
      )
      expect(perLine, fixture.number).toBe(fixture.totals.amountCents)
    }
  })
})

describe('the week boundary', () => {
  it('takes Sunday to Saturday, from any day inside it', () => {
    const week = weekOf(new Date(Date.UTC(2026, 7, 19)))
    expect(week.start.toISOString().slice(0, 10)).toBe('2026-08-16')
    expect(week.end.toISOString().slice(0, 10)).toBe('2026-08-22')
  })

  it('agrees with every period the six statements print', () => {
    for (const fixture of DATATRUCK_STATEMENTS) {
      const week = {
        start: new Date(fixture.periodStart),
        end: new Date(fixture.periodEnd),
      }
      expect(isSettlementWeek(week), fixture.number).toBe(true)
      expect(weekOf(week.start).start.getTime()).toBe(fixture.periodStart)
    }
  })

  // WATCHED FAILING: a Monday-to-Sunday period would settle the same loads
  // under a different name and nothing downstream could tell.
  it('refuses a week that does not start on a Sunday', () => {
    expect(
      isSettlementWeek({
        start: new Date(Date.UTC(2026, 7, 17)),
        end: new Date(Date.UTC(2026, 7, 23)),
      }),
    ).toBe(false)
  })

  // The other half, and it needs its own case: a fortnight starts on a Sunday
  // and ends on a Saturday, so only the SPAN tells it from a week.
  it('refuses a fortnight, which passes every check but the length', () => {
    expect(
      isSettlementWeek({
        start: new Date(Date.UTC(2026, 7, 16)),
        end: new Date(Date.UTC(2026, 7, 29)),
      }),
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// "THIS WEEK" IS THE PERIOD PAID THIS FRIDAY, NOT THE ONE THAT JUST CLOSED.
//
// The company pays two weeks behind (§0). Pinned on three weekdays because the
// boundary case is a Saturday — the first step of the arithmetic lands on TODAY
// there, and a reading that treated the week ending today as "the most recent
// closed week" would show freight nobody is paid for until a fortnight later.
// ---------------------------------------------------------------------------

describe('the period due this Friday', () => {
  const pinned = [
    ['Tuesday', Date.UTC(2026, 8, 15)],
    ['Sunday', Date.UTC(2026, 8, 13)],
    ['Saturday', Date.UTC(2026, 8, 12)],
  ] as const

  for (const [weekday, today] of pinned) {
    it(`is Aug 30 - Sep 5, paying Fri 9/18, when today is a ${weekday}`, () => {
      const { period, payDay } = payWeekFor(new Date(today))
      expect(period.start.toISOString().slice(0, 10)).toBe('2026-08-30')
      expect(period.end.toISOString().slice(0, 10)).toBe('2026-09-05')
      expect(payDay.toISOString().slice(0, 10)).toBe('2026-09-18')
    })
  }

  // THE ARTEFACT'S OWN ROW: Aug 23-29 was paid 9/11. On the Friday itself the
  // screen shows the period being paid that day.
  it('shows the period being paid today, when today is the pay Friday', () => {
    const { period, payDay } = payWeekFor(new Date(Date.UTC(2026, 8, 11)))
    expect(period.start.toISOString().slice(0, 10)).toBe('2026-08-23')
    expect(period.end.toISOString().slice(0, 10)).toBe('2026-08-29')
    expect(payDay.toISOString().slice(0, 10)).toBe('2026-09-11')
  })

  // NEVER THE MOST RECENT CLOSED WEEK, which is the whole point and the guard
  // the brief names. On Tue 9/15 the week that just closed is Sep 6-12.
  it('is never the week that just closed', () => {
    const { period } = payWeekFor(new Date(Date.UTC(2026, 8, 15)))
    const justClosed = weekOf(new Date(Date.UTC(2026, 8, 12)))
    expect(period.start.getTime()).not.toBe(justClosed.start.getTime())
    expect(justClosed.start.getTime() - period.start.getTime()).toBe(
      7 * 86_400_000,
    )
  })

  it('always yields a real Sunday-to-Saturday period, and a Friday', () => {
    // Every day of one year, so no weekday is the untested one.
    for (let day = 0; day < 365; day++) {
      const today = new Date(Date.UTC(2026, 0, 1) + day * 86_400_000)
      const { period, payDay } = payWeekFor(today)
      expect(isSettlementWeek(period), today.toISOString()).toBe(true)
      expect(payDay.getUTCDay(), today.toISOString()).toBe(5)
      // And it is always the UPCOMING Friday, never one in the past.
      expect(payDay.getTime()).toBeGreaterThanOrEqual(
        Date.UTC(
          today.getUTCFullYear(),
          today.getUTCMonth(),
          today.getUTCDate(),
        ),
      )
      // Thirteen days, which is what §0 states.
      expect(payDay.getTime() - period.end.getTime()).toBe(13 * 86_400_000)
    }
  })
})

describe('which gross a load settles on', () => {
  const amazon = (
    outcome: 'matched_exact' | 'short' | 'over' | 'none',
    remittedCents: number | null,
    confirmedCents: number | null = null,
  ): SettleableLoad => ({
    id: 'l1',
    loadNumber: 'AMZ1',
    companyId: 'co-1',
    companyName: 'Amazon Co',
    puPlace: 'A',
    delPlace: 'B',
    puDate: new Date(Date.UTC(2026, 7, 17)),
    delDate: new Date(Date.UTC(2026, 7, 18)),
    rateCents: 100_000,
    milesHundredths: 10_000,
    direct: { outcome, remittedCents, confirmedCents },
  })

  it('settles broker freight on the rate', () => {
    const decision = grossFor({ ...amazon('none', null), direct: null })
    expect(decision).toEqual({
      settles: true,
      grossCents: 100_000,
      basis: 'rate',
    })
  })

  it('settles a matched remittance automatically, on the remitted figure', () => {
    expect(grossFor(amazon('matched_exact', 100_000))).toEqual({
      settles: true,
      grossCents: 100_000,
      basis: 'remitted',
    })
  })

  it('holds a short remittance until somebody confirms it', () => {
    const decision = grossFor(amazon('short', 90_000))
    expect(decision.settles).toBe(false)
    if (decision.settles) return
    expect(decision.reason).toEqual({
      kind: 'short',
      remittedCents: 90_000,
      rateCents: 100_000,
    })
  })

  it('holds an over remittance too, rather than quietly taking the bigger one', () => {
    const decision = grossFor(amazon('over', 110_000))
    expect(decision.settles).toBe(false)
  })

  it('holds a load with no remittance, and says that is why', () => {
    const decision = grossFor(amazon('none', null))
    expect(decision.settles).toBe(false)
    if (decision.settles) return
    expect(decision.reason.kind).toBe('no_remittance')
  })

  it('settles on the confirmed figure once dispatch has confirmed it', () => {
    expect(grossFor(amazon('short', 90_000, 90_000))).toEqual({
      settles: true,
      grossCents: 90_000,
      basis: 'confirmed',
    })
  })
})

describe('a held load contributes nothing to the statement', () => {
  // `grossFor` deciding to hold is one thing; the SETTLEMENT leaving the line
  // out is another, and only the second is what a driver is paid on. Watched
  // failing by letting the loop settle a held decision anyway.
  const base = inputFor(DATATRUCK_STATEMENTS[5]!)

  const amazonLoad = (outcome: 'short' | 'none'): SettleableLoad => ({
    id: 'held-1',
    loadNumber: 'AMZ-HELD',
    companyId: 'co-1',
    companyName: 'Held Co',
    puPlace: 'A',
    delPlace: 'B',
    puDate: new Date(base.period.start),
    delDate: new Date(base.period.end),
    rateCents: 200_000,
    milesHundredths: 10_000,
    direct: {
      outcome,
      remittedCents: outcome === 'short' ? 175_000 : null,
      confirmedCents: null,
    },
  })

  for (const outcome of ['short', 'none'] as const) {
    it(`leaves a ${outcome} load out of the lines and names it as held`, () => {
      const settlement = computeDriverSettlement({
        ...base,
        loads: [amazonLoad(outcome)],
      })
      expect(settlement.lines).toHaveLength(0)
      expect(settlement.earningsCents).toBe(0)
      expect(settlement.held).toHaveLength(1)
      expect(settlement.held[0]!.loadNumber).toBe('AMZ-HELD')
    })
  }

  it('settles it once the confirmed figure is on it', () => {
    const held = amazonLoad('short')
    const settlement = computeDriverSettlement({
      ...base,
      loads: [
        { ...held, direct: { ...held.direct!, confirmedCents: 175_000 } },
      ],
    })
    expect(settlement.held).toHaveLength(0)
    expect(settlement.lines).toHaveLength(1)
    // 30% OF THE CONFIRMED FIGURE, never of the booked $2,000.
    expect(settlement.lines[0]!.grossCents).toBe(175_000)
    expect(settlement.lines[0]!.amountCents).toBe(52_500)
  })
})

describe('the driver payout lag', () => {
  const checkDate = new Date(Date.UTC(2026, 7, 27))

  it('is the batch check date when the driver has no lag', () => {
    expect(payoutDateFor(checkDate, 0).toISOString().slice(0, 10)).toBe(
      '2026-08-27',
    )
  })

  // A WEEK, NOT A DAY, and the statement prints THIS as its Check Date rather
  // than the batch's. No driver carries a lag today — the company pays two
  // weeks behind uniformly and that lives in the typed check date (§0) — so
  // what this holds is the arithmetic, against the day one of them does.
  it('adds a whole week per stated lag', () => {
    expect(payoutDateFor(checkDate, 1).toISOString().slice(0, 10)).toBe(
      '2026-09-03',
    )
    expect(payoutDateFor(checkDate, 2).toISOString().slice(0, 10)).toBe(
      '2026-09-10',
    )
  })
})

describe('a driver with no pay rule', () => {
  const base = inputFor(DATATRUCK_STATEMENTS[0]!)

  // BLOCKS, NEVER SKIPS. A driver with settleable freight and no rule would
  // otherwise be paid nothing and appear on no list, which is the failure that
  // costs somebody a week's wages quietly.
  it('blocks the batch by name rather than being skipped', () => {
    const settlement = computeDriverSettlement({ ...base, payRules: [] })
    expect(settlement.lines).toHaveLength(0)
    expect(settlement.blockers.length).toBeGreaterThan(0)
    expect(settlement.blockers[0]!.kind).toBe('no_pay_rule')

    const batch = computeBatch({
      period: base.period,
      statementDate: base.checkDate,
      checkDate: base.checkDate,
      drivers: [{ ...base, payRules: [] }],
    })
    expect(batch.canFinalise).toBe(false)
    expect(batch.blockers[0]!.driverName).toBe(base.driverName)
  })

  it('lets a batch with only held lines finalise, because those are not wrong', () => {
    const batch = computeBatch({
      period: base.period,
      statementDate: base.checkDate,
      checkDate: base.checkDate,
      drivers: [base],
    })
    expect(batch.canFinalise).toBe(true)
  })
})

describe('an idle owner-operator still gets a statement', () => {
  // A recurring deduction accrues in a week with no loads. A settlement that
  // only existed when freight moved would silently stop collecting escrow.
  it('accrues recurring deductions with no loads at all', () => {
    const base = inputFor(DATATRUCK_STATEMENTS[5]!)
    const settlement = computeDriverSettlement({ ...base, loads: [] })
    expect(settlement.lines).toHaveLength(0)
    expect(settlement.earningsCents).toBe(0)
    expect(settlement.deductionLines.length).toBeGreaterThan(0)
    expect(settlement.netCents).toBeLessThan(0)
    // PRINTED AND FLAGGED, never clamped and never carried forward.
    expect(settlement.netIsNegative).toBe(true)
  })
})

describe('YTD, when there is no opening balance', () => {
  const base = inputFor(DATATRUCK_STATEMENTS[0]!)

  // ON PRODUCTION THIS IS THE LIVE CASE, not an edge: `DriverOpeningBalance`
  // held ZERO rows when this was built. A YTD label over a figure that counts
  // one week of Zebra's own settlements is a claim about a year that is not
  // true, so the statement says which period it counts from instead.
  it('says which period it counts from rather than claiming a year', () => {
    const settlement = computeDriverSettlement(base)
    expect(settlement.ytdFromPeriodStart).not.toBeNull()
    expect(settlement.ytdFromPeriodStart!.getTime()).toBe(
      base.period.start.getTime(),
    )
    // And with nothing prior, the YTD figure IS this week's figure.
    expect(settlement.ytd.netCents).toBe(settlement.netCents)
  })

  it('calls it YTD once an opening balance exists', () => {
    const settlement = computeDriverSettlement({
      ...base,
      openingBalances: { EARNINGS: 13_510_888, NET_PAY: 5_920_440 },
    })
    expect(settlement.ytdFromPeriodStart).toBeNull()
    expect(settlement.ytd.earningsCents).toBe(
      13_510_888 + settlement.earningsCents,
    )
  })
})

describe('the tariff label', () => {
  it('is built from the rule, never stored beside it', () => {
    expect(tariffLabel(percentRule(8800, Date.UTC(2026, 7, 9)))).toBe(
      '88% from gross',
    )
    expect(tariffLabel(percentRule(3000, Date.UTC(2026, 7, 9)))).toBe(
      '30% from gross',
    )
    expect(tariffLabel(percentRule(3250, Date.UTC(2026, 7, 9)))).toBe(
      '32.5% from gross',
    )
  })
})

// ---------------------------------------------------------------------------
// THE SEVENTH STATEMENT, CHECKED AS A TRANSCRIPTION RATHER THAN REPRODUCED.
//
// ST-005395 carries two rates — four lines at 30%, two at 20%, under a header
// reading 20% — and the split is not by date: three loads delivered 9/2 and
// one of them paid 30%. No rule keyed on the delivery date can produce it, so
// it is deliberately NOT in `DATATRUCK_STATEMENTS` and the engine is not asked
// to reproduce it until the owner says what those two lines are.
//
// What CAN be checked is the transcription, and it is worth checking: a figure
// mistyped here would become a false fact about somebody's wages the moment
// this fixture is wired into a reproduction.
// ---------------------------------------------------------------------------
describe('ST-005395 as transcribed', () => {
  const s = DATATRUCK_STATEMENT_ST005395

  it('has line amounts that sum to the printed Earnings total', () => {
    const sum = s.loads.reduce((n, l) => n + l.amountCents, 0)
    expect(sum).toBe(s.totals.amountCents)
    expect(sum).toBe(s.summary.earningsCents)
  })

  it('has grosses and mileages that sum to the printed totals', () => {
    expect(s.loads.reduce((n, l) => n + l.grossCents, 0)).toBe(
      s.totals.grossCents,
    )
    expect(s.loads.reduce((n, l) => n + l.milesHundredths, 0)).toBe(
      s.totals.milesHundredths,
    )
  })

  it('nets out exactly as printed', () => {
    const { earningsCents, deductionsCents, otherPayCents, netCents } =
      s.summary
    expect(earningsCents + deductionsCents + otherPayCents).toBe(netCents)
    expect(s.deductions.reduce((n, d) => n + d.totalCents, 0)).toBe(
      deductionsCents,
    )
  })

  // ── IT CONTINUES ST-005352, WHICH IS THE REAL CHECK ─────────────────
  //
  // A transcription can agree with itself and still be wrong. The year-to-date
  // figures are cumulative, so they tie this document to the one before it and
  // catch a digit that the internal sums would happily accept.
  it('continues the year-to-date of the statement before it', () => {
    const previous = DATATRUCK_STATEMENTS.find((f) => f.number === 'ST-005352')!
    expect(previous.ytd.earningsCents + s.summary.earningsCents).toBe(
      s.ytd.earningsCents,
    )
    expect(previous.ytd.netCents + s.summary.netCents).toBe(s.ytd.netCents)
    expect(previous.ytd.deductionsCents + s.summary.deductionsCents).toBe(
      s.ytd.deductionsCents,
    )
  })

  // ── THE FINDING ITSELF, ASSERTED SO IT CANNOT BE FORGOTTEN ──────────
  it('pays TWO different rates, and not by delivery date', () => {
    const rate = (n: string) =>
      s.loads.find((l) => l.loadNumber === n)!.percentBps

    expect(rate('113Y77KN3')).toBe(2000)
    expect(rate('T-114QYL1J1')).toBe(2000)
    expect(rate('111PP4X5W')).toBe(3000)

    // All three delivered on 9/2. A date-effective rule cannot pay them
    // differently, which is why this statement is not yet reproduced.
    const sept2 = Date.UTC(2026, 8, 2)
    for (const n of ['113Y77KN3', 'T-114QYL1J1', '111PP4X5W']) {
      expect(s.loads.find((l) => l.loadNumber === n)!.delDate).toBe(sept2)
    }

    // And every line's amount is its own rate applied to its own gross.
    for (const load of s.loads) {
      expect(
        Math.round((load.grossCents * load.percentBps!) / 10_000),
        `${load.loadNumber} does not pay its stated rate`,
      ).toBe(load.amountCents)
    }
  })
})
