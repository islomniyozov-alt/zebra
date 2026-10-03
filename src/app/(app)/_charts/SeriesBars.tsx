import { formatCents } from '@/lib/money'

// ---------------------------------------------------------------------------
// GROUPED MONEY BARS: N NAMED SERIES PER BUCKET. §6.2.7.
//
// ── WHY THIS EXISTS WHEN `BarChart` ALREADY DRAWS BARS ───────────────────
//
// The brief for accounting polish says reuse BarChart "unless one is genuinely
// missing (say which)". This is the one, and here is the boundary.
//
// `BarChart` IS THE MONEY SERIES, NOT A BAR CHART. Its row type is
// `{ grossCents, driverPayCents, marginCents, loads }` and its rules are about
// those fields: pay is drawn INSIDE the gross scale because pay comes out of
// gross, a null pay HATCHES the gross bar because "cost nothing to drive" is
// the most expensive wrong number on the page, and the tooltip names all four.
// The by-company chart on /accounting/reports is exactly that shape and uses
// it unchanged.
//
// INVOICED / FACTORED / COLLECTED IS NOT THAT SHAPE. Three independent series,
// none inside another, no hatch — collected is not "part of" invoiced, and a
// week can collect more than it billed. Mapping them onto gross/pay/margin
// would put three unrelated figures in fields named after a relationship they
// do not have, and the hatch rule would fire on whichever one happened to be
// null. Same for paid gross against net: net IS inside gross, but the hatch
// and the load count mean nothing there.
//
// SO: `BarChart` keeps the money series it was built for, this draws arbitrary
// named series, and NEITHER grows into the other. If a third shape turns up,
// the answer is to generalise this one — it has no semantics to lose — rather
// than to add a third component.
//
// ── THE PART-2B RULES APPLY, ALL OF THEM ─────────────────────────────────
//
// Worded legend, the value above every bar, the label below, gridlines with
// money ticks, a visible CSS tooltip, the same figures as a hidden table, and
// an empty period that keeps its axis and its legend. HTML and CSS, no client
// JavaScript, nothing that can animate (§14).
// ---------------------------------------------------------------------------

export interface SeriesBucket {
  key: string
  /** Under the bar: "Sep 20" for a week, "Oct 2" for a day. */
  label: string
  /** In the tooltip and the hidden table: the full date or week range. */
  detail: string
  /** One figure per series, in the series' order. */
  values: readonly number[]
  /** The current bucket, still running — drawn, and marked. */
  partial?: boolean
}

export interface Series {
  key: string
  /** In the legend, the tooltip and the hidden table's column head. */
  label: string
}

/** How many gridlines, including the top. Four reads as a scale. */
const TICKS = 4

/**
 * `$12.4k`, as the ruling asked for above each bar.
 *
 * ABBREVIATED HERE AND ONLY HERE. §8 wants money in full wherever a figure is
 * read or quoted; a bar label is a magnitude, and `$12,431.77` above a
 * 24-pixel bar is unreadable at any density. The tooltip and the hidden table
 * carry the exact figure.
 */
function compact(cents: number, locale: string): string {
  const dollars = cents / 100
  if (Math.abs(dollars) >= 1_000_000) {
    return `$${(dollars / 1_000_000).toFixed(1)}m`
  }
  if (Math.abs(dollars) >= 1_000) return `$${(dollars / 1_000).toFixed(1)}k`
  return formatCents(cents, locale)
}

/**
 * The accent ramp, descending. §6.1.1: intensity, never §3.3's status hues,
 * which are fixed to meanings a series does not have.
 *
 * THE LAST SERIES IS `--color-ink-3` rather than a fourth opacity, because
 * below about 0.4 an accent bar is indistinguishable from the gridlines behind
 * it.
 */
const SERIES_STYLE = [
  { backgroundColor: 'var(--color-accent)', opacity: 1 },
  { backgroundColor: 'var(--color-accent)', opacity: 0.6 },
  { backgroundColor: 'var(--color-ink-3)', opacity: 1 },
  { backgroundColor: 'var(--color-ink-3)', opacity: 0.55 },
] as const

const styleFor = (index: number) =>
  SERIES_STYLE[index % SERIES_STYLE.length] ?? SERIES_STYLE[0]

