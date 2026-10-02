import { formatCents } from '@/lib/money'
import type { WeekPoint } from '@/lib/dashboard-kpis'

// ---------------------------------------------------------------------------
// THIRTEEN WEEKS OF GROSS, AS BARS. Dashboard part 2.
//
// ── SERVER-RENDERED SVG. NO LIBRARY, NO CLIENT JS, NO ANIMATION ──────────
//
// §14 forbids "charts that animate on every render" — not charts. The cheapest
// way to obey that is to have nothing that could animate: this is inline SVG
// computed on the server, so it arrives drawn. No chart library, which also
// means no CDN script and nothing added to the bundle for one panel.
//
// ── A BAR THAT IS NOT DRAWN IS A WEEK THAT EARNED NOTHING ────────────────
//
// `dashboardFor` returns thirteen points INCLUDING the empty ones, which is
// the whole reason it takes the weeks as an argument. So a quiet week is a
// baseline tick rather than a gap, and the axis has thirteen labels whatever
// the freight did — a chart that silently plotted eleven points across
// thirteen weeks would read as a business with a quiet fortnight.
//
// ── DRIVER PAY IS A SECOND BAR, AND ABSENT IS NOT ZERO ───────────────────
//
// `driverPayCents` is null for any week before Zebra was settling. A zero-height
// pay bar would say that week's freight cost nothing to drive — the most
// expensive wrong number on this page, per §6.1.1 — so those weeks draw the
// gross bar alone and are HATCHED to say the comparison is unavailable rather
// than unfavourable.
//
// ── IT IS READABLE WITHOUT SEEING IT ────────────────────────────────────
//
// §13's floor. The figures are a real table, visually hidden: a screen reader
// gets thirteen rows of numbers rather than `role="img"` and a sentence
// summarising what it cannot inspect. The SVG itself is `aria-hidden` for the
// same reason — it is a second rendering of the table beside it, not the
// content.
// ---------------------------------------------------------------------------

interface Props {
  weeks: readonly WeekPoint[]
  locale: string
  labels: {
    heading: string
    week: string
    gross: string
    afterDriverPay: string
    notSettled: string
  }
}

/** Geometry. Fixed, because an SVG that measured itself would need client JS. */
const WIDTH = 720
const HEIGHT = 160
const PAD_BOTTOM = 18
const GAP = 4

export function WeekBars({ weeks, locale, labels }: Props) {
  // THE SCALE IS GROSS ONLY, so the pay bars sit inside it comparably. Scaling
  // each series to its own maximum would draw a $30k pay bar as tall as a
  // $100k gross bar and invite exactly the misreading the panel exists to
  // prevent.
  const peak = weeks.reduce((high, week) => Math.max(high, week.grossCents), 0)
  const slot = weeks.length === 0 ? WIDTH : WIDTH / weeks.length
  const barWidth = Math.max(2, slot - GAP)
  const plot = HEIGHT - PAD_BOTTOM

  // A FLAT BASELINE WHEN NOTHING WAS EARNED, not a division by zero. Thirteen
  // ticks on an axis is a true picture of a quarter with no freight in it.
  const height = (cents: number) =>
    peak <= 0 ? 0 : Math.round((cents / peak) * (plot - 2))

  const day = (value: Date) => value.toISOString().slice(0, 10)

  return (
    <div>
      <h3 className="text-sm font-medium text-ink">{labels.heading}</h3>

      <svg
        aria-hidden
        viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
        className="mt-z2 h-[160px] w-full"
        preserveAspectRatio="none"
      >
        {/* THE BASELINE, ALWAYS. Without it an empty quarter renders as blank
         * space, which reads as a broken panel rather than a quiet one. */}
        <line
          x1={0}
          y1={plot}
          x2={WIDTH}
          y2={plot}
          stroke="var(--color-border-strong)"
          strokeWidth={1}
        />

        {/* THE HATCH FOR WEEKS WHOSE DRIVER PAY IS UNKNOWN. Declared once. */}
        <defs>
          <pattern
            id="zebra-unsettled"
            width={4}
            height={4}
            patternTransform="rotate(45)"
            patternUnits="userSpaceOnUse"
          >
            <line
              x1={0}
              y1={0}
              x2={0}
              y2={4}
              stroke="var(--color-border-strong)"
              strokeWidth={1}
            />
          </pattern>
        </defs>

        {weeks.map((week, index) => {
          const x = index * slot + GAP / 2
          const grossHeight = height(week.grossCents)
          const payHeight =
            week.driverPayCents === null ? 0 : height(week.driverPayCents)
          return (
            <g key={day(week.weekStart)}>
              <rect
                x={x}
                y={plot - grossHeight}
                width={barWidth}
                height={grossHeight}
                fill="var(--color-accent)"
                opacity={week.driverPayCents === null ? 0.45 : 1}
              />
              {/* UNKNOWN PAY IS HATCHED OVER THE GROSS BAR, so the eye reads
               * "we cannot compare this week" rather than "this week cost
               * nothing". */}
              {week.driverPayCents === null && grossHeight > 0 ? (
                <rect
                  x={x}
                  y={plot - grossHeight}
                  width={barWidth}
                  height={grossHeight}
                  fill="url(#zebra-unsettled)"
                />
              ) : null}
              {week.driverPayCents === null ? null : (
                <rect
                  x={x}
                  y={plot - payHeight}
                  width={barWidth}
                  height={payHeight}
                  fill="var(--color-ink-3)"
                />
              )}
            </g>
          )
        })}
      </svg>

      {/* ── THE SAME FIGURES, FOR A READER WHO CANNOT SEE THE BARS ──────── */}
      <table className="sr-only">
        <caption>{labels.heading}</caption>
        <thead>
          <tr>
            <th scope="col">{labels.week}</th>
            <th scope="col">{labels.gross}</th>
            <th scope="col">{labels.afterDriverPay}</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={day(week.weekStart)}>
              <th scope="row">{day(week.weekStart)}</th>
              <td>{formatCents(week.grossCents, locale)}</td>
              <td>
                {week.marginCents === null
                  ? labels.notSettled
                  : formatCents(week.marginCents, locale)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* FIRST AND LAST ONLY. Thirteen dates across 720px overlap into a grey
       * smear; the ends say which quarter this is and the table says the rest. */}
      {weeks.length > 0 ? (
        <div className="mt-z1 flex justify-between font-mono text-xs text-ink-3">
          <span dir="ltr">{day(weeks[0]!.weekStart)}</span>
          <span dir="ltr">{day(weeks.at(-1)!.weekStart)}</span>
        </div>
      ) : null}
    </div>
  )
}
