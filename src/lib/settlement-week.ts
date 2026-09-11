import { percentOfCents } from './money'
import {
  payFor,
  ruleInForce,
  type PayRule,
  type PaySnapshot,
} from './driver-pay'
import {
  computeDeductions,
  type DeductionLine,
  type DeductionPeriod,
  type OneOffCharge,
  type RecurringRule,
} from './deductions'

// ---------------------------------------------------------------------------
// ONE WEEK, ONE COMPANY, ONE STATEMENT PER DRIVER.
//
// MONEY-DESIGN item 3. Everything here is ARITHMETIC OVER AN INPUT — no Prisma,
// no clock, no counter — because the acceptance is that it reproduces six real
// Datatruck statements to the cent, and a function that reads a database cannot
// be pointed at a statement from August.
//
// `settlement-batch.ts` is the half that talks to the database. This half is
// the half that can be graded.
//
// ── THE TRUTH SET ────────────────────────────────────────────────────────
//
// Six statements in `corpus/datatruck`, read page by page:
//
//   ST-005284  RAM       Hassan Ali Hirsi     88%   15 loads, 4 deductions
//   ST-005301  Dolphins  Shodmon Muzaffarov   32%   NO deductions section
//   ST-005310  RAM       Hassan Ali Hirsi     88%   5 deductions
//   ST-005317  RAM       JERRY ROBERT MCKANE  30%   2 deductions + Other Pay
//   ST-005336  Dolphins  Shodmon Muzaffarov   32%   NO deductions section
//   ST-005352  RAM       JERRY ROBERT MCKANE  30%   1 deduction
//
// Every rule below is measured off those, not inferred:
//
//   THE PERCENTAGE IS PER LINE AND ROUNDED PER LINE. ST-005317 pays 30% on ten
//   loads; the printed total $3,251.74 is the sum of the ten ROUNDED amounts,
//   not 30% of the $10,839.15 gross. Those differ — 30% of the gross is
//   $3,251.745 — and the difference is the whole reason this is stated.
//
//   HALF-UP, from `percentOfCents`. $1,382.25 at 30% is $414.675 and prints
//   $414.68; $199.61 is $59.883 and prints $59.88.
//
//   NET PAY IS A SUM OF SIX. Earnings + Advances + Reimbursements + Other pay
//   − Deductions. ST-005317: 3,251.74 + 62.70 − 500.00 = 2,814.44.
//
//   AN EMPTY SECTION IS OMITTED. Both Dolphins statements have no Deductions
//   block at all — not a block of zeros. The summary still prints $0.00 there,
//   which is a different thing and is why both rules coexist.
//
// ── WHAT IS DELIBERATELY NOT HERE ────────────────────────────────────────
//
// Fuel. Item 4 brings the import; the engine's Fuel rule already declines to
// print a line when no transactions exist, so a week with no fuel data has no
// Fuel row rather than a zero one. The statements' page 2 is a Fuel
// Transactions table this does not build.
// ---------------------------------------------------------------------------

/** Inclusive UTC day boundaries. A period is a Sunday and the Saturday after. */
export interface Week {
  start: Date
  end: Date
}

const DAY = 86_400_000

/** The Sunday-to-Saturday week a day falls in, in UTC. */
export function weekOf(day: Date): Week {
  const midnight = Date.UTC(
    day.getUTCFullYear(),
    day.getUTCMonth(),
    day.getUTCDate(),
  )
  const start = midnight - new Date(midnight).getUTCDay() * DAY
  return { start: new Date(start), end: new Date(start + 6 * DAY) }
}

/**
 * Is this pair a real Sunday-to-Saturday week?
 *
 * ASKED RATHER THAN ASSUMED. A batch is created from two typed dates, and
 * MONEY-DESIGN §0 fixes the boundary — a batch over Monday-to-Sunday would
 * settle the same loads under a different name and nothing downstream could
 * tell. The six statements all run Sunday to Saturday.
 */
export function isSettlementWeek(week: Week): boolean {
  if (week.start.getUTCDay() !== 0) return false
  if (week.end.getUTCDay() !== 6) return false
  const span = week.end.getTime() - week.start.getTime()
  return span === 6 * DAY
}

// ── which gross a load settles on (§3) ────────────────────────────────────

/**
 * How a remittance landed against a direct-settled load.
 *
 * `none` is not an absence — it is the state a load is in before Amazon has
 * remitted, and it holds the line with a reason a person can act on.
 */
export type RemittanceOutcome = 'matched_exact' | 'short' | 'over' | 'none'

