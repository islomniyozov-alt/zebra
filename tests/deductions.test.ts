import { describe, expect, it } from 'vitest'
import {
  activeDaysInMonth,
  computeDeductions,
  inForce,
  type DeductionPeriod,
  type OneOffCharge,
  type RecurringRule,
} from '@/lib/deductions'
import {
  KNOWN_DEDUCTION_TYPES,
  isKnownDeductionType,
} from '@/lib/deduction-types'

// ---------------------------------------------------------------------------
// THE DEDUCTION ENGINE, GRADED AGAINST SIX REAL STATEMENTS.
//
// The acceptance the owner set: every description those statements print must
// be reproducible by the function FROM A STORED RULE. Not hard-coded in the
// engine, not approximated, not "close enough" — the same characters, spacing
// included.
//
// Each expectation below is transcribed from `corpus/datatruck`. The statement
// it came from is named beside it, so a disagreement is checkable against
// paper rather than against somebody's memory of paper.
// ---------------------------------------------------------------------------

const WEEK = (from: string, to: string): DeductionPeriod => ({
  start: new Date(`${from}T00:00:00.000Z`),
  end: new Date(`${to}T23:59:59.999Z`),
})

/** Aug 9–15 2026, the period ST-005284 covers. */
const AUG_9 = WEEK('2026-08-09', '2026-08-15')
/** Aug 16–22 2026, ST-005310 and ST-005317. */
const AUG_16 = WEEK('2026-08-16', '2026-08-22')
/** Aug 23–29 2026, ST-005352. */
const AUG_23 = WEEK('2026-08-23', '2026-08-29')

const rule = (over: Partial<RecurringRule>): RecurringRule => ({
  id: 'r1',
  type: 'Ifta',
  description: null,
  amountCents: 5000,
  cadence: 'WEEKLY',
  monthlyTotalCents: null,
  targetCents: null,
  effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
  effectiveTo: null,
  ...over,
})

const run = (
  rules: RecurringRule[],
  period: DeductionPeriod,
  extra: Partial<Parameters<typeof computeDeductions>[0]> = {},
) =>
  computeDeductions({
    period,
    rules,
    charges: [],
    escrowHeldCents: 0,
    ...extra,
  })