export function SeriesBars({
  buckets,
  series,
  locale,
  labels,
}: {
  buckets: readonly SeriesBucket[]
  series: readonly Series[]
  locale: string
  labels: {
    heading: string
    /** The hidden table's first column: what a row IS. */
    bucket: string
    /** Shown when the window holds nothing. Never a blank panel (§14). */
    empty: string
    /** Said on the current bucket's tooltip: the period is unfinished. */
    partial: string
  }
}) {
  // ONE SCALE FOR EVERY SERIES, so they are comparable. Scaling each to its own
  // maximum would draw a $30k bar as tall as a $100k one, which is the
  // misreading a grouped chart exists to prevent.
  const peak = buckets.reduce(
    (high, bucket) =>
      bucket.values.reduce((inner, value) => Math.max(inner, value), high),
    0,
  )

  // THE TICKS EXIST EVEN WHEN THE PERIOD IS EMPTY (§6.1.1): a blank panel is
  // indistinguishable from a broken one. With nothing in the window the scale
  // runs 0 to 0 and the axis still draws, labelled $0.
  const ticks = Array.from({ length: TICKS + 1 }, (_, index) => {
    const fraction = index / TICKS
    return { fraction, cents: Math.round(peak * fraction) }
  }).reverse()

  const height = (cents: number) => (peak <= 0 ? 0 : (cents / peak) * 100)

  return (
    <div>
      <h3 className="text-sm font-medium text-ink">{labels.heading}</h3>

      {/* THE LEGEND, IN WORDS. Part 2b: a colour nobody can name is a
       * decoration. Not `ChartLegend`, which names the money series' three
       * fixed roles — these series are whatever the caller says they are. */}
      <ul className="mt-z1 flex flex-wrap items-center gap-z3 text-xs text-ink-2">
        {series.map((entry, index) => (
          <li key={entry.key} className="flex items-center gap-z2">
            <span
              aria-hidden
              className="h-z2 w-z3 shrink-0 rounded-[2px]"
              style={styleFor(index)}
            />
            {entry.label}
          </li>
        ))}
      </ul>

      {buckets.length === 0 ? (
        <p className="mt-z3 text-sm text-ink-3">{labels.empty}</p>
      ) : null}

      <div className="mt-z3 flex gap-z2">
        {/* ── THE Y AXIS: MONEY TICKS, TOP DOWN ────────────────────────── */}
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

            <ol className="absolute inset-0 flex items-end gap-[3px]">
              {buckets.map((bucket) => {
                const total = bucket.values.reduce(
                  (sum, value) => Math.max(sum, value),
                  0,
                )
                return (
                  <li
                    key={bucket.key}
                    className="group relative flex h-full min-w-0 flex-1 items-end justify-center gap-[1px]"
                  >
                    {/* THE VALUE ABOVE THE BAR GROUP. The largest of the
                     * group, because four stacked numbers over a 20-pixel
                     * column is unreadable and the tooltip carries them all. */}
                    <span className="pointer-events-none absolute inset-x-0 -top-z3 text-center font-mono text-[10px] tabular-nums text-ink-2">
                      {total > 0 ? compact(total, locale) : ''}
                    </span>

                    {bucket.values.map((value, index) => (
                      <span
                        key={series[index]?.key ?? String(index)}
                        className={
                          // THE PARTIAL BUCKET IS DRAWN AND MARKED. A dashed
                          // top edge says the bar is unfinished, which a reader
                          // needs before comparing it to the ones beside it.
                          bucket.partial
                            ? 'min-w-0 flex-1 rounded-t-[2px] border-t-2 border-dashed border-accent'
                            : 'min-w-0 flex-1 rounded-t-[2px]'
                        }
                        style={{
                          height: `${String(height(value))}%`,
                          ...styleFor(index),
                        }}
                      />
                    ))}

                    {/* ── THE TOOLTIP: CSS, VISIBLE, STYLED ───────────── */}
                    <div
                      role="tooltip"
                      className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-z2 hidden w-[200px] -translate-x-1/2 rounded-control border border-border-strong bg-surface p-z2 text-start shadow-lg group-hover:block group-focus-within:block"
                    >
                      <p className="font-medium text-ink">{bucket.detail}</p>
                      <dl className="mt-z1 flex flex-col gap-[2px] text-xs">
                        {series.map((entry, index) => (
                          <div
                            key={entry.key}
                            className="flex justify-between gap-z2"
                          >
                            <dt className="text-ink-2">{entry.label}</dt>
                            <dd className="font-mono tabular-nums text-ink">
                              {formatCents(bucket.values[index] ?? 0, locale)}
                            </dd>
                          </div>
                        ))}
                      </dl>
                      {bucket.partial ? (
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

          {/* ── THE X AXIS: ONE LABEL PER BUCKET ─────────────────────────
           *
           * Every bucket is labelled. Fifty-two of them at this width is a
           * dense row rather than a clipped one, which is the trade the
           * rolling 52-week preset takes. */}
          <ol className="mt-z1 flex gap-[3px]">
            {buckets.map((bucket) => (
              <li
                key={bucket.key}
                className="min-w-0 flex-1 truncate text-center text-[10px] text-ink-3"
              >
                {bucket.label}
              </li>
            ))}
          </ol>
        </div>
      </div>

      {/* THE SAME FIGURES AS A TABLE (§6.1.1, §13), in full rather than
       * compacted: a screen reader gets no benefit from "$12.4k". */}
      <table className="sr-only">
        <caption>{labels.heading}</caption>
        <thead>
          <tr>
            <th scope="col">{labels.bucket}</th>
            {series.map((entry) => (
              <th key={entry.key} scope="col">
                {entry.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {buckets.map((bucket) => (
            <tr key={bucket.key}>
              <th scope="row">{bucket.detail}</th>
              {series.map((entry, index) => (
                <td key={entry.key}>
                  {formatCents(bucket.values[index] ?? 0, locale)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