export interface DirectSettlement {
  outcome: RemittanceOutcome
  /** What Amazon actually paid, when it has paid. */
  remittedCents: number | null
  /**
   * Dispatch's confirmation that the remitted figure IS the settled gross.
   *
   * SEPARATE FROM `remittedCents` ON PURPOSE. A short remittance is not
   * evidence of anything until a person has looked at it: it can mean a
   * deduction we accept, or a mistake we are going to argue about, and paying a
   * driver on it before somebody decides is paying them on a guess.
   */
  confirmedCents: number | null
}

export interface SettleableLoad {
  id: string
  /** As printed in the Load number column. */
  loadNumber: string
  /** "PONTIAC,MI" — printed exactly as stored. */
  puPlace: string
  delPlace: string
  puDate: Date
  delDate: Date
  /** Everything the load billed us: linehaul, surcharge and accessorials. */
  rateCents: number
  /** Hundredths, because the statements print 3.75 and 465.85. */
  milesHundredths: number
  /** Null on broker freight, which settles on the rate and never waits. */
  direct: DirectSettlement | null
}

export type HeldReason =
  | { kind: 'no_remittance' }
  | { kind: 'short'; remittedCents: number; rateCents: number }
  | { kind: 'over'; remittedCents: number; rateCents: number }

export type GrossDecision =
  | {
      settles: true
      grossCents: number
      basis: 'rate' | 'remitted' | 'confirmed'
    }
  | { settles: false; reason: HeldReason }

/**
 * The gross one load settles on — §3, and the ruling this item turns on.
 *
 * BROKER FREIGHT SETTLES ON THE RATE. Werner pays the rate confirmation and
 * the driver's percentage is of what we billed.
 *
 * AMAZON FREIGHT SETTLES ON THE REMITTED FIGURE, because the remittance is
 * what we were actually paid and the booked rate is what we expected. Where
 * they agree — `matched_exact` — that is automatic. Where they do not, the
 * line is HELD until somebody confirms which figure is right, and the draft
 * names it. A short line quietly settled on the rate overpays the driver out
 * of money that never arrived; quietly settled on the remittance it underpays
 * them on a figure nobody has checked.
 */
export function grossFor(load: SettleableLoad): GrossDecision {
  if (load.direct === null) {
    return { settles: true, grossCents: load.rateCents, basis: 'rate' }
  }

  const direct = load.direct
  if (direct.confirmedCents !== null) {
    return {
      settles: true,
      grossCents: direct.confirmedCents,
      basis: 'confirmed',
    }
  }

  if (direct.outcome === 'matched_exact' && direct.remittedCents !== null) {
    return {
      settles: true,
      grossCents: direct.remittedCents,
      basis: 'remitted',
    }
  }

  if (direct.remittedCents === null || direct.outcome === 'none') {
    return { settles: false, reason: { kind: 'no_remittance' } }
  }

  return {
    settles: false,
    reason: {
      kind: direct.outcome === 'over' ? 'over' : 'short',
      remittedCents: direct.remittedCents,
      rateCents: load.rateCents,
    },
  }
}

// ── one driver's statement ────────────────────────────────────────────────

export interface LoadLine {
  loadId: string
  loadNumber: string
  puPlace: string
  delPlace: string
  puDate: Date
  delDate: Date
  /** The Load gross column — the figure the percentage was taken of. */
  grossCents: number
  milesHundredths: number
  /** The Total amount column. */
  amountCents: number
  /** How that figure was reached, frozen onto the line. */
  snapshot: PaySnapshot
  /** Which gross the line settled on, so a reader can tell rate from remitted. */
  basis: 'rate' | 'remitted' | 'confirmed'
}

export interface HeldLine {
  loadId: string
  loadNumber: string
  rateCents: number
  reason: HeldReason
}

/** Why this driver cannot be settled at all. Never a skip — see the header. */
export type DriverBlocker =
  | { kind: 'no_pay_rule'; on: Date }
  | { kind: 'pay_rule_unusable'; reason: string; loadNumber: string }