describe('every description the six statements print', () => {
  // ST-005284, Hassan Ali Hirsi, Aug 9–15.
  it('reproduces the Fuel line', () => {
    const result = run(
      [
        rule({
          type: 'Fuel',
          description: 'Auto calculated Fuel cost',
          amountCents: 0,
        }),
      ],
      AUG_9,
      { fuelCents: 263421 },
    )
    expect(result.lines[0]).toMatchObject({
      type: 'Fuel',
      description: 'Auto calculated Fuel cost',
      rateCents: 263421,
      totalCents: -263421,
    })
  })

  // ST-005284. One stored rule, and `{month}` and `{split}` do the rest.
  it('reproduces the full-month Insurance line', () => {
    const result = run(
      [
        rule({
          type: 'Insurance',
          description: 'Insurance (GL, AL, Cargo, TI) for {month} {split}',
          amountCents: 45000,
          cadence: 'MONTHLY_SPLIT_WEEKLY',
          monthlyTotalCents: 180000,
        }),
      ],
      AUG_9,
    )
    expect(result.lines[0]?.description).toBe(
      'Insurance (GL, AL, Cargo, TI) for August $1800/$450',
    )
    expect(result.lines[0]?.totalCents).toBe(-45000)
  })

  // ST-005310, the SAME rule one week later, closing mid-month.
  //
  // $1800 x 24/31 = $1393.55 entitled, less 3 x $450 already taken = $43.55.
  // The arithmetic and the string both have to come out, and `24days` has no
  // space in it on the page.
  it('reproduces the prorated Insurance line, to the cent', () => {
    const insurance = rule({
      type: 'Insurance',
      description: 'Insurance (GL, AL, Cargo, TI) for {month} {split}',
      amountCents: 45000,
      cadence: 'MONTHLY_SPLIT_WEEKLY',
      monthlyTotalCents: 180000,
      effectiveTo: new Date('2026-08-24T00:00:00.000Z'),
    })
    const result = run([insurance], AUG_16, {
      collectedThisMonthCents: { r1: 135000 },
    })
    expect(result.lines[0]?.description).toBe(
      'Insurance (GL, AL, Cargo, TI) for August 24days',
    )
    expect(result.lines[0]?.rateCents).toBe(4355)
    expect(result.lines[0]?.totalCents).toBe(-4355)
  })

  // ST-005284 and ST-005310 both print these with the Description column EMPTY.
  // A blank there is a fact about the charge, not a value nobody filled in.
  it('reproduces Ifta and Admin Fee with no description at all', () => {
    const result = run(
      [
        rule({
          id: 'ifta',
          type: 'Ifta',
          description: null,
          amountCents: 5000,
        }),
        rule({
          id: 'admin',
          type: 'Admin Fee',
          description: null,
          amountCents: 5000,
        }),
      ],
      AUG_9,
    )
    expect(result.lines.map((line) => line.description)).toEqual(['', ''])
    expect(result.totalCents).toBe(-10000)
  })

  // ST-005310.
  it('reproduces the Tolls line with its date range', () => {
    const result = run(
      [
        rule({
          type: 'Tolls',
          description: 'TollPrePass {from} to {to}',
          amountCents: 15721,
        }),
      ],
      AUG_16,
    )
    expect(result.lines[0]?.description).toBe(
      'TollPrePass 08/01/2026 to 08/31/2026',
    )
    expect(result.lines[0]?.totalCents).toBe(-15721)
  })

  // ST-005317 — a one-off, not a rule.
  it('reproduces the late-delivery charge', () => {
    const charge: OneOffCharge = {
      id: 'c1',
      type: 'Other',
      description: 'Charge for late Del Load#111VS62GS',
      amountCents: -25000,
      appliesOn: new Date('2026-08-18T00:00:00.000Z'),
    }
    const result = computeDeductions({
      period: AUG_16,
      rules: [],
      charges: [charge],
      escrowHeldCents: 0,
    })
    expect(result.lines[0]).toMatchObject({
      type: 'Other',
      description: 'Charge for late Del Load#111VS62GS',
      rateCents: 25000,
      totalCents: -25000,
    })
  })

  // ── ESCROW: TWO STATEMENTS, TWO STRINGS, ONE RULE ────────────────────
  //
  // ST-005317 prints `$2500/$500` and ST-005352 prints `$2500/$250`, one week
  // apart, same driver, $250.00 both times. Decreasing, so the second figure
  // is what REMAINS against the target rather than what has accumulated.
  const escrow = rule({
    id: 'esc',
    type: 'Escrow',
    description: 'Security Deposit {split}',
    amountCents: 25000,
    targetCents: 250000,
  })

  it('reproduces the escrow line at $500 remaining', () => {
    const result = run([escrow], AUG_16, { escrowHeldCents: 200000 })
    expect(result.lines[0]?.description).toBe('Security Deposit $2500/$500')
    expect(result.lines[0]?.totalCents).toBe(-25000)
    expect(result.escrowHeldCents).toBe(225000)
  })

  it('reproduces the escrow line at $250 remaining, and stops there', () => {
    const result = run([escrow], AUG_23, { escrowHeldCents: 225000 })
    expect(result.lines[0]?.description).toBe('Security Deposit $2500/$250')
    expect(result.lines[0]?.totalCents).toBe(-25000)
    expect(result.escrowHeldCents).toBe(250000)
    // SAYS SO. A line that vanished silently is indistinguishable from a rule
    // somebody deleted — the thing Datatruck does not do.
    expect(result.lines[0]?.note).toContain('reached')
  })
})

describe('escrow stops itself, watched from both sides', () => {
  const escrow = rule({
    id: 'esc',
    type: 'Escrow',
    description: 'Security Deposit {split}',
    amountCents: 25000,
    targetCents: 250000,
  })

  it('writes no line once the target is held', () => {
    const result = run([escrow], AUG_23, { escrowHeldCents: 250000 })
    expect(result.lines).toHaveLength(0)
    expect(result.omitSection).toBe(true)
    expect(result.escrowHeldCents).toBe(250000)
  })

  // THE OTHER SIDE. Without this the assertion above would pass against an
  // engine that never emitted an escrow line at all.
  it('writes one while the target is not yet held', () => {
    const result = run([escrow], AUG_23, { escrowHeldCents: 100000 })
    expect(result.lines).toHaveLength(1)
    expect(result.omitSection).toBe(false)
  })

  // NEVER OVERSHOOTS. $100 left and a $250 instalment takes $100, not $250 —
  // the failure that would have a driver paying $2,650 into a $2,500 escrow.
  it('takes only what is left when the instalment would overshoot', () => {
    const result = run([escrow], AUG_23, { escrowHeldCents: 240000 })
    expect(result.lines[0]?.totalCents).toBe(-10000)
    expect(result.escrowHeldCents).toBe(250000)
    expect(result.lines[0]?.description).toBe('Security Deposit $2500/$100')
  })
})

