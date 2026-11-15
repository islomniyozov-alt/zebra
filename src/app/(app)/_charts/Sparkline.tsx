// ---------------------------------------------------------------------------
// ONE KPI'S SPARKLINE. HTML AND CSS, like the bars. §6.1.1.
//
// Owner's review, 2026-10-02: "the six KPI sparklines from the part-2 brief are
// not on screen". They were never in a brief that reached me — the part-2
// instruction arrived truncated and I flagged it at the time — so this is the
// first build of them rather than a repair.
//
// ── A FIGURE WITHOUT A DIRECTION IS HALF AN ANSWER ───────────────────────
//
// "$2.7m gross" tells somebody the size of the business and nothing about where
// it is going. The strip's job is the second half, which is why every cell gets
// one over the SAME buckets as the bars.
//
// ── NULLS ARE GAPS, NOT ZEROES ───────────────────────────────────────────
//
// A bucket whose driver pay was never recorded contributes NO BAR, not a
// zero-height one. A sparkline that dropped to the floor for the first half of
// the year would draw a cliff that never happened — the same wrong number the
// hatch exists to prevent, drawn smaller.
//
// ── NO SCALE, NO AXIS, NO NUMBERS ────────────────────────────────────────
//
// §7.3 on the KPI card: an arrow on its own is a number without a denominator.
// A sparkline is not an arrow — it is the shape, and the figure beside it is the
// quantity. Adding ticks would make a 90-pixel strip into a chart competing
// with the one below it.
// ---------------------------------------------------------------------------

interface Props {
  /** Oldest first. `null` is "not recorded" and draws nothing. */
  points: readonly (number | null)[]
  /** For the screen reader: what the shape is of. */
  label: string
}

/** The strip's height in pixels, and its viewBox height in units. */
const HEIGHT = 22
/** A column's share of its slot; the rest is the gap between columns. */
const COLUMN = 0.85

const units = (value: number) => String(Math.round(value * 100) / 100)

/**
 * The columns as ONE path, a closed rectangle per recorded bucket and nothing
 * for a null — the gap (§6.1.1 v11.05). It was a `<span>` per point with its
 * own classes and inline style: ~150 bytes a column, six strips on the
 * dashboard, each paid twice in the document (the markup and the RSC payload
 * that repeats it). One `d` attribute draws the same columns in a fraction.
 */
export function sparklinePath(points: readonly (number | null)[]): string {
  const known = points.filter((value): value is number => value !== null)
  const peak = known.reduce((high, value) => Math.max(high, value), 0)
  return points
    .flatMap((value, index) => {
      if (value === null) return []
      // A flat series still shows its columns, one unit tall — a pixel.
      const height = peak <= 0 ? 1 : Math.max(1, (value / peak) * HEIGHT)
      return [
        `M${units(index)} ${units(HEIGHT)}V${units(HEIGHT - height)}h${units(COLUMN)}V${units(HEIGHT)}Z`,
      ]
    })
    .join('')
}

export function Sparkline({ points, label }: Props) {
  if (points.length === 0) {
    return (
      <div
        className="mt-z2 flex h-[22px] items-end"
        role="img"
        aria-label={label}
      >
        <span aria-hidden className="h-px w-full bg-border" />
      </div>
    )
  }
  return (
    <svg
      viewBox={`0 0 ${String(points.length)} ${String(HEIGHT)}`}
      preserveAspectRatio="none"
      className="mt-z2 block h-[22px] w-full"
      role="img"
      aria-label={label}
    >
      <path
        d={sparklinePath(points)}
        fill="var(--color-accent)"
        fillOpacity={0.55}
      />
    </svg>
  )
}
