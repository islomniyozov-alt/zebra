// ---------------------------------------------------------------------------
// THE FUEL AND TOLL CHARGE SIDE. §6.2.3, migration 61.
//
// Until today this was a READ: the workbench header said what a driver had
// BURNED and nothing came off anybody's cheque, because `FuelTransaction` had
// no column for an invoice amount, a fee or a billable flag. Migration 61 added
// them. This file is what turns the reading into a charge.
//
// ── SHOW AND DEDUCT ARE TWO BOOLEANS ─────────────────────────────────────
//
// Not one, and the artefact has them as separate checkboxes for the reason
// §6.2.3 gives: a company-fuel driver is SHOWN what was burned in his truck and
// charged nothing for it. Four combinations, all of them real:
//
//   show + deduct    owner-operator on the company card — sees it, pays it
//   show, no deduct  company driver — sees his own burn, pays nothing
//   deduct, no show  a total with no detail. Allowed, and nobody wants it.
//   neither          fuel is simply not this authority's business
//
// A single boolean would have made the second case impossible to express, and
// it is the most common one in this fleet.
//
// ── FOUR MODES, FOUR DIFFERENT STATEMENTS ────────────────────────────────
//
// $339.92 at the pump, $284.43 on the fuel-card invoice, the same gallon of
// diesel. Which one a driver is charged is a POLICY DECISION, and §6.2.3 says
// it has to be recorded per statement because changing it silently restates
// what somebody was paid.
//
// So `Settlement.fuelMode` is frozen at refresh from `CompanySettings.fuelMode`
// and this function takes the mode as an argument. It never reads the setting.
// That is the same shape as the pay rule frozen on a load: the policy can move
// and the document cannot.
//
// ── A MISSING INVOICE AMOUNT FALLS BACK, AND SAYS SO ─────────────────────
//
// `invoiceCents` is nullable: it arrives from the fuel-card import, and a
// transaction keyed by hand or imported before the provider's invoice has one
// does not have it. An INVOICE mode on a row with no invoice amount cannot
// invent one, and charging zero would be a gift. It charges retail and the
// result SAYS which rows it fell back on, so the statement can carry a note
// rather than a silently different number.
//
// PURE. No database, no clock. The reads are in `statement-workbench.ts` and
// the write is in the batch engine.
// ---------------------------------------------------------------------------

import type { DeductionLine } from '@/lib/deductions'

/** Which amount a deducted fuel line charges. `CompanySettings.fuelMode`. */
export const FUEL_MODES = [
  /** The pump price. What the driver saw on the sign. */
  'RETAIL',
  /** The pump price plus the card's transaction fees. */
  'RETAIL_PLUS_FEES',
  /** What the fuel card actually invoiced the carrier. */
  'INVOICE',
  /** Invoiced, and the statement prints retail beside it. */
  'INVOICE_SHOW_BOTH',
] as const

export type FuelMode = (typeof FUEL_MODES)[number]

export function isFuelMode(value: string): value is FuelMode {
  return (FUEL_MODES as readonly string[]).includes(value)
}

/**
 * The mode to charge at, from a value that may be anything.
 *
 * `RETAIL` for an unrecognised one, which is the conservative end: retail is
 * the larger of the two amounts on every row in the corpus, so a typo in the
 * column charges MORE than intended and gets noticed, rather than less and
 * being absorbed. A silent undercharge is the carrier paying for a typo
 * forever.
 */
export function fuelModeOf(value: string | null | undefined): FuelMode {
  return typeof value === 'string' && isFuelMode(value) ? value : 'RETAIL'
}

/** One fuel purchase, as the charge needs it. */
export interface ChargeableFuel {
  id: string
  purchasedAt: Date
  /** Retail — the pump total. Always present. */
  totalCents: number
  /** What the card invoiced. Null where the import had none — see the header. */
  invoiceCents: number | null
  feesCents: number
}

/** One toll, as the charge needs it. `TollTransaction`. */
export interface ChargeableToll {
  id: string
  incurredAt: Date
  totalCents: number
  invoiceCents: number | null
  feesCents: number
}

export interface FuelChargeAmount {
  cents: number
  /** True when an INVOICE mode had no invoice amount and used retail. */
  fellBackToRetail: boolean
}