describe('fuel prints a line only when there are transactions', () => {
  const fuel = rule({
    type: 'Fuel',
    description: 'Auto calculated Fuel cost',
    amountCents: 0,
  })

  it('prints nothing when the import has not run', () => {
    expect(run([fuel], AUG_9).lines).toHaveLength(0)
  })

  // A ZERO LINE WOULD CLAIM SOMEBODY LOOKED. Absence and zero are different
  // statements and only one of them is true here.
  it('prints nothing when the week had no fuel, rather than a zero line', () => {
    expect(run([fuel], AUG_9, { fuelCents: 0 }).lines).toHaveLength(0)
  })

  it('prints one when there is a figure', () => {
    expect(run([fuel], AUG_9, { fuelCents: 175040 }).lines).toHaveLength(1)
  })
})

describe('an empty section is omitted, never printed at zero', () => {
  // The rule carried in from the two Dolphins statements, which have no
  // Deductions block at all rather than a block of zeros.
  it('says to omit when nothing applies', () => {
    const result = run([], AUG_9)
    expect(result.lines).toHaveLength(0)
    expect(result.omitSection).toBe(true)
    expect(result.totalCents).toBe(0)
  })

  it('says not to omit the moment one line applies', () => {
    const result = run([rule({ type: 'Ifta', amountCents: 5000 })], AUG_9)
    expect(result.omitSection).toBe(false)
  })
})

describe('effective dates', () => {
  it('skips a rule that has not started', () => {
    const later = rule({
      effectiveFrom: new Date('2026-09-01T00:00:00.000Z'),
    })
    expect(inForce(later, AUG_9)).toBe(false)
    expect(run([later], AUG_9).lines).toHaveLength(0)
  })

  it('skips a rule that has ended', () => {
    const ended = rule({ effectiveTo: new Date('2026-07-31T00:00:00.000Z') })
    expect(inForce(ended, AUG_9)).toBe(false)
    expect(run([ended], AUG_9).lines).toHaveLength(0)
  })

  it('counts the active days of a partial month', () => {
    const ending = rule({ effectiveTo: new Date('2026-08-24T00:00:00.000Z') })
    expect(activeDaysInMonth(ending, AUG_16.start)).toBe(24)
    const starting = rule({
      effectiveFrom: new Date('2026-08-08T00:00:00.000Z'),
    })
    expect(activeDaysInMonth(starting, AUG_16.start)).toBe(24)
  })
})

describe('one-offs are the same object with opposite signs', () => {
  const truckWash: OneOffCharge = {
    id: 'c2',
    type: 'Other',
    description: 'Truck wash reimbursement',
    amountCents: 4500,
    appliesOn: new Date('2026-08-18T00:00:00.000Z'),
  }

  it('carries a reimbursement through as a positive', () => {
    const result = computeDeductions({
      period: AUG_16,
      rules: [],
      charges: [truckWash],
      escrowHeldCents: 0,
    })
    expect(result.lines[0]?.totalCents).toBe(4500)
    expect(result.totalCents).toBe(4500)
  })

  it('leaves a charge outside the period alone', () => {
    const result = computeDeductions({
      period: AUG_9,
      rules: [],
      charges: [truckWash],
      escrowHeldCents: 0,
    })
    expect(result.lines).toHaveLength(0)
  })
})

describe('the type list is a list, not a gate', () => {
  it('holds exactly what the statements printed', () => {
    expect([...KNOWN_DEDUCTION_TYPES]).toEqual([
      'Fuel',
      'Insurance',
      'Ifta',
      'Admin Fee',
      'Tolls',
      'Other',
      'Escrow',
    ])
  })

  // NEVER USED TO REFUSE. A label nobody has seen is flagged, not rejected —
  // which is the whole of the "no deduction type enum" ruling.
  it('flags an unknown label without the engine refusing it', () => {
    expect(isKnownDeductionType('Trailer Rent')).toBe(false)
    const result = run(
      [rule({ type: 'Trailer Rent', amountCents: 12500 })],
      AUG_9,
    )
    expect(result.lines[0]?.type).toBe('Trailer Rent')
    expect(result.lines[0]?.totalCents).toBe(-12500)
  })
})

