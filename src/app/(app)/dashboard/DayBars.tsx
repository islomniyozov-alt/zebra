import type { DayRow } from '@/lib/dashboard-kpis'

// ---------------------------------------------------------------------------
// LOADS DELIVERED PER DAY. §6.1.1's chart contract, dashboard part 2.
//
// ── EVERY DAY IN THE PERIOD, NOT EVERY DAY WITH FREIGHT ──────────────────
//
// `dayRows` returns one row per day that had a delivery, so a quiet Sunday
// returns nothing. Plotting the rows alone would draw a dense week where there
// was a sparse one and put Tuesday's bar where Thursday belongs — the axis
// would be a list of busy days pretending to be a calendar.
//
// So the days are generated from the period and the rows are looked up into
// them. The same argument as the thirteen weeks in `assembleDashboard`, and the
// same reason it takes the weeks as an argument rather than deriving them.
//
// ── SUNDAYS ARE MARKED, BECAUSE THE WEEK IS THE UNIT HERE ────────────────
//
// A settlement week opens on a Sunday (MONEY-DESIGN §0) and this fleet's
// rhythm is weekly. A faint tick under each Sunday turns a strip of bars into
// something a dispatcher can count weeks across without reading a date.
//
// ── NO MONEY, SO NO GROSS RULE ───────────────────────────────────────────
//
// This is a count of loads. It does not touch the gross CASE, which is why it
// is the one chart on the page with nothing to reconcile against item 7.
// ---------------------------------------------------------------------------

interface Props {
  days: readonly DayRow[]
  period: { from: Date; to: Date }
  labels: {
    heading: string
    day: string
    loads: string
    empty: string
  }
}

const HEIGHT = 96
const PAD_BOTTOM = 10
const GAP = 2
/** Beyond this many days the strip is unreadable and the table is the chart. */
const MAX_DAYS = 120

const iso = (value: Date) => value.toISOString().slice(0, 10)

/** Every UTC day in `[from, to)`. Generated, for the reason in the header. */
function daysBetween(from: Date, to: Date): Date[] {
  const out: Date[] = []
  const cursor = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  )
  while (cursor < to && out.length < MAX_DAYS) {
    out.push(new Date(cursor))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

export function DayBars({ days, period, labels }: Props) {
  const counts = new Map(days.map((row) => [iso(row.day), row.loads]))
  const axis = daysBetween(period.from, period.to)
  const peak = axis.reduce(
    (high, day) => Math.max(high, counts.get(iso(day)) ?? 0),
    0,
  )

  if (axis.length === 0) {
    return (
      <div>
        <h3 className="text-sm font-medium text-ink">{labels.heading}</h3>
        <p className="mt-z2 text-sm text-ink-3">{labels.empty}</p>
      </div>
    )
  }

  const width = axis.length * (4 + GAP)
  const plot = HEIGHT - PAD_BOTTOM
  // A FLAT BASELINE RATHER THAN A DIVISION BY ZERO. A period with no freight is
  // a true picture of a quiet month, not a broken panel.
  const height = (loads: number) =>
    peak <= 0 ? 0 : Math.round((loads / peak) * (plot - 2))

  return (
    <div>
      <h3 className="text-sm font-medium text-ink">{labels.heading}</h3>

      <svg
        viewBox={`0 0 ${String(width)} ${String(HEIGHT)}`}
        className="mt-z2 h-[96px] w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={labels.heading}
      >
        <line
          x1={0}
          y1={plot}
          x2={width}
          y2={plot}
          stroke="var(--color-border-strong)"
          strokeWidth={0.5}
        />
        {axis.map((day, index) => {
          const loads = counts.get(iso(day)) ?? 0
          const barHeight = height(loads)
          const x = index * (4 + GAP)
          const sunday = day.getUTCDay() === 0
          return (
            <g key={iso(day)}>
              {/* THE WEEK TICK. Faint, under the baseline, so it reads as a
               * ruler rather than as another series. */}
              {sunday ? (
                <line
                  x1={x + 2}
                  y1={plot}
                  x2={x + 2}
                  y2={plot + 4}
                  stroke="var(--color-border-strong)"
                  strokeWidth={0.5}
                />
              ) : null}
              <rect
                x={x}
                y={plot - barHeight}
                width={4}
                height={barHeight}
                fill="var(--color-accent)"
                // A DAY WITH NOTHING STILL GETS A TOOLTIP, because "was
                // Thursday quiet or is the bar missing" is the question this
                // chart exists to answer.
                opacity={loads === 0 ? 0.18 : 1}
              >
                <title>{`${iso(day)} — ${String(loads)}`}</title>
              </rect>
            </g>
          )
        })}
      </svg>

      <div className="mt-z1 flex justify-between font-mono text-xs text-ink-3">
        <span dir="ltr">{iso(axis[0]!)}</span>
        <span dir="ltr">{iso(axis.at(-1)!)}</span>
      </div>

      {/* ── THE FIGURES, READABLE WITHOUT THE STRIP (§13) ───────────────── */}
      <table className="sr-only">
        <caption>{labels.heading}</caption>
        <thead>
          <tr>
            <th scope="col">{labels.day}</th>
            <th scope="col">{labels.loads}</th>
          </tr>
        </thead>
        <tbody>
          {axis.map((day) => (
            <tr key={iso(day)}>
              <th scope="row">{iso(day)}</th>
              <td>{String(counts.get(iso(day)) ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