/**
 * What one transaction is charged at, under one mode.
 *
 * THE ONLY PLACE THE FOUR MODES TURN INTO A NUMBER. Both the fuel line and the
 * toll line go through it, because "invoice if we have it, retail if we do not"
 * written twice is written two ways eventually.
 */
export function chargeableCents(
  row: Pick<ChargeableFuel, 'totalCents' | 'invoiceCents' | 'feesCents'>,
  mode: FuelMode,
): FuelChargeAmount {
  if (mode === 'RETAIL') {
    return { cents: row.totalCents, fellBackToRetail: false }
  }
  if (mode === 'RETAIL_PLUS_FEES') {
    return { cents: row.totalCents + row.feesCents, fellBackToRetail: false }
  }
  // INVOICE and INVOICE_SHOW_BOTH charge the same amount. They differ only in
  // what the statement PRINTS beside it, which is `showsBoth` below — a mode
  // that changed the figure as well as the presentation would make "show me
  // retail too" a request that altered somebody's pay.
  if (row.invoiceCents === null) {
    return { cents: row.totalCents, fellBackToRetail: true }
  }
  return { cents: row.invoiceCents, fellBackToRetail: false }
}

/** Whether the statement prints retail alongside the invoiced figure. */
export function showsBoth(mode: FuelMode): boolean {
  return mode === 'INVOICE_SHOW_BOTH'
}

export interface FuelChargeResult {
  /** Null when there is nothing to charge — never a zero line. */
  line: DeductionLine | null
  /** Ids of the transactions this line claims, for `settlementId`. */
  claimedIds: string[]
  /** Retail total, for the `INVOICE_SHOW_BOTH` gloss and for the header. */
  retailCents: number
  /** How many rows had no invoice amount under an INVOICE mode. */
  fellBackCount: number
}

const dollars = (cents: number): string =>
  cents % 100 === 0 ? `$${String(cents / 100)}` : `$${(cents / 100).toFixed(2)}`

const usDate = (at: Date): string => {
  const month = String(at.getUTCMonth() + 1).padStart(2, '0')
  const day = String(at.getUTCDate()).padStart(2, '0')
  return `${month}/${day}/${String(at.getUTCFullYear())}`
}

/**
 * The fuel deduction line for one driver, one period.
 *
 * ── ONE LINE, NOT ONE PER FILL-UP ────────────────────────────────────────
 *
 * The corpus prints `Fuel · Auto calculated Fuel cost · 1 · $1,234.56`, a
 * single row, and the detail lives on the workbench's Review panel. Twenty
 * fill-ups as twenty statement lines would push the Earnings table off the page
 * and bury the figure the driver is actually checking.
 *
 * ── NO TRANSACTIONS MEANS NO LINE ────────────────────────────────────────
 *
 * Not a zero line, which claims somebody looked and found nothing charged. The
 * same rule `computeDeductions` applies to its own `Fuel` branch and §4 applies
 * to the whole section. A ZERO TOTAL with transactions present is also no line:
 * a week of $0.00 fills is not a thing, so it is a data problem, and printing a
 * zero deduction would make it look settled.
 */