export interface DriverSettlementInput {
  driverId: string
  /** As printed: "JERRY ROBERT MCKANE". */
  driverName: string
  /** Frozen onto the settlement at FINAL — see the header on `unitNumber`. */
  unitNumber: string | null
  period: Week
  loads: readonly SettleableLoad[]
  payRules: readonly PayRule[]
  recurring: readonly RecurringRule[]
  charges: readonly OneOffCharge[]
  escrowHeldCents: number
  collectedThisMonthCents?: Readonly<Record<string, number>>
  fuelCents?: number | null
  /**
   * The driver's own payout lag, in whole weeks.
   *
   * A STATED PROPERTY, superseded rather than edited, like the pay rule. Zero
   * for almost everybody.
   */
  payoutLagWeeks: number
  /** Typed on the batch. Never derived — MONEY-DESIGN says so twice. */
  checkDate: Date
  /** `{category: cents}` for the year, or an empty object when there is none. */
  openingBalances: Readonly<Partial<Record<YtdCategory, number>>>
  /** FINAL settlements already in this calendar year, for the YTD sum. */
  priorThisYear: readonly YtdTotals[]
  /** The earliest period this driver has a settled statement for. */
  firstSettledPeriodStart: Date | null
}

export type YtdCategory =
  | 'EARNINGS'
  | 'ADVANCES'
  | 'REIMBURSEMENTS'
  | 'DEDUCTIONS'
  | 'OTHER_PAY'
  | 'NET_PAY'

export interface YtdTotals {
  earningsCents: number
  advancesCents: number
  reimbursementsCents: number
  deductionsCents: number
  otherPayCents: number
  netCents: number
}

export interface DriverSettlement extends YtdTotals {
  driverId: string
  driverName: string
  unitNumber: string | null
  period: Week
  /** Batch check date plus the driver's lag. This is what prints. */
  payoutDate: Date
  /** "88% from gross", printed verbatim. Null when no rule applied. */
  payTariffLabel: string | null
  lines: LoadLine[]
  /** The Earnings section's Total row: gross, miles, amount. */
  grossCents: number
  milesHundredths: number
  /** Negative amounts. Omitted from the PDF entirely when empty. */
  deductionLines: DeductionLine[]
  /** Positive amounts — the Other Pay section. Omitted when empty. */
  otherPayLines: DeductionLine[]
  held: HeldLine[]
  blockers: DriverBlocker[]
  escrowAfterCents: number
  /** What the escrow ledger must be moved by at FINAL. Zero when it did not run. */
  escrowDeltaCents: number
  ytd: YtdTotals
  /**
   * Set when this driver has no opening balance row for the year.
   *
   * The YTD figures are then a sum over what Zebra itself has settled, which is
   * NOT a year — so the statement says which period it counts from rather than
   * printing a full-year label over a partial figure.
   */
  ytdFromPeriodStart: Date | null
  /** Printed and flagged. Never clamped, never carried — Islom's decision. */
  netIsNegative: boolean
}

const inPeriod = (day: Date, period: Week): boolean =>
  day.getTime() >= period.start.getTime() &&
  day.getTime() <= period.end.getTime() + (DAY - 1)

/**
 * The label the statement prints for the rule that paid.
 *
 * VERBATIM FROM THE ARTEFACT: "88% from gross", "32% from gross", "30% from
 * gross". Built from the rule rather than stored, so a rule change cannot leave
 * a label behind claiming the old percentage.
 */
export function tariffLabel(rule: PayRule): string | null {
  switch (rule.type) {
    case 'PERCENT_GROSS':
      return rule.percentBps === null
        ? null
        : `${trimPercent(rule.percentBps)}% from gross`
    case 'PERCENT_LINEHAUL':
      return rule.percentBps === null
        ? null
        : `${trimPercent(rule.percentBps)}% from linehaul`
    case 'PER_MILE':
      return rule.perMileCents === null
        ? null
        : `$${(rule.perMileCents / 100).toFixed(2)} per mile`
    case 'FLAT_PER_LOAD':
      return rule.flatCents === null
        ? null
        : `$${(rule.flatCents / 100).toFixed(2)} per load`
    default:
      return null
  }
}

/** 8800 -> "88", 3250 -> "32.5". Basis points print as the artefact prints. */
function trimPercent(bps: number): string {
  const percent = bps / 100
  return Number.isInteger(percent) ? String(percent) : String(percent)
}

