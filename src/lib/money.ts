// ---------------------------------------------------------------------------
// MONEY. THE ONLY MODULE ALLOWED TO ROUND.
//
// Standing rule 9-money: every computed figure on a screen must be
// reproducible from stored integers by a reader; no float ever touches a
// calculation; rounding is documented once, here.
//
// WHY PARSING IS DONE WITH STRINGS. Measured on this machine, not recalled:
// `Number('19.99') * 100` is 1998.9999999999998, `Number('4.35') * 100` is
// 434.99999999999994. `Math.round` hides both, until a value where it does
// not. (1234.56 multiplies out exactly, which is why it is a bad example and
// was the first one I reached for.) There is no float in this file: a
// decimal string is split at the point, the fraction is padded or truncated to
// two places, and the two halves are combined with integer arithmetic.
//
// WHERE ROUNDING ACTUALLY HAPPENS. Exactly one place: `multiplyCents`, used
// where a quantity meets a unit price — `InvoiceLine.quantity` is a
// Decimal(10,2) and 2.5 hours of detention at $65.00 is a real thing to bill.
// It rounds HALF UP on the absolute value, so 0.5 cents becomes 1 cent whether
// the amount is positive or negative, and a credit does not quietly round the
// other way from the charge it reverses.
//
// Half-up rather than banker's rounding: an invoice line is read by a broker's
// clerk with a calculator, and "0.5 always goes up" is the rule they will
// apply. Being consistent with the person checking the number matters more
// than the third-decimal-place bias that banker's rounding exists to avoid.
// ---------------------------------------------------------------------------

export class MoneyFormatError extends Error {
  constructor(readonly value: string) {
    super(`Not an amount: ${JSON.stringify(value)}`)
    this.name = 'MoneyFormatError'
  }
}

/**
 * A typed amount — "1,234.56", "$1234.5", "-40" — as integer cents.
 *
 * Accepts what a dispatcher types: currency symbol, thousands separators,
 * surrounding space, a leading minus. Refuses everything else rather than
 * guessing, because a rate that silently parses to 0 is worse than a rate that
 * refuses to save.
 */
export function parseMoneyToCents(input: string): number {
  const cleaned = input.trim().replace(/[$\s,]/g, '')
  if (cleaned === '') throw new MoneyFormatError(input)

  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(cleaned)
  if (!match) throw new MoneyFormatError(input)

  const [, sign, whole = '', fraction = ''] = match
  if (whole === '' && fraction === '') throw new MoneyFormatError(input)

  // Two places, padded or truncated. Truncated rather than rounded: a third
  // decimal in a typed rate is a typo, and inventing a cent from it would be
  // this module deciding something the person did not.
  const cents = `${fraction}00`.slice(0, 2)
  const amount = Number.parseInt(`${whole || '0'}${cents}`, 10)
  if (!Number.isSafeInteger(amount)) throw new MoneyFormatError(input)

  return sign === '-' ? -amount : amount
}

/** Integer cents to a plain decimal string. No symbol, no separators. */
export function centsToInput(cents: number): string {
  const negative = cents < 0
  const absolute = Math.abs(cents)
  const whole = Math.trunc(absolute / 100)
  const fraction = String(absolute % 100).padStart(2, '0')
  return `${negative ? '-' : ''}${whole}.${fraction}`
}

/**
 * A quantity times a unit price, in cents.
 *
 * `quantity` arrives as a decimal STRING — never a float — because that is
 * what `Decimal(10,2)` is and what a form posts. Two decimal places, so the
 * product is exact in hundredths of a cent and the only rounding is the final
 * step to whole cents.
 *
 *   2.5 × $65.00  ->  250 × 6500 = 1_625_000 hundredths -> 16250 cents
 *   3 × $16.67    ->  300 × 1667 =   500_100 hundredths ->  5001 cents
 *   0.333 × $1.00 ->   33 × 100  =     3_300 hundredths ->    33 cents
 */
export function multiplyCents(quantity: string, unitCents: number): number {
  const hundredths = parseQuantityToHundredths(quantity) * unitCents
  const negative = hundredths < 0
  const absolute = Math.abs(hundredths)
  // Half up on the absolute value, so a credit rounds the mirror of its charge.
  const rounded = Math.trunc((absolute + 50) / 100)
  return negative ? -rounded : rounded
}

/** A quantity string as an integer number of hundredths. No float. */
export function parseQuantityToHundredths(quantity: string): number {
  const cleaned = quantity.trim().replace(/[\s,]/g, '')
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(cleaned)
  if (!match || cleaned === '') throw new MoneyFormatError(quantity)

  const [, sign, whole = '', fraction = ''] = match
  if (whole === '' && fraction === '') throw new MoneyFormatError(quantity)

  const hundredths = Number.parseInt(
    `${whole || '0'}${`${fraction}00`.slice(0, 2)}`,
    10,
  )
  if (!Number.isSafeInteger(hundredths)) throw new MoneyFormatError(quantity)
  return sign === '-' ? -hundredths : hundredths
}

/**
 * A typed percentage — "3", "3.25", "97 %" — as integer basis points.
 *
 * Schema convention 2: percentages are basis points, so 3% is 300 and 27.5% is
 * 2750. Two decimal places is exactly the precision basis points hold, and a
 * third is truncated for the same reason a third decimal on a rate is: it is a
 * typo, and rounding it would be this module deciding something the person
 * typing did not.
 *
 * Refuses a negative. There is no negative advance rate and no negative fee;
 * the one place a minus belongs in factoring is a credit, and a credit is an
 * amount rather than a rate.
 */
