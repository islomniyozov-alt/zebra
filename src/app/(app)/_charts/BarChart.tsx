import { formatCents } from '@/lib/money'
import { ChartLegend } from './ChartLegend'

// ---------------------------------------------------------------------------
// THE BAR CHART. HTML AND CSS. §6.1.1 as amended 2026-10-02.
//
// Owner's review of the SVG version, all four points: no legend, no value on
// the bar, no label under it, no gridlines, and a native `<title>` for a
// tooltip. Each of those is a layout problem, and HTML does layout.
//
// ── WHY NOT SVG ANY MORE ─────────────────────────────────────────────────
//
// The SVG version placed text at computed coordinates — one calculation per
// value label, one per axis label, one per gridline, one per tick — and still
// could not style the tooltip, because `<title>` is the browser's and arrives
// after a second-long delay, unstyled, and never on touch. Four hand-placed
// text layers is four chances to be a pixel out; a flex column is none.
//
// STILL NO CLIENT JAVASCRIPT AND STILL NOTHING THAT CAN ANIMATE (§14). The
// tooltip is a sibling revealed by `group-hover`, which is CSS.
//
// ── THE SCALE IS GROSS, AND PAY SITS INSIDE IT ───────────────────────────
//
// Both series share one axis so they are comparable. Scaling each to its own
// maximum would draw a $30k pay bar as tall as a $100k gross bar, which is the
// misreading the chart exists to prevent.
//
// ── A BUCKET WITH UNKNOWN PAY IS HATCHED, NOT ZEROED ─────────────────────
//
// `driverPayCents` is null before Zebra was settling. A zero-height pay bar
// would say that freight cost nothing to drive — §6.1.1 calls it the most
// expensive wrong number on the page — so the gross bar is hatched instead and
// the legend says what the hatch means.
// ---------------------------------------------------------------------------

export interface Bar {
  key: string
  /** Under the bar: "Sep 20" for a week, "Oct 2" for a day. */
  label: string
  /** In the tooltip: the full date or week range. */
  detail: string
  grossCents: number
  /** Null means NOT RECORDED, which is why it is not zero. */
  driverPayCents: number | null
  marginCents: number | null
  /**
   * NULL MEANS THIS REPORT DOES NOT COUNT LOADS, and the tooltip then leaves
   * the row out entirely.
   *
   * Zero would be a figure, and a wrong one: §6.2.7's by-company chart is built
   * from item 7's readers, which group MONEY by authority and period and have
   * never counted loads. "Loads 0" beside a week of real gross is the kind of
   * number somebody repeats in a meeting.
   */
  loads: number | null
  /**
   * The current bucket, still running. Always the last one.
   *
   * ── DRAWN, BUT MARKED ───────────────────────────────────────────────────
   *
   * Owner's ruling 2026-10-02: the window ends with the current settlement week
   * and that week is drawn as far as today. So the last bar is SHORT BECAUSE
   * THE WEEK IS UNFINISHED, and a reader comparing it to the twelve beside it
   * sees a decline that did not happen.
   *
   * It is not hidden — the freight is real and belongs in the total — and it is
   * not left to look like the others. Hatched edge, dimmed, and the tooltip
   * says the week is still running. Same family of lie as a zero-height
   * driver-pay bar, same treatment.
   *
   * THIS REPLACED `future`, which marked buckets that had not happened at all.
   * A rolling window never reaches past today, so there is nothing left to
   * mark that way and the flag would have been unreachable.
   */
  partial?: boolean
}

interface Props {
  bars: readonly Bar[]
  locale: string
  labels: {
    heading: string
    gross: string
    driverPay: string
    unrecorded: string
    afterDriverPay: string
    loads: string
    empty: string
    bucket: string
    /** Said on the current bucket's tooltip: the week is unfinished. */
    partial: string
  }
}

/** How many gridlines, including the top. Four reads as a scale, nine as graph paper. */
const TICKS = 4

/**
 * `$12.4k`, which is what the ruling asked for above each bar.
 *
 * ABBREVIATED HERE AND ONLY HERE. §8 wants money in full everywhere a figure is
 * read or quoted; a bar label is neither — it is a magnitude, forty of them sit
 * side by side, and `$12,431.77` above a 24-pixel bar is unreadable at any
 * density. The tooltip and the hidden table both carry the exact figure.
 */