export function computeDriverSettlement(
  input: DriverSettlementInput,
): DriverSettlement {
  const lines: LoadLine[] = []
  const held: HeldLine[] = []
  const blockers: DriverBlocker[] = []
  let payTariffLabel: string | null = null

  for (const load of input.loads) {
    const decision = grossFor(load)
    if (!decision.settles) {
      held.push({
        loadId: load.id,
        loadNumber: load.loadNumber,
        rateCents: load.rateCents,
        reason: decision.reason,
      })
      continue
    }

    // THE RULE IN FORCE WHEN THE LOAD RAN, not the one in force today.
    // Regenerating a draft next week must not apply next week's percentage.
    const rule = ruleInForce(input.payRules, load.delDate)
    if (!rule) {
      // BLOCKS, NEVER SKIPS. A driver with settleable freight and no rule is a
      // person who would otherwise be paid nothing and appear on no list — the
      // failure mode that costs somebody a week's wages quietly.
      blockers.push({ kind: 'no_pay_rule', on: load.delDate })
      continue
    }

    // THE SETTLED GROSS IS SUBSTITUTED INTO THE BASIS. For Amazon freight that
    // is the REMITTED figure, so the percentage is of what arrived rather than
    // of what we booked — and the snapshot records the substituted figure, so
    // the line can be checked by hand against the remittance.
    const result = payFor(
      {
        id: load.id,
        loadNumber: load.loadNumber,
        linehaulCents: decision.grossCents,
        fuelSurchargeCents: 0,
        accessorialsCents: 0,
        totalRevenueCents: decision.grossCents,
        actualMiles: Math.round(load.milesHundredths / 100),
        dispatchedMiles: null,
      },
      rule,
    )

    if (!result.ok) {
      blockers.push({
        kind: 'pay_rule_unusable',
        reason: result.reason,
        loadNumber: load.loadNumber,
      })
      continue
    }

    payTariffLabel ??= tariffLabel(rule)
    lines.push({
      loadId: load.id,
      loadNumber: load.loadNumber,
      puPlace: load.puPlace,
      delPlace: load.delPlace,
      puDate: load.puDate,
      delDate: load.delDate,
      grossCents: decision.grossCents,
      milesHundredths: load.milesHundredths,
      amountCents: result.amountCents,
      snapshot: result.snapshot,
      basis: decision.basis,
    })
  }

  // ── deductions, from item 2's engine ────────────────────────────────────
  //
  // RUN ON EVERY DRAFT REFRESH. A recurring deduction accrues in a week with no
  // loads, so an idle owner-operator still gets a statement — which is why this
  // is outside the loop above and does not ask whether any line settled.
  const period: DeductionPeriod = {
    start: input.period.start,
    end: input.period.end,
  }
  const deductions = computeDeductions({
    period,
    rules: input.recurring,
    charges: input.charges.filter((charge) =>
      inPeriod(charge.appliesOn, input.period),
    ),
    escrowHeldCents: input.escrowHeldCents,
    ...(input.collectedThisMonthCents
      ? { collectedThisMonthCents: input.collectedThisMonthCents }
      : {}),
    ...(input.fuelCents === undefined ? {} : { fuelCents: input.fuelCents }),
  })

  // ONE TABLE, SPLIT BY SIGN. A charge and a credit are the same object
  // pointing opposite ways — `SettlementCharge` is stored that way for the same
  // reason — and the statement prints them as two sections because that is what
  // the artefact does, not because they are two kinds of thing.
  const deductionLines = deductions.lines.filter((line) => line.totalCents < 0)
  const otherPayLines = deductions.lines.filter((line) => line.totalCents > 0)

  const earningsCents = lines.reduce((sum, line) => sum + line.amountCents, 0)
  const grossCents = lines.reduce((sum, line) => sum + line.grossCents, 0)
  const milesHundredths = lines.reduce(
    (sum, line) => sum + line.milesHundredths,
    0,
  )
  const deductionsCents = deductionLines.reduce(
    (sum, line) => sum + line.totalCents,
    0,
  )
  const otherPayCents = otherPayLines.reduce(
    (sum, line) => sum + line.totalCents,
    0,
  )

  // ADVANCES AND REIMBURSEMENTS ARE THEIR OWN SUMMARY ROWS on the artefact and
  // read $0.00 on all six. They are recognised by the charge's own label, so a
  // reimbursement is not silently counted as other pay.
  const advancesCents = otherPayLines
    .filter((line) => line.type === 'Advance')
    .reduce((sum, line) => sum + line.totalCents, 0)
  const reimbursementsCents = otherPayLines
    .filter((line) => line.type === 'Reimbursement')
    .reduce((sum, line) => sum + line.totalCents, 0)
  const plainOtherPayCents = otherPayCents - advancesCents - reimbursementsCents

  const netCents =
    earningsCents +
    advancesCents +
    reimbursementsCents +
    plainOtherPayCents +
    deductionsCents

  const escrowDeltaCents = deductions.escrowHeldCents - input.escrowHeldCents

  const totals: YtdTotals = {
    earningsCents,
    advancesCents,
    reimbursementsCents,
    deductionsCents,
    otherPayCents: plainOtherPayCents,
    netCents,
  }

  const ytd = addYtd([...input.priorThisYear, totals], input.openingBalances)
  const hasOpening = Object.keys(input.openingBalances).length > 0

  return {
    driverId: input.driverId,
    driverName: input.driverName,
    unitNumber: input.unitNumber,
    period: input.period,
    payoutDate: payoutDateFor(input.checkDate, input.payoutLagWeeks),
    payTariffLabel,
    lines,
    grossCents,
    milesHundredths,
    deductionLines,
    otherPayLines: otherPayLines.filter(
      (line) => line.type !== 'Advance' && line.type !== 'Reimbursement',
    ),
    held,
    blockers,
    escrowAfterCents: deductions.escrowHeldCents,
    escrowDeltaCents,
    ...totals,
    ytd,
    ytdFromPeriodStart: hasOpening
      ? null
      : (input.firstSettledPeriodStart ?? input.period.start),
    netIsNegative: netCents < 0,
  }
}