export function parsePercentToBps(input: string): number {
  // The percent sign is stripped from the ENDS only, never from between the
  // digits. Measured: stripping it everywhere turns "3%4" — a stray keystroke
  // — into 34%, which is a plausible rate and therefore exactly the kind of
  // silently wrong number this phase exists to prevent.
  const cleaned = input
    .replace(/[\s,]/g, '')
    .replace(/^%+/, '')
    .replace(/%+$/, '')
  if (cleaned === '') throw new MoneyFormatError(input)

  const match = /^(\d*)(?:\.(\d*))?$/.exec(cleaned)
  if (!match) throw new MoneyFormatError(input)

  const [, whole = '', fraction = ''] = match
  if (whole === '' && fraction === '') throw new MoneyFormatError(input)

  const bps = Number.parseInt(
    `${whole || '0'}${`${fraction}00`.slice(0, 2)}`,
    10,
  )
  if (!Number.isSafeInteger(bps)) throw new MoneyFormatError(input)
  return bps
}

/** Basis points as a plain percentage string. No symbol. Trailing zeros cut. */
export function bpsToInput(bps: number): string {
  const whole = Math.trunc(bps / 100)
  const fraction = String(Math.abs(bps) % 100).padStart(2, '0')
  return fraction === '00' ? String(whole) : `${whole}.${fraction}`
}

/**
 * What a load is worth: the three stored integers, added.
 *
 * A separate function so the screen and the invoice generator cannot drift —
 * §7 requires a reader to reproduce any displayed figure from stored integers,
 * and that is only true if one expression produces it everywhere.
 */
export function loadRevenueCents(parts: {
  linehaulCents: number
  fuelSurchargeCents: number
  accessorialsCents: number
}): number {
  return (
    parts.linehaulCents + parts.fuelSurchargeCents + parts.accessorialsCents
  )
}

/**
 * Cents as currency, for display only.
 *
 * The ONE place a division by 100 is allowed, and it happens after every
 * calculation is finished — `Intl.NumberFormat` needs a Number and there is no
 * way around that. Never feed the result back into arithmetic: the integer is
 * the value, this is a rendering of it.
 *
 * Design system §8: minus sign, never parentheses. `signDisplay: 'auto'` gives
 * "-$40.00"; accounting notation would give "($40.00)", which reads as a
 * footnote on a dense screen.
 */
export function formatCents(cents: number, locale?: string): string {
  return (cents / 100).toLocaleString(locale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * Split an amount across weights so the parts sum to EXACTLY the amount.
 *
 * A factoring fee is charged once on an invoice and has to land on the loads
 * that invoice covers, because per-load profitability is the number the owner
 * actually steers by. Three loads sharing a $150.75 fee cannot each take a
 * third: 5025 is not divisible by three in cents, and three roundings that
 * each look right leave a cent that belongs to nobody.
 *
 * LARGEST REMAINDER. Each part takes its floor, then the leftover cents go one
 * each to the parts with the largest fractional remainders, ties broken by
 * position so the result is deterministic — the same invoice apportions the
 * same way every time it is recomputed, which is what makes the drift check
 * meaningful rather than noisy.
 *
 *   apportionCents(15075, [245000, 190000, 162500])
 *     exact shares: 6181.27..., 4792.98..., 4100.74...
 *     floors:       6181 + 4792 + 4100 = 15073, leftover 2
 *     largest remainders: .98 (second), .74 (third)
 *     result:       [6181, 4793, 4101]  ->  sums to 15075
 *
 * Zero total gives zeros. Zero weights give the whole amount to the first
 * part rather than throwing: an invoice whose loads somehow total nothing is a
 * data problem, and losing the fee would hide it.
 */
export function apportionCents(
  totalCents: number,
  weights: readonly number[],
): number[] {
  if (weights.length === 0) return []
  if (totalCents === 0) return weights.map(() => 0)

  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0)
  if (weightTotal === 0) {
    return weights.map((_, index) => (index === 0 ? totalCents : 0))
  }

  // Integer arithmetic throughout: `share` is the exact numerator and the
  // remainder is compared without ever forming a fraction.
  const parts = weights.map((weight) => {
    const numerator = totalCents * weight
    return {
      floor: Math.floor(numerator / weightTotal),
      remainder: numerator % weightTotal,
    }
  })

  const distributed = parts.reduce((sum, part) => sum + part.floor, 0)
  let leftover = totalCents - distributed

  const order = parts
    .map((part, index) => ({ index, remainder: part.remainder }))
    // Largest remainder first; position breaks a tie, so the split is stable.
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)

  const result = parts.map((part) => part.floor)
  for (const { index } of order) {
    if (leftover <= 0) break
    result[index] = (result[index] ?? 0) + 1
    leftover -= 1
  }

  return result
}

/**
 * What a factor advances, charges and holds back.
 *
 * All three from the invoice total and two rates in basis points, so a reader
 * can check any of them against the others: advance + fee + reserve == total,
 * always, by construction rather than by hope.
 */
export function factoringSplit(
  totalCents: number,
  advanceRateBps: number,
  feeBps: number,
): { advanceCents: number; feeCents: number; reserveCents: number } {
  const advanceCents = Math.round((totalCents * advanceRateBps) / 10_000)
  const feeCents = Math.round((totalCents * feeBps) / 10_000)
  // The reserve is what is LEFT, not a third independent rounding — that is
  // what keeps the three summing to the total exactly.
  return {
    advanceCents,
    feeCents,
    reserveCents: totalCents - advanceCents - feeCents,
  }
}
