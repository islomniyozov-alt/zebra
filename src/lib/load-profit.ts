// ---------------------------------------------------------------------------
// THE PROFIT BOX ON AN AMAZON LOAD (§7.13) — STORED FIGURES, ONE SUBTRACTION.
//
// No new money rule. Revenue is the load's stored total, accessorials its
// stored accessorial figure, driver pay the pay on its statement lines as the
// settlement engine already wrote them. Gross profit is revenue less driver
// pay, and margin is that over revenue in integer basis points.
//
// UNKNOWN DRIVER PAY IS NOT ZERO. Before a statement is finalised there is no
// pay figure, and a profit computed against zero would print the whole revenue
// as profit — the confident wrong number `dashboard-kpis.ts` refuses for the
// same reason. So both derived figures are null until pay is known.
// ---------------------------------------------------------------------------

export interface ProfitBox {
  revenueCents: number
  accessorialsCents: number
  driverPayCents: number | null
  grossProfitCents: number | null
  /** Integer basis points; null when pay is unknown or revenue is zero. */
  marginBp: number | null
}

/** Basis points as a percentage with one decimal: 2500 → "25.0%". */
export function formatBp(bp: number, locale?: string): string {
  return (bp / 10_000).toLocaleString(locale, {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
}

export function profitBox(load: {
  totalRevenueCents: number
  accessorialsCents: number
  /** Null when no finalised statement carries this load yet. */
  driverPayCents: number | null
}): ProfitBox {
  const { totalRevenueCents, accessorialsCents, driverPayCents } = load
  const grossProfitCents =
    driverPayCents === null ? null : totalRevenueCents - driverPayCents
  const marginBp =
    grossProfitCents === null || totalRevenueCents === 0
      ? null
      : Math.round((grossProfitCents * 10_000) / totalRevenueCents)
  return {
    revenueCents: totalRevenueCents,
    accessorialsCents,
    driverPayCents,
    grossProfitCents,
    marginBp,
  }
}
