import type { OpeningBalanceCategory, Prisma } from '@/generated/prisma/client'
import type { DeductionCadence } from './deductions'

type TxClient = Prisma.TransactionClient

// ---------------------------------------------------------------------------
// WHAT COMES OFF A DRIVER'S CHEQUE, AND WHAT THEY BROUGHT INTO THE YEAR.
//
// `deductions.ts` is the pure engine — it computes a week's lines from rules it
// is handed and touches no database. This is the writer beside it, the same
// split `driver-pay.ts` keeps: the arithmetic in one place, the rows in another.
//
// ── WHY THESE EXIST AT ALL ────────────────────────────────────────────────
//
// `RecurringDeduction` and `DriverOpeningBalance` have been in the schema since
// Phase 3 and NOTHING IN `src/app` HAS EVER REFERENCED EITHER. The engine reads
// them, the statement prints them, the acceptance suites construct them — and a
// person with a browser could not put one in. Insurance, escrow and a loan
// reached the database by hand or not at all.
//
// MEASURED, on the four replayed weeks on dev: every statement diff showed
// Datatruck's deductions against Zebra's $0.00 — ST-005284 −$3,184.21,
// ST-005310 −$2,051.16, ST-005317 −$500.00, ST-005352 −$250.00, ST-005395
// −$450.00, ST-005377 −$686.67. Not one of those was an engine gap. They were
// all this gap.
//
// THE RULES THEMSELVES ARE NOT RESTATED HERE. `Escrow` stopping at its target
// and `Fuel` taking its own arithmetic live in `deductions.ts` and are read by
// the engine; this file writes rows and refuses ones the engine could not
// price. A second copy of the semantics is how the two come to disagree.
// ---------------------------------------------------------------------------

/**
 * The deduction types the office actually runs, offered by name.
 *
 * A LIST, NOT AN ENUM, because the column is a string and the statements print
 * whatever Datatruck was told — `Ifta`, `Admin Fee`, `Tolls`. Constraining the
 * column to five values would refuse a sixth the day somebody needs it, and the
 * engine already treats the type as a label except for the two cases below.
 *
 * `Escrow` AND `Fuel` ARE LOAD-BEARING and the order reflects it: `Escrow` is
 * the only type `deductions.ts` stops at a target, and `Fuel` the only one it
 * prices from the week's own fuel rather than from `amountCents`. The others are
 * flat labels. See that file's own comments.
 */
export const DEDUCTION_TYPES = [
  'Insurance',
  'Escrow',
  'Loan',
  'Ifta',
  'Admin Fee',
  'Tolls',
  'Fuel',
] as const

export type DeductionTypeName = (typeof DEDUCTION_TYPES)[number]

export function isDeductionType(value: string): value is DeductionTypeName {
  return (DEDUCTION_TYPES as readonly string[]).includes(value)
}

export type SaveDeductionFailure =
  | 'driver_not_found'
  | 'unknown_type'
  | 'bad_amount'
  | 'bad_monthly_total'
  | 'bad_target'
  | 'bad_dates'
  | 'overlaps'

export type SaveDeductionResult =
  | { ok: true; deductionId: string }
  | { ok: false; reason: SaveDeductionFailure }

export interface SaveDeductionInput {
  type: string
  description?: string | null
  /** The weekly instalment. For MONTHLY_SPLIT_WEEKLY, the `$450` of `$1800/$450`. */
  amountCents: number
  cadence: DeductionCadence
  /** The `$1800`. Required for MONTHLY_SPLIT_WEEKLY, refused otherwise. */
  monthlyTotalCents?: number | null
  /** Escrow's ceiling. Optional, and only Escrow stops at it. */
  targetCents?: number | null
  effectiveFrom: Date
  effectiveTo?: Date | null
  notes?: string | null
}

/**
 * Put a recurring deduction on a driver, or refuse and say which field.
 *
 * ── OVERLAPS ARE REFUSED PER TYPE, NOT PER DRIVER ─────────────────────────
 *
 * `saveDriverPayRule` refuses any overlap because a driver has ONE pay rule in
 * force at a time. A driver has SEVERAL deductions at once — insurance and
 * escrow and a loan all run together, which is the whole point. So the clash
 * test is scoped to the type: two overlapping `Insurance` rows would charge
 * insurance twice and the driver would find out on Friday, while insurance
 * beside escrow is the normal case.
 *
 * ENDING ONE AND STARTING ANOTHER IS STILL A DELIBERATE ACT — close the first
 * with `closeRecurringDeduction` and the new one no longer clashes. Same posture
 * as the pay rules, for the same reason.
 */