function compact(cents: number, locale: string): string {
  const dollars = cents / 100
  if (Math.abs(dollars) >= 1_000_000) {
    return `$${(dollars / 1_000_000).toFixed(1)}m`
  }
  if (Math.abs(dollars) >= 1_000) return `$${(dollars / 1_000).toFixed(1)}k`
  return formatCents(cents, locale)
}

export function BarChart({ bars, locale, labels }: Props) {
  const peak = bars.reduce((high, bar) => Math.max(high, bar.grossCents), 0)

  // THE TICKS EXIST EVEN WHEN THE PERIOD IS EMPTY (§6.1.1, owner's review): a
  // blank panel is indistinguishable from a broken one. With no freight the
  // scale runs 0 to 0 and the axis still draws, labelled $0.
  const ticks = Array.from({ length: TICKS + 1 }, (_, index) => {
    const fraction = index / TICKS
    return { fraction, cents: Math.round(peak * fraction) }
  }).reverse()

  const height = (cents: number) => (peak <= 0 ? 0 : (cents / peak) * 100)

  const legend = (
    <ChartLegend
      labels={{
        gross: labels.gross,
        driverPay: labels.driverPay,
        unrecorded: labels.unrecorded,
      }}
    />
  )

  return (
    <div>
      <h3 className="text-sm font-medium text-ink">{labels.heading}</h3>
      {legend}

      {/* THE EMPTY CASE KEEPS THE AXIS AND THE LEGEND and says what is absent.
       * Never a blank panel, never "No data available" (§14). */}
      {bars.length === 0 ? (
        <p className="mt-z3 text-sm text-ink-3">{labels.empty}</p>
      ) : null}

      <div className="mt-z3 flex gap-z2">
        {/* ── THE Y AXIS: MONEY TICKS, TOP DOWN ──────────────────────── */}
        <ul className="flex h-[180px] w-[52px] shrink-0 flex-col justify-between text-end font-mono text-xs text-ink-3">
          {ticks.map((tick) => (
            <li key={tick.fraction}>{compact(tick.cents, locale)}</li>
          ))}
        </ul>

        <div className="min-w-0 flex-1">
          {/* THE PLOT. Gridlines behind, bars in front. */}
          <div className="relative h-[180px]">
            {ticks.map((tick) => (
              <span
                key={tick.fraction}
                aria-hidden
                className="absolute inset-x-0 border-t border-border"
                style={{ bottom: `${String(tick.fraction * 100)}%` }}
              />
            ))}

            <ol className="absolute inset-0 flex items-end gap-[2px]">
              {bars.map((bar) => {
                const unknown = bar.driverPayCents === null
                return (
                  <li
                    key={bar.key}
                    className="group relative flex h-full min-w-0 flex-1 items-end justify-center"
                  >
                    {/* THE VALUE, ABOVE THE BAR. Owner's review. */}
                    <span className="pointer-events-none absolute inset-x-0 -top-z3 text-center font-mono text-[10px] tabular-nums text-ink-2">
                      {bar.grossCents > 0
                        ? compact(bar.grossCents, locale)
                        : ''}
                    </span>

                    <span
                      className={
                        // THE PARTIAL BUCKET IS DRAWN AND MARKED. A dashed top
                        // edge says the bar is not finished — the shape a reader
                        // needs before comparing it to the ones beside it.
                        bar.partial
                          ? 'w-full rounded-t-[2px] border-t-2 border-dashed border-accent'
                          : 'w-full rounded-t-[2px]'
                      }
                      style={{
                        height: `${String(height(bar.grossCents))}%`,
                        backgroundColor: 'var(--color-accent)',
                        // HATCHED WHERE PAY IS UNRECORDED, and dimmed, so the
                        // bar reads as "cannot be compared" rather than as
                        // "compared and favourable".
                        ...(unknown
                          ? {
                              opacity: 0.45,
                              backgroundImage:
                                'repeating-linear-gradient(45deg, var(--color-border-strong) 0 1px, transparent 1px 4px)',
                            }
                          : {}),
                      }}
                    />

                    {/* THE PAY BAR, INSIDE THE SAME SCALE, drawn over the gross
                     * one. Absent entirely when unknown — never zero-height. */}
                    {unknown ? null : (
                      <span
                        aria-hidden
                        className="absolute bottom-0 left-1/2 w-1/2 -translate-x-1/2 rounded-t-[2px]"
                        style={{
                          height: `${String(height(bar.driverPayCents ?? 0))}%`,
                          backgroundColor: 'var(--color-ink-3)',
                        }}
                      />
                    )}

                    {/* ── THE TOOLTIP: CSS, VISIBLE, STYLED ───────────── */}
                    <div
                      role="tooltip"
                      className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-z2 hidden w-[180px] -translate-x-1/2 rounded-control border border-border-strong bg-surface p-z2 text-start shadow-lg group-hover:block group-focus-within:block"
                    >
                      <p className="font-medium text-ink">{bar.detail}</p>
                      <dl className="mt-z1 flex flex-col gap-[2px] text-xs">
                        <div className="flex justify-between gap-z2">
                          <dt className="text-ink-2">{labels.gross}</dt>
                          <dd className="font-mono tabular-nums text-ink">
                            {formatCents(bar.grossCents, locale)}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-z2">
                          <dt className="text-ink-2">{labels.driverPay}</dt>
                          <dd className="font-mono tabular-nums text-ink">
                            {bar.driverPayCents === null
                              ? '—'
                              : formatCents(bar.driverPayCents, locale)}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-z2">
                          <dt className="text-ink-2">
                            {labels.afterDriverPay}
                          </dt>
                          <dd className="font-mono tabular-nums text-ink">
                            {bar.marginCents === null
                              ? '—'
                              : formatCents(bar.marginCents, locale)}
                          </dd>
                        </div>
                        {bar.loads === null ? null : (
                          <div className="flex justify-between gap-z2">
                            <dt className="text-ink-2">{labels.loads}</dt>
                            <dd className="font-mono tabular-nums text-ink">
                              {String(bar.loads)}
                            </dd>
                          </div>
                        )}
                      </dl>
                      {/* THE DASHES ARE EXPLAINED HERE TOO, not only in the
                       * legend — a reader hovering a hatched bar is asking
                       * exactly this question. */}
                      {bar.driverPayCents === null ? (
                        <p className="mt-z1 text-xs text-ink-3">
                          {labels.unrecorded}
                        </p>
                      ) : null}
                      {/* THE SHORT LAST BAR, EXPLAINED WHERE IT IS ASKED ABOUT.
                       * A reader hovering it wants to know whether the week
                       * collapsed or has not finished. */}
                      {bar.partial ? (
                        <p className="mt-z1 text-xs text-ink-3">
                          {labels.partial}
                        </p>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ol>
          </div>

          {/* ── THE X AXIS: ONE LABEL PER BAR ──────────────────────────── */}
          <ol
            aria-hidden
            className="mt-z1 flex gap-[2px] font-mono text-[10px] text-ink-3"
          >
            {bars.map((bar) => (
              <li
                key={bar.key}
                className="min-w-0 flex-1 overflow-hidden text-center"
              >
                {bar.label}
              </li>
            ))}
          </ol>
        </div>
      </div>

      {/* ── THE FIGURES, READABLE WITHOUT THE BARS (§13) ───────────────── */}
      <table className="sr-only">
        <caption>{labels.heading}</caption>
        <thead>
          <tr>
            <th scope="col">{labels.bucket}</th>
            <th scope="col">{labels.gross}</th>
            <th scope="col">{labels.driverPay}</th>
            <th scope="col">{labels.afterDriverPay}</th>
            <th scope="col">{labels.loads}</th>
          </tr>
        </thead>
        <tbody>
          {bars.map((bar) => (
            <tr key={bar.key}>
              <th scope="row">{bar.detail}</th>
              <td>{formatCents(bar.grossCents, locale)}</td>
              <td>
                {bar.driverPayCents === null
                  ? labels.unrecorded
                  : formatCents(bar.driverPayCents, locale)}
              </td>
              <td>
                {bar.marginCents === null
                  ? labels.unrecorded
                  : formatCents(bar.marginCents, locale)}
              </td>
              <td>{String(bar.loads)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
