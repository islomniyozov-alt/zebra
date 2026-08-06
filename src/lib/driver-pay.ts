import type { PayRuleType, Prisma } from '@/generated/prisma/client'
import type { TxClient } from './tenancy'
import { percentOfCents } from './money'

// ---------------------------------------------------------------------------
// WHAT A DRIVER IS OWED FOR A LOAD (Phase 3 §5 step 6).
//
// FOUR CONCRETE RULES, and no fifth. The schema's `PayRuleType` carries a
// CUSTOM member with an `expression` column beside it — a sandboxed mini
// language for pay. That is refused here, in words, and the flag is recorded
// rather than silently resolved:
//
//   Paying a person by evaluating a string is a calculator nobody can review,
//   a parser nobody wrote, and an injection surface on the one table where the
//   output is somebody's wages. The four below cover every arrangement RAM and
//   Dolphins actually run. When a fifth is genuinely needed it should be a
//   fifth NAMED rule with its own arithmetic and its own test, not an
//   expression field.
//
// PERCENT_GROSS AND PERCENT_LINEHAUL ARE DIFFERENT CHOICES and the difference
// is real money. Gross includes the fuel surcharge and the accessorials;
// linehaul is the line rate alone. On a $2,450 + $380 load at 30% that is
// $849.00 against $735.00 — $114.00 a load, every load. A settlement screen
// that offers one "percentage" and picks a base for you is a screen that pays
// the wrong number quietly, so both are offered by name.
//
// THE RULE IS FROZEN, NOT REFERENCED. `payFor` returns the amount AND the
// snapshot that produced it, and the settlement line stores both (schema
// convention 5). Changing a driver's percentage next month must not rewrite
// what was already paid — and a regenerated settlement has to reproduce the
// old figure exactly, which it can only do from a copy.
// ---------------------------------------------------------------------------

/** The four this system pays by. `CUSTOM` is deliberately not among them. */
export const PAY_RULE_TYPES = [
  'PERCENT_GROSS',
  'PERCENT_LINEHAUL',
  'PER_MILE',
  'FLAT_PER_LOAD',
] as const

export type ConcretePayRuleType = (typeof PAY_RULE_TYPES)[number]

export function isConcretePayRule(
  type: PayRuleType,
): type is ConcretePayRuleType {
  return (PAY_RULE_TYPES as readonly string[]).includes(type)
}

/** What a rule needs to be usable. Which field depends on the type. */
export interface PayRule {
  id: string
  type: PayRuleType
  percentBps: number | null
  perMileCents: number | null
  flatCents: number | null
  effectiveFrom: Date
  effectiveTo: Date | null
}

/** The parts of a load the rules read. Nothing else is in scope. */
export interface PayableLoad {
  id: string
  loadNumber: string
  linehaulCents: number
  fuelSurchargeCents: number
  accessorialsCents: number
  totalRevenueCents: number
  actualMiles: number | null
  dispatchedMiles: number | null
}

export type PayFailure =
  | 'no_rule'
  | 'custom_unsupported'
  | 'rule_incomplete'
  | 'no_miles'

/**
 * The frozen record of how one figure was reached.
 *
 * Everything needed to recompute it by hand: the rule, the basis it was
 * applied to, and the result. A settlement line that says only "$849.00" is a
 * number a driver has to take on trust.
 */
export interface PaySnapshot {
  ruleId: string
  type: ConcretePayRuleType
  percentBps?: number
  perMileCents?: number
  flatCents?: number
  /** The figure the rule multiplied. Cents for percentages, miles for per-mile. */
  basis: number
  /** Which column `basis` came from, named so a reader can check it. */
  basisLabel:
    | 'totalRevenueCents'
    | 'linehaulCents'
    | 'actualMiles'
    | 'dispatchedMiles'
    | 'perLoad'
  amountCents: number
}

export type PayResult =
  | { ok: true; amountCents: number; snapshot: PaySnapshot }
  | { ok: false; reason: PayFailure }

/**
 * The rule in force on a date.
 *
 * Rules are a HISTORY, not a setting: `effectiveFrom` opens one and
 * `effectiveTo` closes it. The rule that applies to a load is the one in force
 * when the load ran, which is why generation passes the load's own date rather
 * than today's — regenerating last month's settlement must not apply this
 * month's percentage.
 */
export function ruleInForce(
  rules: readonly PayRule[],
  on: Date,
): PayRule | null {
  const at = on.getTime()
  const applicable = rules.filter(
    (rule) =>
      rule.effectiveFrom.getTime() <= at &&
      (rule.effectiveTo === null || rule.effectiveTo.getTime() >= at),
  )
  if (applicable.length === 0) return null

  // Latest start wins where two overlap. Overlapping rules are a data problem
  // the driver screen refuses to create, but a stale row from before that
  // refusal existed must not silently pay the older rate.
  return applicable.reduce((latest, rule) =>
    rule.effectiveFrom.getTime() > latest.effectiveFrom.getTime()
      ? rule
      : latest,
  )
}

