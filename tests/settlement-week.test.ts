import { describe, expect, it } from 'vitest'
import { settleableForBatch } from '@/lib/settlement-batch'
import { settleableInPeriod, settleableWhere } from '@/lib/settlements'
import {
  CHECK_DATE_LAG_DAYS,
  checkDateFor,
  computeBatch,
  computeDriverSettlement,
  grossFor,
  isSettlementWeek,
  payoutDateFor,
  payOnSettledGross,
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
    // NULL, BECAUSE THE SIX STATEMENTS ARE THE TRUTH SET AND THEY PRINT THE
    // LOAD NUMBER. Migration 61 froze the broker reference onto the line, and
    // feeding one in here would make these fixtures stop reproducing the paper
    // they are graded against.
    referenceNumber: null,
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
    referralWith: [],
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

// ── THE FUEL AND TOLL LINES REACH NET (migration 61, §6.2.3) ──────────────
//
// THIS IS THE ONE GUARD ON THAT WIRING THAT IS ABOUT MONEY RATHER THAN SHAPE.
// `fuel-charge.ts` prices the lines and has its own suite; what nothing else
// watches is that they arrive BEFORE the sign split. A line appended after it
// would print on the statement and be absent from `deductionsCents`, so the
// Deductions total and the net would both be short by the fuel charge — and
// every figure on the page would still look internally consistent, which is why
// this failure would survive a reading.
describe('a priced charge line lands in the totals, not only on the page', () => {
  const base = inputFor(DATATRUCK_STATEMENTS[0]!)
  const plain = computeDriverSettlement(base)

  const withFuel = computeDriverSettlement({
    ...base,
    extraDeductionLines: [
      {
        ruleId: null,
        type: 'Fuel',
        description: 'Fuel 08/09/2026 to 08/15/2026 — card invoice',
        quantity: 2,
        rateCents: 28443,
        totalCents: -28443,
      },
    ],
  })

  it('shows on the statement', () => {
    expect(withFuel.deductionLines.map((line) => line.type)).toContain('Fuel')
  })

  it('and is counted in Deductions', () => {
    expect(withFuel.deductionsCents).toBe(plain.deductionsCents - 28443)
  })

  it('and therefore in net pay', () => {
    expect(withFuel.netCents).toBe(plain.netCents - 28443)
  })

  // A POSITIVE EXTRA LINE IS OTHER PAY, through the same split. Nothing here
  // decides which is which — a charge and a credit are one object pointing two
  // ways, and the sign is the only thing that says so.
  it('and a positive one lands in other pay instead', () => {
    const credit = computeDriverSettlement({
      ...base,
      extraDeductionLines: [
        {
          ruleId: null,
          type: 'Fuel',
          description: 'fuel credit, card double-posted',
          quantity: 1,
          rateCents: 5000,
          totalCents: 5000,
        },
      ],
    })
    expect(credit.deductionsCents).toBe(plain.deductionsCents)
    expect(credit.netCents).toBe(plain.netCents + 5000)
  })
})

// THE FROZEN REFERENCE (migration 61). The line carries what the load said when
// the statement was built, so a reference corrected next year cannot change it.
describe('the broker reference is frozen onto the line', () => {
  it('carries through from the load to the line', () => {
    const base = inputFor(DATATRUCK_STATEMENTS[0]!)
    const settlement = computeDriverSettlement({
      ...base,
      loads: base.loads.map((load) => ({
        ...load,
        referenceNumber: '116RX75DK',
      })),
    })
    expect(settlement.lines[0]?.referenceNumber).toBe('116RX75DK')
  })

  it('and null stays null rather than becoming the load number', () => {
    // A LINE CLAIMING A REFERENCE IT DOES NOT HAVE would print Zebra's own id
    // in the column the driver checks against his paperwork, with nothing to
    // say it was a substitution. The fallback belongs at the RENDER, where the
    // reader can be told; freezing it here would make the substitution
    // permanent.
    const settlement = computeDriverSettlement(
      inputFor(DATATRUCK_STATEMENTS[0]!),
    )
    expect(settlement.lines[0]?.referenceNumber).toBeNull()
  })
})

// THE FUEL POLICY, FROZEN (§6.2.3). Null where nothing was deducted, because
// writing `RETAIL` on a statement that charged no fuel claims a decision nobody
// made.
describe('the fuel mode is frozen on the settlement', () => {
  const base = inputFor(DATATRUCK_STATEMENTS[0]!)

  it('carries the mode it was built under', () => {
    expect(
      computeDriverSettlement({ ...base, fuelMode: 'INVOICE' }).fuelMode,
    ).toBe('INVOICE')
  })

  it('and is null when none was supplied', () => {
    expect(computeDriverSettlement(base).fuelMode).toBeNull()
  })
})

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
// FIVE of them are. Rounding the whole gross at once gives a DIFFERENT cent
// from summing the rounded lines, and in every case the statement prints the
// per-line answer:
//
//   ST-005310   $9,210.76 x 88%  -> on-total $8,105.47   printed $8,105.46
//   ST-005317  $10,839.15 x 30%  -> on-total $3,251.75   printed $3,251.74
//   ST-005336   $9,490.80 x 32%  -> on-total $3,037.06   printed $3,037.05
//   ST-005352   $5,556.01 x 30%  -> on-total $1,666.80   printed $1,666.81
//   ST-005533  $21,752.85 x 38%  -> on-total $8,266.08   printed $8,266.09
//
// THE FIFTH ARRIVED ON 2026-09-26 with the statement for the first week Zebra
// drafted, and it is the useful kind of corroboration: a rate nothing else in
// the corpus uses (38%), a gross twice the size of any other, and the same
// answer. A characterisation test that had been trimmed to keep its old list
// would have thrown that away.
//
// A cent a week per driver is not the point; being unable to say which rule
// the software follows is. This is the assertion that says it.
// ---------------------------------------------------------------------------

describe('rounding happens per line and not once on the total', () => {
  const onTotal = (fixture: StatementFixture) =>
    __rounding.percentOfCents(fixture.totals.grossCents, fixture.percentBps)

  it('disagrees with the on-total answer on five of the seven', () => {
    const differing = DATATRUCK_STATEMENTS.filter(
      (fixture) => onTotal(fixture) !== fixture.totals.amountCents,
    ).map((fixture) => fixture.number)
    expect(differing).toEqual([
      'ST-005310',
      'ST-005317',
      'ST-005336',
      'ST-005352',
      'ST-005533',
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

// ---------------------------------------------------------------------------
// THE CHECK DATE IS DERIVED. Owner's ruling, 2026-09-28.
//
// MONEY-DESIGN §0 made it a typed input because Datatruck's PRINTED Check Date
// is early by seven or eight days on all six statements. The same table says
// `period end + 13` lands on a Friday every time, and that is the half worth
// trusting: the DOCUMENT is unreliable, the CADENCE is not.
//
// AND THE TYPED FIELD IS WHAT WENT WRONG. Batch cmuga82ji0000qkvslwyibodv
// covers Sep 13-19 and holds a check date of 2026-09-25 — period end + 6, the
// shape of the printed lag §0 forbids copying, one week after §0 was written.
// ---------------------------------------------------------------------------

describe('checkDateFor', () => {
  const on = (day: string) => new Date(`${day}T00:00:00.000Z`)
  const derived = (start: string) =>
    checkDateFor(weekOf(on(start)))
      .toISOString()
      .slice(0, 10)

  // ── THE MONEY THAT ACTUALLY MOVED, FROM §0's TABLE ──────────────────────
  //
  // Not the printed Check Dates. These are the "money actually moved" column,
  // which is what this function is for — read off the artefact rather than
  // computed and then admired.
  it.each([
    ['2026-08-09', '2026-08-28'], // ST-005284, printed 8/21
    ['2026-08-16', '2026-09-04'], // ST-005301/005310/005317, printed Thu 8/27
    ['2026-08-23', '2026-09-11'], // ST-005336/005352, printed 9/4
  ])('week of %s was paid %s', (start, moved) => {
    expect(derived(start)).toBe(moved)
  })

  // ── THE BATCH THIS RULING IS ABOUT ──────────────────────────────────────
  it('gives Sep 13-19 a check date of 2026-10-02, not 2026-09-25', () => {
    expect(derived('2026-09-13')).toBe('2026-10-02')
    expect(derived('2026-09-13')).not.toBe('2026-09-25')
  })

  // The wrong value's shape, named so nobody reintroduces it as a default:
  // period end + 6 is what Datatruck PRINTS and what was keyed.
  it('is not period end + 6, which is what Datatruck prints', () => {
    const period = weekOf(on('2026-09-13'))
    expect(checkDateFor(period).getTime() - period.end.getTime()).toBe(
      13 * 86_400_000,
    )
    expect(checkDateFor(period).getTime() - period.end.getTime()).not.toBe(
      6 * 86_400_000,
    )
  })

  it('gives the following week 2026-10-09', () => {
    expect(derived('2026-09-20')).toBe('2026-10-09')
  })

  it('is always a Friday, for every week of a year', () => {
    for (let week = 0; week < 60; week++) {
      const period = weekOf(
        new Date(Date.UTC(2026, 0, 4) + week * 7 * 86_400_000),
      )
      const check = checkDateFor(period)
      expect(isSettlementWeek(period)).toBe(true)
      expect(check.getUTCDay(), period.end.toISOString()).toBe(5)
      expect(check.getTime() - period.end.getTime()).toBe(13 * 86_400_000)
    }
  })

  // ONE DEFINITION, and this is the assertion that keeps it one. `payWeekFor`
  // used to spell `+ 13 * DAY` itself; two copies of a cadence is how the
  // screen and the create come to disagree about a date.
  it('is the same function payWeekFor offers', () => {
    const { period, payDay } = payWeekFor(on('2026-09-15'))
    expect(payDay.getTime()).toBe(checkDateFor(period).getTime())
  })

  it('states the lag once', () => {
    expect(CHECK_DATE_LAG_DAYS).toBe(13)
  })
})

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
    referenceNumber: null,
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
    referenceNumber: null,
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
  // ── IT SURVIVES A WEEK WHERE NOTHING IS PAID ─────────────────────────
  //
  // Owner's ruling, 2026-09-26. The label was only set after a line was
  // successfully PAID, so a driver whose whole week is held got a statement with
  // no tariff on it at all.
  //
  // MEASURED: ST-005533's driver has eight lines and every one is held for
  // `no_remittance`. The diff against Datatruck read
  // `statement "38% from gross"  draft null` — the rule was there the whole time
  // and nothing had asked it.
  const heldWeek = (payRules: PayRule[]) => {
    const base = inputFor(DATATRUCK_STATEMENTS[5]!)
    const load: SettleableLoad = {
      id: 'held-tariff',
      loadNumber: 'AMZ-HELD',
      referenceNumber: null,
      companyId: 'co-1',
      companyName: 'Held Co',
      puPlace: 'A',
      delPlace: 'B',
      puDate: new Date(base.period.start),
      delDate: new Date(base.period.end),
      rateCents: 200_000,
      milesHundredths: 10_000,
      // Direct freight with no remittance: the engine holds the line.
      direct: { outcome: 'none', remittedCents: null, confirmedCents: null },
    }
    return computeDriverSettlement({ ...base, loads: [load], payRules })
  }

  it('is set from the frozen rule even when EVERY line is held', () => {
    const settlement = heldWeek([
      percentRule(3800, DATATRUCK_STATEMENTS[5]!.periodStart),
    ])
    expect(settlement.lines).toHaveLength(0)
    expect(settlement.held).toHaveLength(1)
    // THE POINT. Nothing was paid and the tariff is still on the statement.
    expect(settlement.payTariffLabel).toBe('38% from gross')
  })

  it('blocks nobody for a held line with no rule in force', () => {
    // The `no_pay_rule` blocker is deliberately NOT raised on the held path: a
    // held line is not being paid either way, and blocking on it would stop a
    // driver whose only problem is that Amazon has not sent the money yet.
    const settlement = heldWeek([])
    expect(settlement.held).toHaveLength(1)
    expect(settlement.blockers).toHaveLength(0)
    expect(settlement.payTariffLabel).toBeNull()
  })

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

// ---------------------------------------------------------------------------
// ONE PREDICATE. Owner's ruling, 2026-09-27.
//
// `settleableForBatch` = `settleableWhere`. The batch used to ask for a delivery
// stop dated in the week and nothing about the POD; `settleableWhere` had always
// wanted POD_RECEIVED plus an APPLIED POD event inside the period, and said so
// in its own docstring. Two definitions of one concept, and the looser one wrote
// the cheques: two DISPATCHED loads took lines on the 8/30 dev replay for
// $1,316.92 of driver pay.
//
// THESE ASSERT THE SHARED CORE IS ACTUALLY SHARED, not that two functions happen
// to agree today. A test that compared their outputs field by field would pass
// just as well with the conditions copied into both.
// ---------------------------------------------------------------------------

describe('a percent-of-linehaul rule prices on the SETTLED gross', () => {
  const rule = {
    id: 'rule-linehaul',
    type: 'PERCENT_LINEHAUL' as const,
    percentBps: 8800,
    perMileCents: null,
    flatCents: null,
    effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
    effectiveTo: null,
  }

  // ── THE TONU THAT PRODUCED THE RULING ───────────────────────────────────
  //
  // `111ZR9GMP` is a cancelled Amazon load: its rate column is $0 and its whole
  // $175.00 sits in an accessorial. ST-005284 pays Hirsi $154.00 for it, 88% of
  // $175.00, and Zebra's settlement agrees to the cent.
  //
  // IT AGREES BECAUSE THE ENGINE SUBSTITUTES. `payFor` reads `linehaulCents` for
  // a PERCENT_LINEHAUL rule, so pointing it at the raw load would take 88% of $0
  // and pay nothing. `payOnSettledGross` puts the decided gross into BOTH money
  // fields, which is why the basis is right whichever percent rule is in force.
  //
  // WITHOUT THIS TEST THE SUBSTITUTION WAS UNGUARDED: breaking `linehaulCents`
  // inside it failed nothing, because every other engine fixture runs a
  // PERCENT_GROSS rule and reads the other field. Observed with `watch-guard`.
  it('pays 88% of $175.00 on a load whose rate column is empty', () => {
    const result = payOnSettledGross(
      { id: 'l-tonu', loadNumber: 'DT-015313', milesHundredths: 11_700 },
      17_500,
      rule,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.amountCents).toBe(15_400)
    // AND THE SNAPSHOT RECORDS THE SUBSTITUTED FIGURE, so a driver can check the
    // line against the remittance by hand.
    expect(result.snapshot.basis).toBe(17_500)
  })

  // The same figure whichever percent rule is in force, which is the point of
  // substituting into both fields rather than choosing a field.
  it('pays the same on a percent-of-gross rule', () => {
    const asGross = payOnSettledGross(
      { id: 'l-tonu', loadNumber: 'DT-015313', milesHundredths: 11_700 },
      17_500,
      { ...rule, type: 'PERCENT_GROSS' as const },
    )
    expect(asGross.ok && asGross.amountCents).toBe(15_400)
  })

  // A PER_MILE RULE TAKES THE STATEMENT'S MILES, not a dispatched figure: a
  // settlement pays the miles it counts, and falling back to a plan would pay
  // one.
  it('takes the statement miles for a per-mile rule', () => {
    const perMile = payOnSettledGross(
      { id: 'l-mile', loadNumber: 'DT-000001', milesHundredths: 40_000 },
      0,
      {
        id: 'rule-mile',
        type: 'PER_MILE' as const,
        percentBps: null,
        perMileCents: 65,
        flatCents: null,
        effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
        effectiveTo: null,
      },
    )
    expect(perMile.ok && perMile.amountCents).toBe(26_000)
  })
})

describe('the tariff label, which both percent rules spell the same way', () => {
  const at = new Date(Date.UTC(2026, 7, 1))

  // ── OWNER'S RULING, 2026-09-27 ──────────────────────────────────────────
  //
  // Every Datatruck statement in the corpus prints "from gross", including the
  // ones whose rule Zebra holds as PERCENT_LINEHAUL — ST-005377 reads
  // "89% from gross" against a 8900bps PERCENT_LINEHAUL row. The label used to
  // say "from linehaul", so the 8/30 replay reported a difference on every
  // driver that was about vocabulary and buried the ones about money.
  //
  // THIS TEST EXISTS BECAUSE THE CHANGE WAS UNGUARDED. Breaking the branch under
  // `watch-guard` failed NOTHING — the only tariff assertions ran over
  // PERCENT_GROSS fixtures, so the linehaul branch could have said anything.
  it('prints a percent-of-linehaul rule as "from gross"', () => {
    expect(
      tariffLabel({
        id: 'rule_1',
        type: 'PERCENT_LINEHAUL',
        percentBps: 8900,
        perMileCents: null,
        flatCents: null,
        effectiveFrom: at,
        effectiveTo: null,
      }),
    ).toBe('89% from gross')
  })

  it('prints a percent-of-gross rule the same way', () => {
    expect(
      tariffLabel({
        id: 'rule_1',
        type: 'PERCENT_GROSS',
        percentBps: 3000,
        perMileCents: null,
        flatCents: null,
        effectiveFrom: at,
        effectiveTo: null,
      }),
    ).toBe('30% from gross')
  })

  // THE BASIS IS UNCHANGED, and that is the half worth pinning: the label is
  // what the statement prints, not what the arithmetic does.
  it('does not print a basis for the rules that have no percentage', () => {
    expect(
      tariffLabel({
        id: 'rule_1',
        type: 'PER_MILE',
        percentBps: null,
        perMileCents: 65,
        flatCents: null,
        effectiveFrom: at,
        effectiveTo: null,
      }),
    ).toBe('$0.65 per mile')
  })
})

describe('the batch and the driver ask one question', () => {
  const period = {
    start: new Date(Date.UTC(2026, 7, 30)),
    end: new Date(Date.UTC(2026, 8, 5)),
  }

  it('both carry the period core, verbatim', () => {
    const core = settleableInPeriod(
      period.start,
      new Date(period.end.getTime() + 86_399_999),
    )
    const batch = settleableForBatch(null, period)
    const driver = settleableWhere(
      'drv_1',
      period.start,
      new Date(period.end.getTime() + 86_399_999),
    )

    for (const key of Object.keys(core) as (keyof typeof core)[]) {
      expect(batch[key], `batch is missing ${key}`).toEqual(core[key])
      expect(driver[key], `settleableWhere is missing ${key}`).toEqual(
        core[key],
      )
    }
  })

  // ── THE THREE THE BATCH USED TO LEAVE OUT ────────────────────────────────
  it('REQUIRES the POD status on the batch side', () => {
    expect(settleableForBatch(null, period).operationalStatus).toBe(
      'POD_RECEIVED',
    )
  })

  it('REQUIRES an APPLIED POD event on the batch side', () => {
    const events = settleableForBatch(null, period).statusEvents
    expect(events).toMatchObject({
      some: {
        axis: 'OPERATIONAL',
        toStatus: 'POD_RECEIVED',
        outcome: 'APPLIED',
      },
    })
  })

  it('DATES that event inside the period, to the last millisecond', () => {
    const events = settleableForBatch(null, period).statusEvents as {
      some: { occurredAt: { gte: Date; lte: Date } }
    }
    expect(events.some.occurredAt.gte.getTime()).toBe(period.start.getTime())
    // The Saturday, whole. A period ending at midnight loses everything that
    // landed on its last day — four loads, on the 9/13 week.
    expect(events.some.occurredAt.lte.getTime()).toBe(
      period.end.getTime() + 86_399_999,
    )
  })

  // ── AND THE STOP FILTER IS GONE, WHICH IS THE SUBSTANTIVE HALF ───────────
  //
  // Kept as an explicit assertion rather than left implied: a delivery stop
  // dated in the week is a PLAN, and a load that never arrived has one.
  it('no longer selects on the delivery stop', () => {
    expect(settleableForBatch(null, period).stops).toBeUndefined()
  })

  // Each side keeps exactly the scoping that is its own business.
  it('keeps the batch org-wide and the driver query per driver', () => {
    expect(settleableForBatch(null, period).driverId).toEqual({ not: null })
    expect(settleableWhere('drv_1', period.start, period.end).OR).toEqual([
      { driverId: 'drv_1' },
      { coDriverId: 'drv_1' },
    ])
  })
})
