import { cx } from '@/lib/cx'

// ---------------------------------------------------------------------------
// LOADED / EMPTY / TOTAL (item 7).
//
// TOTAL IS COMPUTED AND NEVER TYPED. It is `Load.dispatchedMiles`, accumulated
// per LEG once at import; the split is `Load.emptyMiles` subtracted from it.
// Nothing here sums the stop rows — that figure exists already, and a screen
// that re-derives a stored number is a screen that can disagree with itself.
//
// NULL IS NOT ZERO, which is why the split can be absent while the total is
// present. Broker freight has never had `emptyMiles` written — nothing on that
// path classifies legs, because a typed-in load has no Shipper Account to
// classify — so showing "0 empty" there would be the screen inventing a fact
// about freight nobody measured.
//
// AND A SPLIT THAT RESTS PARTLY ON A DEFAULT SAYS SO. `Transfers*` and
// `TrailerPool*` match no rule and fall through to LOADED; their miles are in
// the loaded figure because somebody has to put them somewhere, and the note
// under the number is the difference between a measurement and an assumption.
// See flag 91 — the default was defended as "visibly" wrong while nothing
// displayed it.
// ---------------------------------------------------------------------------

interface Props {
  totalMiles: number | null
  loadedMiles: number | null
  emptyMiles: number | null
  provisional: boolean
  locale: string
  labels: {
    title: string
    loaded: string
    empty: string
    total: string
    unknown: string
    unclassified: string
  }
}

export function MilesSummary({
  totalMiles,
  loadedMiles,
  emptyMiles,
  provisional,
  locale,
  labels,
}: Props) {
  const show = (value: number | null) =>
    value === null ? labels.unknown : value.toLocaleString(locale)

  return (
    <section className="rounded-card border border-border bg-surface p-z4">
      <h2 className="text-md font-medium text-ink">{labels.title}</h2>

      {/* THREE FIGURES SIT TOGETHER AT THE START, NOT SPREAD ACROSS THE WIDTH.
       *
       * As a `grid-cols-3` in a half-width column this was a tall panel
       * holding three short numbers, and full width would only have made the
       * gaps wider — the same three numbers with more emptiness between them.
       * A flex row takes the space the numbers need and stops, so the panel
       * is the height of one line and the figures stay close enough to read
       * as a set: loaded plus empty equals total is the whole point of
       * showing them side by side. */}
      <dl className="mt-z3 flex flex-wrap items-baseline gap-x-z5 gap-y-z3">
        <Figure label={labels.loaded} value={show(loadedMiles)} />
        <Figure label={labels.empty} value={show(emptyMiles)} />
        {/* The total is the one figure that is always known when there is any
         * distance at all, so it carries the emphasis. */}
        <Figure label={labels.total} value={show(totalMiles)} strong />
      </dl>

      {provisional ? (
        <p className="mt-z3 text-xs text-ink-3">{labels.unclassified}</p>
      ) : null}
    </section>
  )
}

function Figure({
  label,
  value,
  strong,
}: {
  label: string
  value: string
  strong?: boolean
}) {
  return (
    <div className="flex min-w-[7rem] flex-col gap-z1">
      <dt className="text-xs uppercase tracking-[0.04em] text-ink-3">
        {label}
      </dt>
      {/* §8: mono and tabular, so three figures in a row line up as figures. */}
      <dd
        className={cx(
          'font-mono tabular-nums',
          strong ? 'text-lg text-ink' : 'text-md text-ink-2',
        )}
      >
        {value}
      </dd>
    </div>
  )
}