/** What one load pays under one rule, with the record of how. */
export function payFor(load: PayableLoad, rule: PayRule | null): PayResult {
  if (!rule) return { ok: false, reason: 'no_rule' }
  if (rule.type === 'CUSTOM') return { ok: false, reason: 'custom_unsupported' }
  if (!isConcretePayRule(rule.type)) {
    return { ok: false, reason: 'custom_unsupported' }
  }

  switch (rule.type) {
    case 'PERCENT_GROSS':
    case 'PERCENT_LINEHAUL': {
      if (rule.percentBps === null) {
        return { ok: false, reason: 'rule_incomplete' }
      }
      // GROSS is everything the load billed; LINEHAUL is the line rate alone.
      // Naming the basis in the snapshot is what lets a driver check it.
      const gross = rule.type === 'PERCENT_GROSS'
      const basis = gross ? load.totalRevenueCents : load.linehaulCents

      // The same arithmetic the factoring fee uses, from the same function.
      // My first version routed this through `multiplyCents`, which MULTIPLIES
      // — 30% of $2,450.00 came out as $73,500.00 rather than $735.00, a
      // hundredfold overpayment that looks like a plausible number until you
      // read the currency.
      const amountCents = percentOfCents(basis, rule.percentBps)

      return {
        ok: true,
        amountCents,
        snapshot: {
          ruleId: rule.id,
          type: rule.type,
          percentBps: rule.percentBps,
          basis,
          basisLabel: gross ? 'totalRevenueCents' : 'linehaulCents',
          amountCents,
        },
      }
    }

    case 'PER_MILE': {
      if (rule.perMileCents === null) {
        return { ok: false, reason: 'rule_incomplete' }
      }
      // Actual miles if the load has them, dispatched if not. A per-mile load
      // with NEITHER is refused rather than paid zero — zero is a number that
      // looks like an answer.
      const miles = load.actualMiles ?? load.dispatchedMiles
      if (miles === null) return { ok: false, reason: 'no_miles' }

      const amountCents = miles * rule.perMileCents
      return {
        ok: true,
        amountCents,
        snapshot: {
          ruleId: rule.id,
          type: rule.type,
          perMileCents: rule.perMileCents,
          basis: miles,
          basisLabel:
            load.actualMiles === null ? 'dispatchedMiles' : 'actualMiles',
          amountCents,
        },
      }
    }

    case 'FLAT_PER_LOAD': {
      if (rule.flatCents === null) {
        return { ok: false, reason: 'rule_incomplete' }
      }
      return {
        ok: true,
        amountCents: rule.flatCents,
        snapshot: {
          ruleId: rule.id,
          type: rule.type,
          flatCents: rule.flatCents,
          basis: 1,
          basisLabel: 'perLoad',
          amountCents: rule.flatCents,
        },
      }
    }
  }
}

/**
 * Recompute a settlement line's amount from its own stored snapshot.
 *
 * This is what makes "a regenerated settlement reproduces exactly" checkable
 * rather than asserted: the snapshot alone must produce the figure beside it,
 * with no lookup of a rule that may since have changed.
 */
export function amountFromSnapshot(snapshot: PaySnapshot): number {
  switch (snapshot.type) {
    case 'PERCENT_GROSS':
    case 'PERCENT_LINEHAUL':
      return snapshot.percentBps === undefined
        ? Number.NaN
        : percentOfCents(snapshot.basis, snapshot.percentBps)
    case 'PER_MILE':
      return snapshot.perMileCents === undefined
        ? Number.NaN
        : snapshot.basis * snapshot.perMileCents
    case 'FLAT_PER_LOAD':
      return snapshot.flatCents ?? Number.NaN
  }
}

/** A stored snapshot, if it is one. JSON columns come back as `unknown`. */
export function readSnapshot(
  value: Prisma.JsonValue | null,
): PaySnapshot | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const candidate = value as Record<string, unknown>
  if (
    typeof candidate.ruleId !== 'string' ||
    typeof candidate.basis !== 'number' ||
    typeof candidate.amountCents !== 'number' ||
    typeof candidate.type !== 'string' ||
    !isConcretePayRule(candidate.type as PayRuleType)
  ) {
    return null
  }
  return candidate as unknown as PaySnapshot
}

// --- the rules on file ------------------------------------------------------

export type SaveRuleFailure =
  | 'driver_not_found'
  | 'custom_unsupported'
  | 'bad_percent'
  | 'bad_per_mile'
  | 'bad_flat'
  | 'bad_dates'
  | 'overlaps'

export type SaveRuleResult =
  | { ok: true; ruleId: string }
  | { ok: false; reason: SaveRuleFailure }

