import type { Report } from '@/lib/by-company'

interface Props {
  report: Report
  /** Which number the bars are drawn from. */
  measure: 'gross' | 'afterDriverPay'
  /** Null is All companies. */
  companyId: string | null
  labels: { unknown: string }
  format: (cents: number) => string
}

/**
 * One group per period, one bar per company.
 *
 * ── INLINE SVG, NO LIBRARY ───────────────────────────────────────────────
 *
 * The page is read-only and the chart is bars against a baseline. A charting
 * dependency would add a client bundle to a server-rendered report that has no
 * interaction in it, and every colour would then come from somebody else's
 * palette rather than the token block.
 *
 * ── A PERIOD WITH NO KNOWN PAY DRAWS NOTHING ─────────────────────────────
 *
 * When the measure is "after driver pay" and the period predates Zebra's first
 * FINAL batch, the figure is unknown — so the slot is left EMPTY and hatched
 * rather than drawn at zero. A zero-height bar and a bar for zero dollars look
 * identical, and one of them is a lie about what the freight cost to drive.
 */
export function PeriodChart({
  report,
  measure,
  companyId,
  labels,
  format,
}: Props) {
  const periods = report.periods
  if (periods.length === 0) return null

  const valueOf = (cell: {
    grossCents: number
    afterDriverPayCents: number | null
  }) => (measure === 'gross' ? cell.grossCents : cell.afterDriverPayCents)

  const rowsFor = (period: (typeof periods)[number]) =>
    companyId === null
      ? period.companies
      : period.companies.filter((c) => c.companyId === companyId)

  const values = periods.flatMap((period) =>
    rowsFor(period)
      .map((cell) => valueOf(cell))
      .filter((v): v is number => v !== null),
  )
  const peak = Math.max(1, ...values)

  const HEIGHT = 160
  const GROUP_GAP = 14
  const BAR = 14
  const widthOf = (period: (typeof periods)[number]) =>
    Math.max(BAR, rowsFor(period).length * (BAR + 2))
  const totalWidth = periods.reduce(
    (sum, period) => sum + widthOf(period) + GROUP_GAP,
    0,
  )

  // A stable colour per authority, from the token block by index.
  const TONE = ['fill-accent', 'fill-info', 'fill-success', 'fill-warning']

  // WHERE EACH GROUP STARTS, WORKED OUT BEFORE ANYTHING IS DRAWN. A running
  // offset mutated inside the map is a render that depends on the order React
  // happens to call it in, which the lint rule refuses and is right to.
  const offsets = periods.reduce<number[]>((acc, period, index) => {
    const previous = acc[index - 1] ?? 0
    const previousWidth =
      index === 0 ? 0 : widthOf(periods[index - 1]!) + GROUP_GAP
    acc.push(previous + previousWidth)
    return acc
  }, [])

  return (
    <div className="overflow-x-auto">
      <svg
        role="img"
        aria-label="Bars per period, one per company"
        width={Math.max(totalWidth, 320)}
        height={HEIGHT + 28}
        className="min-w-full"
      >
        {periods.map((period, groupIndex) => {
          const rows = rowsFor(period)
          const groupX = offsets[groupIndex] ?? 0
          return (
            <g key={period.periodStart.toISOString()}>
              {rows.map((cell, index) => {
                const value = valueOf(cell)
                const left = groupX + index * (BAR + 2)
                if (value === null) {
                  // UNKNOWN, NOT ZERO. Hatched so it reads as absent.
                  return (
                    <rect
                      key={cell.companyId}
                      x={left}
                      y={HEIGHT - 6}
                      width={BAR}
                      height={6}
                      className="fill-border"
                    >
                      <title>{`${cell.companyName}: ${labels.unknown}`}</title>
                    </rect>
                  )
                }
                const height = Math.max(1, Math.round((value / peak) * HEIGHT))
                return (
                  <rect
                    key={cell.companyId}
                    x={left}
                    y={HEIGHT - height}
                    width={BAR}
                    height={height}
                    className={TONE[index % TONE.length]}
                  >
                    <title>{`${cell.companyName}: ${format(value)}`}</title>
                  </rect>
                )
              })}
              <text
                x={groupX}
                y={HEIGHT + 18}
                className="fill-ink-subtle text-[10px]"
              >
                {period.periodStart.toISOString().slice(5, 10)}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
