'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { cx } from '@/lib/cx'
import { PERIODS, isPeriodKey, type PeriodKey } from '@/lib/dashboard-kpis'

interface Props {
  labels: Record<PeriodKey, string>
  /** Named so a screen reader hears what the group selects. */
  legend: string
}

/**
 * The period every figure on the dashboard answers for (§6.1.1).
 *
 * ── A URL, NOT STATE ─────────────────────────────────────────────────────
 *
 * §7.4 makes a filter a URL and this is the same rule: the period is a
 * `?period=` the server reads, so the page is linkable, the back button works,
 * and the figures are computed on the server where the money rules live. A
 * client-side period would mean shipping thirteen weeks of every cut to the
 * browser and filtering there, which is the shape that makes two panels
 * disagree.
 *
 * ── FOUR PRESETS AND NO DATE RANGE, DELIBERATELY ─────────────────────────
 *
 * §7.4.1's range picker exists and belongs on a LIST, where somebody is
 * hunting a particular row. A dashboard is read at 6am to answer "how are we
 * doing", and the four answers to that are this week, this month, this quarter
 * and this year. An arbitrary range invites a comparison nobody has a baseline
 * for — "gross for 3 Aug to 19 Sep" is a number with no denominator, which is
 * what §7.3 says about a bare arrow on a KPI.
 *
 * THE SELECTED ONE ALWAYS RENDERS, so a reader can always see which window
 * they are looking at. There is no "all" — a dashboard with no period is a
 * report.
 */
export function PeriodPicker({ labels, legend }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const selected = params.get('period')
  const active: PeriodKey =
    selected !== null && isPeriodKey(selected) ? selected : 'month'

  const go = (key: PeriodKey) => {
    const next = new URLSearchParams(params)
    // THE DEFAULT IS AN ABSENT PARAM, not `?period=month`. A canonical URL for
    // the default view means one cache entry and one thing to read in a bug
    // report, rather than two spellings of the same screen.
    if (key === 'month') next.delete('period')
    else next.set('period', key)
    const query = next.toString()
    router.push(query === '' ? pathname : `${pathname}?${query}`)
  }

  return (
    <fieldset className="flex items-center gap-z1">
      <legend className="sr-only">{legend}</legend>
      {PERIODS.map((key) => (
        <button
          key={key}
          type="button"
          aria-pressed={key === active}
          onClick={() => go(key)}
          className={cx(
            'h-control rounded-control border px-z3 text-sm',
            key === active
              ? 'border-accent bg-accent-soft font-medium text-accent'
              : 'border-border bg-surface text-ink-2 hover:text-ink',
          )}
        >
          {labels[key]}
        </button>
      ))}
    </fieldset>
  )
}
