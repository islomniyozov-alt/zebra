'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'

// §6.7 item 1 — a pickup or delivery date range, written as a NAMED VIEW.
//
// `?view=pickup&from=…&to=…`, never a raw date filter: the range resolves
// through `load-views.ts` like every other view, so a count and a list cannot
// read it two ways. Which date it bounds is said before the inputs (§7.4.1).

/** The two views in `load-views.ts` that read `from` and `to`. */
type RangeView = 'pickup' | 'delivery'

const isRangeView = (value: string | null): value is RangeView =>
  value === 'pickup' || value === 'delivery'

interface Props {
  labels: {
    label: string
    pickup: string
    delivery: string
    from: string
    to: string
  }
}

const INPUT =
  'h-control-compact rounded-control border border-border-strong bg-surface px-z2 font-mono text-xs text-ink focus:border-accent focus:outline-none'

export function DateRangeView({ labels }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const view = params.get('view')
  const ranged = isRangeView(view)
  const which: RangeView = ranged ? view : 'pickup'
  const from = ranged ? (params.get('from') ?? '') : ''
  const to = ranged ? (params.get('to') ?? '') : ''

  /**
   * One write for all three, so the URL never holds a range bound to the wrong
   * view. Clearing `from` clears the whole range, because `to` alone is not a
   * range the view reads.
   */
  const write = (next: { which: RangeView; from: string; to: string }) => {
    const query = new URLSearchParams(params.toString())
    query.delete('page')
    query.delete('from')
    query.delete('to')
    if (next.from === '') {
      if (ranged) query.delete('view')
    } else {
      query.set('view', next.which)
      query.set('from', next.from)
      if (next.to !== '') query.set('to', next.to)
    }
    router.replace(query.size > 0 ? `${pathname}?${query}` : pathname, {
      scroll: false,
    })
  }

  return (
    <div className="flex items-center gap-z1">
      <span className="text-xs font-medium uppercase tracking-[0.04em] text-ink-3">
        {labels.label}
      </span>
      <select
        aria-label={labels.label}
        value={which}
        onChange={(event) =>
          write({ which: event.target.value as RangeView, from, to })
        }
        className={INPUT}
      >
        <option value="pickup">{labels.pickup}</option>
        <option value="delivery">{labels.delivery}</option>
      </select>
      <input
        type="date"
        aria-label={labels.from}
        key={`from-${from}`}
        defaultValue={from}
        onChange={(event) => write({ which, from: event.target.value, to })}
        className={INPUT}
      />
      <span aria-hidden className="text-xs text-ink-3">
        –
      </span>
      <input
        type="date"
        aria-label={labels.to}
        key={`to-${to}`}
        defaultValue={to}
        onChange={(event) => write({ which, from, to: event.target.value })}
        className={INPUT}
      />
    </div>
  )
}