export function fuelChargeFor(input: {
  transactions: readonly ChargeableFuel[]
  mode: FuelMode
  period: { start: Date; end: Date }
  /** `CompanySettings.deductFuel`. False means read-only — §6.2.3. */
  deduct: boolean
}): FuelChargeResult {
  const retailCents = input.transactions.reduce(
    (sum, row) => sum + row.totalCents,
    0,
  )
  if (!input.deduct || input.transactions.length === 0) {
    return { line: null, claimedIds: [], retailCents, fellBackCount: 0 }
  }

  let cents = 0
  let fellBackCount = 0
  for (const row of input.transactions) {
    const charge = chargeableCents(row, input.mode)
    cents += charge.cents
    if (charge.fellBackToRetail) fellBackCount++
  }
  if (cents === 0) {
    return { line: null, claimedIds: [], retailCents, fellBackCount }
  }

  const span = `${usDate(input.period.start)} to ${usDate(input.period.end)}`
  // SAY WHICH AMOUNT WAS CHARGED, ON THE STATEMENT. A driver comparing a
  // deduction against the pump receipts in his cab needs to know he is looking
  // at the card invoice, or the two numbers look like an error.
  const basis =
    input.mode === 'RETAIL'
      ? 'retail'
      : input.mode === 'RETAIL_PLUS_FEES'
        ? 'retail + fees'
        : 'card invoice'
  const gloss = showsBoth(input.mode) ? ` (retail ${dollars(retailCents)})` : ''
  // AND NAME THE FALLBACK. See the header: an INVOICE mode that charged retail
  // on four rows produced a number the mode does not describe, and a statement
  // that did not say so would be quietly wrong in a way only the import knows.
  const note =
    fellBackCount > 0
      ? `${String(fellBackCount)} of ${String(input.transactions.length)} ` +
        'fuel transactions had no card invoice amount and were charged at ' +
        'retail.'
      : undefined

  return {
    line: {
      ruleId: null,
      type: 'Fuel',
      description: `Fuel ${span} — ${basis}${gloss}`,
      quantity: input.transactions.length,
      rateCents: cents,
      totalCents: -cents,
      ...(note === undefined ? {} : { note }),
    },
    claimedIds: input.transactions.map((row) => row.id),
    retailCents,
    fellBackCount,
  }
}

/**
 * The toll deduction line for one driver, one period. `DEDUCTION_TOLL`.
 *
 * SAME SHAPE, SEPARATE FUNCTION, and the duplication is three lines of
 * assembly rather than any arithmetic — `chargeableCents` is shared. Tolls and
 * fuel are shown and deducted by SEPARATE booleans, so they cannot be one call
 * with a label argument: an authority that charges fuel and absorbs tolls is
 * the common case here, and a single function would have to be told twice
 * anyway.
 *
 * The corpus prints `Tolls · TollPrePass 08/01/2026 to 08/31/2026`, which is
 * where the description shape comes from.
 */
export function tollChargeFor(input: {
  transactions: readonly ChargeableToll[]
  mode: FuelMode
  period: { start: Date; end: Date }
  /** `CompanySettings.deductTolls`. */
  deduct: boolean
}): FuelChargeResult {
  const retailCents = input.transactions.reduce(
    (sum, row) => sum + row.totalCents,
    0,
  )
  if (!input.deduct || input.transactions.length === 0) {
    return { line: null, claimedIds: [], retailCents, fellBackCount: 0 }
  }

  let cents = 0
  let fellBackCount = 0
  for (const row of input.transactions) {
    const charge = chargeableCents(row, input.mode)
    cents += charge.cents
    if (charge.fellBackToRetail) fellBackCount++
  }
  if (cents === 0) {
    return { line: null, claimedIds: [], retailCents, fellBackCount }
  }

  const span = `${usDate(input.period.start)} to ${usDate(input.period.end)}`
  return {
    line: {
      ruleId: null,
      type: 'Tolls',
      description: `Tolls ${span}`,
      quantity: input.transactions.length,
      rateCents: cents,
      totalCents: -cents,
    },
    claimedIds: input.transactions.map((row) => row.id),
    retailCents,
    fellBackCount,
  }
}

/**
 * The `SettlementLineType` for a deduction label.
 *
 * ── WHY THIS IS A FUNCTION AND NOT A MAP AT THE CALL SITE ────────────────
 *
 * `DEDUCTION_TOLL` arrived in migration 61, and before it existed a toll line
 * was written as `DEDUCTION_OTHER`. Rows already in the database carry that, so
 * this decides the type for NEW lines only and nothing migrates: a FINAL
 * statement's lines are what it printed.
 *
 * An unknown label is `DEDUCTION_OTHER`, because `type` is a free string by
 * design — §6.2.4 and `deductions.ts` both say a new kind of charge is a label,
 * never a migration — so the enum has to have a floor.
 */
export function lineTypeFor(label: string): string {
  switch (label) {
    case 'Fuel':
      return 'DEDUCTION_FUEL'
    case 'Tolls':
      return 'DEDUCTION_TOLL'
    case 'Insurance':
      return 'DEDUCTION_INSURANCE'
    case 'Escrow':
      return 'DEDUCTION_ESCROW'
    default:
      return 'DEDUCTION_OTHER'
  }
}