// ---------------------------------------------------------------------------
// A TARGET STOPS ANY RULE, NOT ONLY ESCROW. Owner's ruling, 2026-09-29.
//
// The branch was `rule.type === 'Escrow'`, so a $4,000 cap on an insurance rule
// was stored, printed and IGNORED — the engine charged past it forever. Julia
// Rose Hall's insurance is exactly that shape, which is why the ruling exists.
// ---------------------------------------------------------------------------

describe('a target on a rule that is not escrow', () => {
  const insurance = {
    id: 'ins-1',
    driverId: 'd1',
    type: 'Insurance',
    description: 'Insurance',
    amountCents: 125_000,
    cadence: 'WEEKLY' as const,
    monthlyTotalCents: null,
    targetCents: 400_000,
    effectiveFrom: new Date(Date.UTC(2026, 8, 4)),
    effectiveTo: null,
  }
  const period = {
    start: new Date(Date.UTC(2026, 8, 13)),
    end: new Date(Date.UTC(2026, 8, 19)),
  }

  const run = (collected: number) =>
    computeDeductions({
      period,
      rules: [insurance],
      charges: [],
      escrowHeldCents: 0,
      collectedToDateCents: { 'ins-1': collected },
    })

  it('takes the full instalment while the cap is far away', () => {
    const line = run(0).lines[0]
    expect(line?.totalCents).toBe(-125_000)
    // §7.1 of the ruling: the statement prints target and remaining.
    // `$4000/$4000`, not `$4,000.00` — `dollars()` prints the form the real
    // statements use, which MONEY-DESIGN §5 records as `$1800/$450`.
    expect(line?.description).toContain('$4000/$4000')
  })

  it('counts what has already been taken', () => {
    const line = run(250_000).lines[0]
    expect(line?.totalCents).toBe(-125_000)
    expect(line?.description).toContain('$4000/$1500')
  })

  // THE LAST INSTALMENT IS THE REMAINDER. $1,250 weekly against $4,000 takes
  // 1,250 three times and 250 once — a fourth full instalment would collect
  // $5,000 against a $4,000 cap, which is the failure this prevents.
  it('takes only what is left, and says the target is reached', () => {
    const line = run(375_000).lines[0]
    expect(line?.totalCents).toBe(-25_000)
    expect(line?.note).toContain('Insurance target $4000 reached')
  })

  it('writes no line at all once the target is met', () => {
    // NOT A ZERO LINE. A zero claims somebody was charged nothing this week;
    // an absent line claims nothing, which is §4's rule.
    expect(run(400_000).lines).toHaveLength(0)
    expect(run(450_000).lines).toHaveLength(0)
  })

  it('still charges forever where there is no target', () => {
    const uncapped = { ...insurance, targetCents: null }
    const result = computeDeductions({
      period,
      rules: [uncapped],
      charges: [],
      escrowHeldCents: 0,
      collectedToDateCents: { 'ins-1': 9_999_999 },
    })
    expect(result.lines[0]?.totalCents).toBe(-125_000)
    // And no target means no split appended: there is nothing to report.
    expect(result.lines[0]?.description).toBe('Insurance')
  })

  // ESCROW KEEPS ITS LEDGER. It is refundable and the balance is a fact people
  // ask about directly, so it counts `escrowHeldCents` rather than its lines —
  // and a stray `collectedToDateCents` entry must not move it.
  it('escrow still counts its ledger, not its lines', () => {
    const escrow = {
      ...insurance,
      id: 'esc-1',
      type: 'Escrow',
      description: 'Security Deposit {split}',
      amountCents: 25_000,
      targetCents: 250_000,
    }
    const result = computeDeductions({
      period,
      rules: [escrow],
      charges: [],
      escrowHeldCents: 240_000,
      collectedToDateCents: { 'esc-1': 0 },
    })
    expect(result.lines[0]?.totalCents).toBe(-10_000)
    expect(result.lines[0]?.description).toBe('Security Deposit $2500/$100')
  })
})