export async function saveRecurringDeduction(
  tx: TxClient,
  driverId: string,
  input: SaveDeductionInput,
): Promise<SaveDeductionResult> {
  const driver = await tx.driver.findFirst({
    where: { id: driverId, deletedAt: null },
    select: { id: true, organizationId: true },
  })
  if (!driver) return { ok: false, reason: 'driver_not_found' }

  if (!isDeductionType(input.type)) {
    return { ok: false, reason: 'unknown_type' }
  }

  // A DEDUCTION OF NOTHING IS ONE SOMEBODY FORGOT TO FINISH, and a negative one
  // would pay the driver from the deduction column — where no screen would ever
  // show it as earnings.
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    return { ok: false, reason: 'bad_amount' }
  }

  const monthly = input.monthlyTotalCents ?? null
  if (input.cadence === 'MONTHLY_SPLIT_WEEKLY') {
    // THE MONTH'S TOTAL IS WHAT THE SPLIT TRUES UP TO. Without it
    // `activeDaysInMonth` has nothing to apportion and the last week of a
    // partial month would charge a full instalment.
    if (monthly === null || !Number.isInteger(monthly) || monthly <= 0) {
      return { ok: false, reason: 'bad_monthly_total' }
    }
    // AND IT MUST BE THE LARGER FIGURE. `$450/$1800` keyed the wrong way round
    // collects four times what was agreed, and both numbers look plausible.
    if (monthly < input.amountCents) {
      return { ok: false, reason: 'bad_monthly_total' }
    }
  } else if (monthly !== null) {
    // A WEEKLY RULE CARRYING A MONTHLY TOTAL is a form somebody changed their
    // mind on, and the leftover figure would be read by the next reader who
    // trusted the cadence. Refused rather than silently nulled.
    return { ok: false, reason: 'bad_monthly_total' }
  }

  const target = input.targetCents ?? null
  if (target !== null && (!Number.isInteger(target) || target <= 0)) {
    return { ok: false, reason: 'bad_target' }
  }

  const from = input.effectiveFrom
  const to = input.effectiveTo ?? null
  if (Number.isNaN(from.getTime())) return { ok: false, reason: 'bad_dates' }
  if (to && Number.isNaN(to.getTime()))
    return { ok: false, reason: 'bad_dates' }
  if (to && to.getTime() < from.getTime()) {
    return { ok: false, reason: 'bad_dates' }
  }

  const existing = await tx.recurringDeduction.findMany({
    where: { driverId: driver.id, type: input.type },
    select: { id: true, effectiveFrom: true, effectiveTo: true },
  })
  const clashes = existing.some(
    (rule) =>
      rule.effectiveFrom.getTime() <= (to?.getTime() ?? Infinity) &&
      (rule.effectiveTo?.getTime() ?? Infinity) >= from.getTime(),
  )
  if (clashes) return { ok: false, reason: 'overlaps' }

  const created = await tx.recurringDeduction.create({
    data: {
      driverId: driver.id,
      organizationId: driver.organizationId,
      type: input.type,
      description: input.description ?? null,
      amountCents: input.amountCents,
      cadence: input.cadence,
      monthlyTotalCents: monthly,
      targetCents: target,
      effectiveFrom: from,
      effectiveTo: to,
      notes: input.notes ?? null,
    },
    select: { id: true },
  })
  return { ok: true, deductionId: created.id }
}

export type CloseDeductionFailure = 'not_found' | 'bad_dates'

export type CloseDeductionResult =
  | { ok: true }
  | { ok: false; reason: CloseDeductionFailure }

/**
 * Stop a deduction on a date, rather than deleting the row.
 *
 * DELETING WOULD REWRITE HISTORY. A settlement already computed from this rule
 * printed a line that has to remain explicable, and `inForce` reads the dates —
 * so closing is how a deduction ends, exactly as a pay rule does.
 */
