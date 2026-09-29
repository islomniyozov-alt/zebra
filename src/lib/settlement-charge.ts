import type { Prisma } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// QUANTITY AND RATE ON A MANUALLY ADDED LINE.
//
// TMS-DESIGN-SYSTEM §6.2.2: the workbench's add-row is Type, Amount, Quantity,
// Total, Description — and THE TOTAL IS COMPUTED AND NEVER TYPED. ST-005562
// prints the same three columns on its Deductions table: `1`, `$50.00`,
// `($50.00)`.
//
// ── WHY THIS LIVES IN `payRuleSnapshot` AND NOT IN TWO NEW COLUMNS ────────
//
// Two columns would be a migration, and the migration is held until production
// dispatches (owner's ruling, 2026-09-29). But this is not a workaround
// squeezed into the nearest Json column either: `payRuleSnapshot` is
// documented in the schema as "how the amount was reached — the rule, the
// basis, the result", and for a hand-entered charge the rate and the quantity
// ARE how the amount was reached. It is the same question with a different
// answer.
//
// AND IT IS FROZEN, which is the property that matters. A rate stored beside
// its total cannot drift from it, because nothing recomputes either one after
// the line is written.
//
// ── IT CANNOT COLLIDE WITH A PAY-RULE SNAPSHOT ────────────────────────────
//
// `readSnapshot` requires `ruleId`, `basis`, `amountCents` and a concrete
// `type`, and returns null for anything else — so a charge snapshot reads as
// "no pay rule", which is exactly what it is, and `basisSentence` renders the
// empty string for it. The two readers are disjoint by construction rather
// than by agreement, and `kind` is checked here so a future third shape cannot
// be mistaken for this one.
// ---------------------------------------------------------------------------

export const CHARGE_SNAPSHOT_KIND = 'manualCharge'

/** The most quantity anybody enters by hand. Above this it is a typo. */
export const MAX_QUANTITY = 10_000

/**
 * The index signature is there for Prisma, not for callers.
 *
 * `InputJsonObject` requires one before a typed object may be written to a
 * `Json` column. Without it the write needs a cast, and a cast at the write
 * site is exactly where a shape change would stop being type-checked — which
 * on this column means a rate and a total that no longer agree.
 */
export interface ChargeSnapshot {
  kind: typeof CHARGE_SNAPSHOT_KIND
  /** The per-unit figure, POSITIVE. The sign belongs to the line's type. */
  rateCents: number
  quantity: number
  [key: string]: string | number
}

/**
 * THE ONE PLACE THE TOTAL IS COMPUTED.
 *
 * Both the screen's preview and the write go through this, so a total the
 * reader saw before pressing Add cannot differ from the one that lands.
 */
export function chargeTotalCents(rateCents: number, quantity: number): number {
  return rateCents * quantity
}

export function chargeSnapshot(
  rateCents: number,
  quantity: number,
): ChargeSnapshot {
  return { kind: CHARGE_SNAPSHOT_KIND, rateCents, quantity }
}

/**
 * A quantity is a whole number of things, at least one.
 *
 * FRACTIONAL QUANTITIES ARE REFUSED rather than rounded. `2.5 × $50.00` is
 * $125.00 and no part of that is wrong, but a rate entered as a quantity — the
 * actual mistake, `$1 × 49.27` for a fuel line — produces a plausible total
 * from two wrong factors. Gallons belong to `FuelTransaction`, which stores
 * them as a decimal for exactly this reason.
 */
export function isValidQuantity(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_QUANTITY
}

/** Null for a pay-rule snapshot, for null, and for anything unrecognised. */
export function readCharge(
  value: Prisma.JsonValue | null,
): ChargeSnapshot | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const candidate = value as Record<string, unknown>
  if (
    candidate.kind !== CHARGE_SNAPSHOT_KIND ||
    typeof candidate.rateCents !== 'number' ||
    typeof candidate.quantity !== 'number' ||
    !isValidQuantity(candidate.quantity)
  ) {
    return null
  }
  return {
    kind: CHARGE_SNAPSHOT_KIND,
    rateCents: candidate.rateCents,
    quantity: candidate.quantity,
  }
}
