/**
 * THE HATCH: surface-coloured stripes over the accent gross bar, so the pay
 * slot reads as "part of this bar, unrecorded" rather than as a third series.
 * One string, drawn on the bar by `BarChart` and on the swatch here, so the
 * legend shows exactly what the bar shows. It lives here and not in BarChart
 * because BarChart imports the legend — the other direction would be a cycle.
 */
export const HATCH =
  'repeating-linear-gradient(45deg, var(--color-surface) 0 1px, transparent 1px 4px)'

// ---------------------------------------------------------------------------
// THE LEGEND. IN WORDS, ON EVERY CHART. §6.1.1, owner's review 2026-10-02.
// UNDER THE X AXIS since the second-round review of 2026-11-06, on the charts
// that carry a value above their bars — the caller places it; this draws it.
//
// "No chart ships without one." The charts shipped with a hatch pattern and no
// sentence explaining it, so a reader met a striped bar and had to infer that
// striping meant the driver pay was unrecorded rather than zero — which is
// exactly the inference the hatch exists to prevent them making.
//
// ── IT IS A COMPONENT SO IT CANNOT BE FORGOTTEN TWICE ────────────────────
//
// Three charts needing the same three sentences is three places to omit one.
// `tests/dashboard-charts.test.tsx` asserts every chart renders it.
// ---------------------------------------------------------------------------

interface Props {
  labels: {
    gross: string
    driverPay: string
    /** "driver pay not yet recorded in Zebra" — the hatch, said out loud. */
    unrecorded: string
  }
  /** Omit the pay entries where a chart has no pay series — loads per day. */
  moneyOnly?: boolean
}

export function ChartLegend({ labels, moneyOnly = true }: Props) {
  return (
    <ul className="mt-z2 flex flex-wrap items-center gap-x-z4 gap-y-z1 text-xs text-ink-2">
      <li className="flex items-center gap-z2">
        <span aria-hidden className="h-z2 w-z3 rounded-[2px] bg-accent" />
        {labels.gross}
      </li>
      {moneyOnly ? (
        <>
          <li className="flex items-center gap-z2">
            <span
              aria-hidden
              className="h-z2 w-z3 rounded-[2px]"
              style={{ backgroundColor: 'var(--color-ink-3)' }}
            />
            {labels.driverPay}
          </li>
          <li className="flex items-center gap-z2">
            {/* THE SWATCH CARRIES THE SAME HATCH THE BAR DOES — the same
             * stripes over the same accent (§6.1.1, 2026-11-06: the hatch is
             * the pay slot inside the solid gross bar, so the swatch is a
             * piece of that bar). A repeating gradient: no image, no SVG. */}
            <span
              aria-hidden
              className="h-z2 w-z3 rounded-[2px] bg-accent"
              style={{ backgroundImage: HATCH }}
            />
            {labels.unrecorded}
          </li>
        </>
      ) : null}
    </ul>
  )
}