/**
 * The batch's check date, plus the driver's own lag.
 *
 * FROZEN AT FINAL, and it is what the statement's Check Date field prints. A
 * driver paid a week in arrears has a different cheque date from the driver
 * beside him in the same batch, and printing the batch's date on both would
 * tell one of them the wrong day.
 */
export function payoutDateFor(checkDate: Date, lagWeeks: number): Date {
  return new Date(checkDate.getTime() + Math.max(0, lagWeeks) * 7 * DAY)
}

/** Opening balance for the year, plus every FINAL settlement in it. */
export function addYtd(
  settlements: readonly YtdTotals[],
  opening: Readonly<Partial<Record<YtdCategory, number>>>,
): YtdTotals {
  const sum = (pick: (row: YtdTotals) => number) =>
    settlements.reduce((total, row) => total + pick(row), 0)

  return {
    earningsCents: (opening.EARNINGS ?? 0) + sum((row) => row.earningsCents),
    advancesCents: (opening.ADVANCES ?? 0) + sum((row) => row.advancesCents),
    reimbursementsCents:
      (opening.REIMBURSEMENTS ?? 0) + sum((row) => row.reimbursementsCents),
    deductionsCents:
      (opening.DEDUCTIONS ?? 0) + sum((row) => row.deductionsCents),
    otherPayCents: (opening.OTHER_PAY ?? 0) + sum((row) => row.otherPayCents),
    netCents: (opening.NET_PAY ?? 0) + sum((row) => row.netCents),
  }
}

// ── the batch ─────────────────────────────────────────────────────────────

export interface BatchInput {
  companyId: string
  period: Week
  statementDate: Date
  checkDate: Date
  drivers: readonly DriverSettlementInput[]
}

export interface BatchResult {
  settlements: DriverSettlement[]
  /** Every blocker across every driver, named. A batch with any cannot FINAL. */
  blockers: { driverId: string; driverName: string; blocker: DriverBlocker }[]
  /** Every held line across every driver, named. */
  held: { driverId: string; driverName: string; line: HeldLine }[]
  /** Drivers whose net pay is below zero. Printed and flagged. */
  negative: { driverId: string; driverName: string; netCents: number }[]
  canFinalise: boolean
}

export function computeBatch(input: BatchInput): BatchResult {
  const settlements = input.drivers.map((driver) =>
    computeDriverSettlement({ ...driver, checkDate: input.checkDate }),
  )

  const blockers = settlements.flatMap((settlement) =>
    settlement.blockers.map((blocker) => ({
      driverId: settlement.driverId,
      driverName: settlement.driverName,
      blocker,
    })),
  )

  return {
    settlements,
    blockers,
    held: settlements.flatMap((settlement) =>
      settlement.held.map((line) => ({
        driverId: settlement.driverId,
        driverName: settlement.driverName,
        line,
      })),
    ),
    negative: settlements
      .filter((settlement) => settlement.netIsNegative)
      .map((settlement) => ({
        driverId: settlement.driverId,
        driverName: settlement.driverName,
        netCents: settlement.netCents,
      })),
    // A HELD LINE DOES NOT BLOCK. It is a line left out of a statement that is
    // otherwise correct, and next week's batch will pick it up once somebody
    // confirms the figure. A missing PAY RULE does block, because the statement
    // it would produce is wrong rather than short.
    canFinalise: blockers.length === 0,
  }
}

/** Exposed for the reproduction tests, which check the rounding directly. */
export const __rounding = { percentOfCents }
