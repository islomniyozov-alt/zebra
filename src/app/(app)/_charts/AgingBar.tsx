import { formatCents } from '@/lib/money'

// ---------------------------------------------------------------------------
// RECEIVABLES AGING, AS ONE STACKED BAR. §6.1.1 and §6.2.7.
//
// EXTRACTED FROM THE DASHBOARD'S CASH PANEL rather than written twice. §6.2.7
// asks for "the same as the dashboard Cash panel, shared component", and two
// stacked bars drawn from one reader is how 0–30 ends up a different colour,
// or a different boundary, on two screens that quote the same number.
//
// THE LABELS COME IN. This renders money and shares; it translates nothing, so
// it can sit under a panel heading on one screen and a chart heading on
// another without either page inheriting the other's words.
// ---------------------------------------------------------------------------

export interface AgingBuckets {
  d0_30: number
  d31_60: number
  d61_90: number
  d90plus: number
}

export interface AgingLabels {
  /** The chart's own heading. */
  heading: string
  /** Why factored paper is not in it — see the note below. */
  note: string
  d0_30: string
  d31_60: string
  d61_90: string
  d90plus: string
  /** Hidden-table column headers. */
  bucket: string
  amount: string
  /** Shown when nothing is outstanding. Never a blank panel (§14). */
  empty: string
}

export function AgingBar({
  aging,
  locale,
  labels,
}: {
  aging: AgingBuckets
  locale: string
  labels: AgingLabels
}) {
  // OLDEST DARKEST, by the accent ramp. §3.3's status hues mean something else
  // and a receivable that is merely old is not an error.
  const buckets = [
    { key: 'd0_30', label: labels.d0_30, cents: aging.d0_30, opacity: 0.4 },
    { key: 'd31_60', label: labels.d31_60, cents: aging.d31_60, opacity: 0.6 },
    { key: 'd61_90', label: labels.d61_90, cents: aging.d61_90, opacity: 0.8 },
    { key: 'd90plus', label: labels.d90plus, cents: aging.d90plus, opacity: 1 },
  ]
  const total = buckets.reduce((sum, bucket) => sum + bucket.cents, 0)

  return (
    <div>
      <h3 className="text-sm font-medium text-ink">{labels.heading}</h3>
      {/* FACTORED PAPER IS THE FACTOR'S RECEIVABLE, not the carrier's, so it
       * is excluded — and the chart says so, because "receivables" that
       * silently omitted a third of the book would be the wrong number to
       * take to a bank. */}
      <p className="mt-z1 text-xs text-ink-3">{labels.note}</p>

      {/* ONE STACKED BAR. The ramp carries the age so the eye reads severity
       * without a second axis. An EMPTY book takes a branch that does no
       * arithmetic: a share of nothing is NaN%, which renders as a segment of
       * arbitrary width rather than as an error. */}
      <div className="mt-z2 flex h-z4 w-full overflow-hidden rounded-[2px] border border-border">
        {total <= 0 ? (
          <span aria-hidden className="h-full w-full bg-surface-3" />
        ) : (
          buckets.map((bucket) => (
            <span
              key={bucket.key}
              aria-hidden
              className="h-full"
              style={{
                width: `${String((bucket.cents / total) * 100)}%`,
                backgroundColor: 'var(--color-accent)',
                opacity: bucket.opacity,
              }}
            />
          ))
        )}
      </div>

      {/* THE VALUE ON EVERY BUCKET, as part 2b requires of every bar. A
       * stacked segment two pixels wide is unreadable; the figure is not. And
       * the keys stay on screen when the book is empty, which is §6.1.1's
       * "an empty period keeps its axis and its legend". */}
      <ul className="mt-z2 grid grid-cols-2 gap-z2 md:grid-cols-4">
        {buckets.map((bucket) => (
          <li key={bucket.key} className="flex items-center gap-z2 text-xs">
            <span
              aria-hidden
              className="h-z2 w-z2 shrink-0 rounded-[2px]"
              style={{
                backgroundColor: 'var(--color-accent)',
                opacity: bucket.opacity,
              }}
            />
            <span className="min-w-0">
              <span className="block truncate text-ink-2">{bucket.label}</span>
              <span className="font-mono tabular-nums text-ink">
                {formatCents(bucket.cents, locale)}
              </span>
            </span>
          </li>
        ))}
      </ul>

      {total <= 0 ? (
        <p className="mt-z2 text-sm text-ink-3">{labels.empty}</p>
      ) : null}

      <table className="sr-only">
        <caption>{labels.heading}</caption>
        <thead>
          <tr>
            <th scope="col">{labels.bucket}</th>
            <th scope="col">{labels.amount}</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((bucket) => (
            <tr key={bucket.key}>
              <th scope="row">{bucket.label}</th>
              <td>{formatCents(bucket.cents, locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
