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

export function Sparkline({ points, label }: Props) {
  const known = points.filter((value): value is number => value !== null)
  const peak = known.reduce((high, value) => Math.max(high, value), 0)

  // AN EMPTY OR FLAT SERIES STILL RENDERS A BASELINE. A missing strip reads as
  // a broken cell; a flat one reads as a quiet quarter, which is the truth.
  return (
    <div
      className="mt-z2 flex h-[22px] items-end gap-[1px]"
      role="img"
      aria-label={label}
    >
      {points.length === 0 ? (
        <span aria-hidden className="h-px w-full bg-border" />
      ) : (
        points.map((value, index) => (
          <span
            key={index}
            aria-hidden
            className="min-w-0 flex-1 rounded-t-[1px]"
            style={{
              // 1px MINIMUM ON A KNOWN ZERO, so "we measured nothing" is
              // visible and distinct from the blank of "we measured nothing at
              // all". A null gets no bar.
              height:
                value === null
                  ? '0'
                  : peak <= 0
                    ? '1px'
                    : `${String(Math.max(1, (value / peak) * 100))}%`,
              backgroundColor:
                value === null ? 'transparent' : 'var(--color-accent)',
              opacity: value === null ? 0 : 0.55,
            }}
          />
        ))
      )}
    </div>
  )
}