export interface SaveRuleInput {
  type: PayRuleType
  percentBps?: number | null
  perMileCents?: number | null
  flatCents?: number | null
  effectiveFrom: Date
  effectiveTo?: Date | null
  notes?: string | null
}

export async function saveDriverPayRule(
  tx: TxClient,
  driverId: string,
  input: SaveRuleInput,
): Promise<SaveRuleResult> {
  const driver = await tx.driver.findFirst({
    where: { id: driverId, deletedAt: null },
    select: { id: true, organizationId: true },
  })
  if (!driver) return { ok: false, reason: 'driver_not_found' }

  if (!isConcretePayRule(input.type)) {
    return { ok: false, reason: 'custom_unsupported' }
  }

  // Each type needs exactly its own figure, and the others are cleared rather
  // than left behind — a stale percentBps on a PER_MILE rule is a number that
  // will eventually be read by something.
  const data = {
    percentBps: null as number | null,
    perMileCents: null as number | null,
    flatCents: null as number | null,
  }

  if (input.type === 'PERCENT_GROSS' || input.type === 'PERCENT_LINEHAUL') {
    const bps = input.percentBps
    // 100% of gross to the driver leaves the carrier the fuel bill. It is
    // refused as an obvious keying error; 0 is refused because a rule that
    // pays nothing is a rule somebody forgot to finish.
    if (bps === null || bps === undefined || bps <= 0 || bps > 10_000) {
      return { ok: false, reason: 'bad_percent' }
    }
    data.percentBps = bps
  }

  if (input.type === 'PER_MILE') {
    const cents = input.perMileCents
    if (cents === null || cents === undefined || cents <= 0) {
      return { ok: false, reason: 'bad_per_mile' }
    }
    data.perMileCents = cents
  }

  if (input.type === 'FLAT_PER_LOAD') {
    const cents = input.flatCents
    if (cents === null || cents === undefined || cents <= 0) {
      return { ok: false, reason: 'bad_flat' }
    }
    data.flatCents = cents
  }

  const from = input.effectiveFrom
  const to = input.effectiveTo ?? null
  if (Number.isNaN(from.getTime())) return { ok: false, reason: 'bad_dates' }
  if (to && to.getTime() < from.getTime()) {
    return { ok: false, reason: 'bad_dates' }
  }

  // OVERLAPS ARE REFUSED. Two rules in force on the same day means the pay for
  // that day depends on which row is read first, and the driver finds out on
  // Friday. Closing the previous rule is a deliberate act, below.
  const existing = await tx.driverPayRule.findMany({
    where: { driverId: driver.id },
    select: { id: true, effectiveFrom: true, effectiveTo: true },
  })
  const clashes = existing.some(
    (rule) =>
      rule.effectiveFrom.getTime() <= (to?.getTime() ?? Infinity) &&
      (rule.effectiveTo?.getTime() ?? Infinity) >= from.getTime(),
  )
  if (clashes) return { ok: false, reason: 'overlaps' }

  const created = await tx.driverPayRule.create({
    data: {
      driverId: driver.id,
      organizationId: driver.organizationId,
      type: input.type,
      ...data,
      effectiveFrom: from,
      effectiveTo: to,
      notes: input.notes?.trim() || null,
    },
    select: { id: true },
  })

  return { ok: true, ruleId: created.id }
}

/**
 * Close the open rule the day before a new one starts.
 *
 * The way a raise is recorded: the old rule stops, the new one begins, and
 * every settlement already generated keeps the figure it was generated with.
 */
export async function closePayRule(
  tx: TxClient,
  ruleId: string,
  effectiveTo: Date,
): Promise<{ ok: boolean }> {
  const rule = await tx.driverPayRule.findFirst({
    where: { id: ruleId },
    select: { id: true, effectiveFrom: true },
  })
  if (!rule) return { ok: false }
  if (effectiveTo.getTime() < rule.effectiveFrom.getTime()) return { ok: false }

  await tx.driverPayRule.update({
    where: { id: rule.id },
    data: { effectiveTo },
  })
  return { ok: true }
}

export interface PayRuleRow extends PayRule {
  notes: string | null
  /** True where this rule covers today. */
  isCurrent: boolean
}

export async function payRulesFor(
  tx: TxClient,
  driverId: string,
  now: Date = new Date(),
): Promise<PayRuleRow[]> {
  const rules = await tx.driverPayRule.findMany({
    where: { driverId },
    orderBy: { effectiveFrom: 'desc' },
    select: {
      id: true,
      type: true,
      percentBps: true,
      perMileCents: true,
      flatCents: true,
      effectiveFrom: true,
      effectiveTo: true,
      notes: true,
    },
  })

  const current = ruleInForce(rules, now)
  return rules.map((rule) => ({ ...rule, isCurrent: rule.id === current?.id }))
}
