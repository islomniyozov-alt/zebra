import { formatCents } from '@/lib/money'

// ---------------------------------------------------------------------------
// A REVENUE DONUT. §6.1.1's chart contract, dashboard part 2.
//
// ── ONE COMPONENT, TWO PANELS ────────────────────────────────────────────
//
// By authority and by customer are the same picture of the same money cut two
// ways, so they are one component taking slices rather than two drawing
// circles. A second copy would be a second place for the share arithmetic to
// round differently.
//
// ── STROKE-DASHARRAY, NOT ARC PATHS ──────────────────────────────────────
//
// Each slice is a circle with a dash pattern and an offset, which needs no
// trigonometry and therefore has no place to get a sign wrong. Arc paths would
// mean computing sweep flags per slice, and a chart that silently draws the
// long way round a circle is the kind of defect that looks like a design
// choice.
//
// ── THE PALETTE IS THE ACCENT RAMP (§6.1.1) ──────────────────────────────
//
// NOT the status hues. §3.3 fixes success, warning, danger and progress to
// MEANINGS — a donut colouring one authority red would say it is in trouble
// when the only difference between slices is how much freight each hauled.
// Descending opacity on `--color-accent`, with `--color-ink-3` for the
// remainder. No new token, no hex.
//
// ── A REMAINDER RATHER THAN TWENTY SLICES ────────────────────────────────
//
// Dev has nine customers and will have ninety. Past the top few, slices are
// thinner than their own borders and the legend is longer than the panel, so
// the tail is summed into one "other" slice that SAYS HOW MANY it stands for.
// A chart that silently dropped the tail would not add up to the KPI above it.
// ---------------------------------------------------------------------------

export interface Slice {
  key: string
  label: string
  cents: number
}

interface Props {
  slices: readonly Slice[]
  locale: string
  /** How many named slices before the rest become one. */
  top?: number
  labels: {
    heading: string
    other: (count: number) => string
    name: string
    value: string
    share: string
    empty: string
  }
}

/** Geometry. A 36-unit box and a radius chosen so the circumference is ~100. */
const BOX = 42
const RADIUS = 15.915
const CIRCUMFERENCE = 100

/**
 * Descending intensity, then the neutral for whatever is left.
 *
 * SIX STEPS BECAUSE SEVEN IS NOT DISTINGUISHABLE. Below about 0.3 the accent
 * is lighter than the border it sits against, so the ramp stops and the
 * remainder takes the neutral ink instead of a step nobody can see.
 */
const RAMP = [1, 0.82, 0.64, 0.5, 0.38, 0.3] as const

export function Donut({ slices, locale, top = 6, labels }: Props) {
  const ranked = [...slices]
    .filter((slice) => slice.cents > 0)
    .sort((a, b) => b.cents - a.cents)

  const named = ranked.slice(0, top)
  const tail = ranked.slice(top)
  const tailCents = tail.reduce((sum, slice) => sum + slice.cents, 0)

  const drawn: (Slice & { opacity: number; neutral: boolean })[] = [
    ...named.map((slice, index) => ({
      ...slice,
      opacity: RAMP[Math.min(index, RAMP.length - 1)]!,
      neutral: false,
    })),
    ...(tailCents > 0
      ? [
          {
            key: '__other',
            label: labels.other(tail.length),
            cents: tailCents,
            opacity: 1,
            neutral: true,
          },
        ]
      : []),
  ]

  const total = drawn.reduce((sum, slice) => sum + slice.cents, 0)

  if (total <= 0) {
    // NOT "No data available" (§14). It says what the panel is for.
    return (
      <div>
        <h3 className="text-sm font-medium text-ink">{labels.heading}</h3>
        <p className="mt-z2 text-sm text-ink-3">{labels.empty}</p>
      </div>
    )
  }

  const share = (cents: number) => (cents / total) * CIRCUMFERENCE
  const pct = (cents: number) => `${((cents / total) * 100).toFixed(1)}%`

  // THE RUNNING OFFSET IS THE WHOLE MECHANISM. Each slice starts where the
  // previous one ended; `dashoffset` runs backwards, which is why it is
  // subtracted rather than added.
  let consumed = 0

  return (
    <div>
      <h3 className="text-sm font-medium text-ink">{labels.heading}</h3>

      <div className="mt-z2 flex items-center gap-z4">
        <svg
          viewBox={`0 0 ${String(BOX)} ${String(BOX)}`}
          className="h-[120px] w-[120px] shrink-0"
          role="img"
          aria-label={labels.heading}
        >
          {/* The track, so a single-slice donut still reads as a ring. */}
          <circle
            cx={BOX / 2}
            cy={BOX / 2}
            r={RADIUS}
            fill="none"
            stroke="var(--color-surface-3)"
            strokeWidth={6}
          />
          {drawn.map((slice) => {
            const length = share(slice.cents)
            const offset = -consumed
            consumed += length
            return (
              <circle
                key={slice.key}
                cx={BOX / 2}
                cy={BOX / 2}
                r={RADIUS}
                fill="none"
                stroke={
                  slice.neutral ? 'var(--color-ink-3)' : 'var(--color-accent)'
                }
                strokeOpacity={slice.opacity}
                strokeWidth={6}
                strokeDasharray={`${String(length)} ${String(CIRCUMFERENCE - length)}`}
                strokeDashoffset={String(offset)}
                // THE BROWSER'S OWN TOOLTIP (§6.1.1). No script, and it reads
                // the same figures the table below carries.
              >
                <title>{`${slice.label} — ${formatCents(slice.cents, locale)} (${pct(slice.cents)})`}</title>
              </circle>
            )
          })}
        </svg>

        {/* THE LEGEND IS THE CHART for anybody reading a number rather than a
         * shape, so it carries the figure and the share, not just the swatch. */}
        <ul className="flex min-w-0 flex-1 flex-col gap-z1">
          {drawn.map((slice) => (
            <li
              key={slice.key}
              className="flex items-baseline justify-between gap-z2 text-xs"
            >
              <span className="flex min-w-0 items-center gap-z2">
                <span
                  aria-hidden
                  className="h-z2 w-z2 shrink-0 rounded-[2px]"
                  style={{
                    backgroundColor: slice.neutral
                      ? 'var(--color-ink-3)'
                      : 'var(--color-accent)',
                    opacity: slice.opacity,
                  }}
                />
                <span className="truncate text-ink">{slice.label}</span>
              </span>
              <span className="shrink-0 font-mono tabular-nums text-ink-2">
                {formatCents(slice.cents, locale)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* ── THE SAME FIGURES, READABLE WITHOUT SEEING THE RING (§13) ────── */}
      <table className="sr-only">
        <caption>{labels.heading}</caption>
        <thead>
          <tr>
            <th scope="col">{labels.name}</th>
            <th scope="col">{labels.value}</th>
            <th scope="col">{labels.share}</th>
          </tr>
        </thead>
        <tbody>
          {drawn.map((slice) => (
            <tr key={slice.key}>
              <th scope="row">{slice.label}</th>
              <td>{formatCents(slice.cents, locale)}</td>
              <td>{pct(slice.cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