export async function closeRecurringDeduction(
  tx: TxClient,
  deductionId: string,
  effectiveTo: Date,
): Promise<CloseDeductionResult> {
  const row = await tx.recurringDeduction.findFirst({
    where: { id: deductionId },
    select: { id: true, effectiveFrom: true },
  })
  if (!row) return { ok: false, reason: 'not_found' }
  if (Number.isNaN(effectiveTo.getTime())) {
    return { ok: false, reason: 'bad_dates' }
  }
  if (effectiveTo.getTime() < row.effectiveFrom.getTime()) {
    return { ok: false, reason: 'bad_dates' }
  }
  await tx.recurringDeduction.update({
    where: { id: row.id },
    data: { effectiveTo },
  })
  return { ok: true }
}

// ---------------------------------------------------------------------------
// THE OPENING BALANCE — WHAT A DRIVER BROUGHT INTO THE YEAR.
// ---------------------------------------------------------------------------

export type SaveOpeningFailure =
  | 'driver_not_found'
  | 'bad_year'
  | 'bad_amount'
  | 'bad_dates'
  | 'no_source'

export type SaveOpeningResult =
  | { ok: true; balanceId: string }
  | { ok: false; reason: SaveOpeningFailure }

export interface SaveOpeningInput {
  year: number
  /**
   * THE GENERATED ENUM, NOT A UNION RETYPED HERE.
   *
   * The first version of this listed five members and the enum has SIX — it had
   * dropped `ADVANCES`, which is the one every Datatruck statement prints at the
   * top. It compiled, because a subset of a union is a valid union, so nothing
   * would have said so until an accountant went looking for the field.
   */
  category: OpeningBalanceCategory
  /** Signed as the category runs: deductions are negative, as they print. */
  amountCents: number
  asOf: Date
  /** Where the figure came from — a statement number, a spreadsheet, a person. */
  source: string
  notes?: string | null
}

/**
 * Record what a driver had earned and been deducted before Zebra existed.
 *
 * ── IT IS AN UPSERT, BY RULING OF THE SCHEMA ──────────────────────────────
 *
 * `@@unique([driverId, year, category])` says one figure per category per year,
 * so entering it twice is a CORRECTION rather than a second balance. A create
 * would fail the constraint and reach the accountant as a five-hundred; a second
 * row would make the year's opening depend on which was read first.
 *
 * `source` IS REQUIRED AND IS NOT DECORATION. This figure moves every YTD total
 * on every statement for a year, and it is typed in by hand from somewhere
 * else. A year-to-date that nobody can trace to a document is a year-to-date
 * nobody can defend, which is the whole reason the column exists.
 */
export async function saveOpeningBalance(
  tx: TxClient,
  driverId: string,
  input: SaveOpeningInput,
): Promise<SaveOpeningResult> {
  const driver = await tx.driver.findFirst({
    where: { id: driverId, deletedAt: null },
    select: { id: true, organizationId: true },
  })
  if (!driver) return { ok: false, reason: 'driver_not_found' }

  // A YEAR OUTSIDE THIS RANGE IS A TYPO, not a balance. 2026 keyed as 226 or
  // 20026 would file the figure where no statement will ever look for it.
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2100) {
    return { ok: false, reason: 'bad_year' }
  }
  if (!Number.isInteger(input.amountCents)) {
    return { ok: false, reason: 'bad_amount' }
  }
  if (Number.isNaN(input.asOf.getTime())) {
    return { ok: false, reason: 'bad_dates' }
  }
  if (input.source.trim() === '') return { ok: false, reason: 'no_source' }

  const row = await tx.driverOpeningBalance.upsert({
    where: {
      driverId_year_category: {
        driverId: driver.id,
        year: input.year,
        category: input.category,
      },
    },
    create: {
      driverId: driver.id,
      organizationId: driver.organizationId,
      year: input.year,
      category: input.category,
      amountCents: input.amountCents,
      asOf: input.asOf,
      source: input.source.trim(),
      notes: input.notes ?? null,
    },
    update: {
      amountCents: input.amountCents,
      asOf: input.asOf,
      source: input.source.trim(),
      notes: input.notes ?? null,
    },
    select: { id: true },
  })
  return { ok: true, balanceId: row.id }
}
