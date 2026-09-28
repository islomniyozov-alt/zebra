'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { cx } from '@/lib/cx'

interface Props {
  cuts: readonly string[]
  selected: string
  grouping: 'week' | 'month'
  labels: {
    cut: string
    company: string
    week: string
    driver: string
    grouping: string
    weekly: string
    monthly: string
  }
}

/**
 * Which cut, and — for the two period cuts — weeks or months.
 *
 * CHIPS RATHER THAN A DROPDOWN (§7.4, and §14 lists "dropdown menus where three
 * chips would do" as an anti-pattern by name). Three cuts is exactly the case
 * that rule is about.
 *
 * THE GROUPING DISAPPEARS ON THE DRIVER CUT, because a driver total is over the
 * whole window rather than per period — a weeks/months control that changed
 * nothing would teach the reader the control is decorative.
 *
 * THE RANGE SURVIVES EVERY SWITCH. That is the point of the three cuts sharing a
 * window: a company total and the driver totals under it are over the same weeks,
 * or they are two different reports.
 */
export function CutPicker({ cuts, selected, grouping, labels }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const label = (cut: string) =>
    cut === 'company'
      ? labels.company
      : cut === 'week'
        ? labels.week
        : labels.driver

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString())
    next.set(key, value)
    // A SORT FROM THE DRIVER CUT MEANS NOTHING IN THE MATRIX, and a stale `sort`
    // would sit in the URL waiting to be misread when the reader came back. The
    // cut owns its own ordering, so switching cut drops it.
    if (key === 'cut') {
      next.delete('sort')
      next.delete('dir')
    }
    router.replace(`${pathname}?${next}`, { scroll: false })
  }

  const chip = (key: string, value: string, text: string, active: boolean) => (
    <button
      key={`${key}-${value}`}
      type="button"
      aria-pressed={active}
      onClick={() => set(key, value)}
      className={cx(
        'h-control-compact rounded-control border px-z2 text-xs font-medium',
        'transition-colors duration-120 ease-out',
        active
          ? 'border-accent bg-accent-soft text-accent'
          : 'border-border-strong bg-surface text-ink-2 hover:bg-surface-3',
      )}
    >
      {text}
    </button>
  )

  return (
    <div className="flex flex-wrap items-center gap-z2 border-b border-border bg-surface px-gutter py-z2">
      <div className="flex items-center gap-z1">
        <span className="text-xs font-medium uppercase tracking-[0.04em] text-ink-3">
          {labels.cut}
        </span>
        {cuts.map((cut) => chip('cut', cut, label(cut), cut === selected))}
      </div>

      {selected === 'driver' ? null : (
        <div className="flex items-center gap-z1">
          <span className="text-xs font-medium uppercase tracking-[0.04em] text-ink-3">
            {labels.grouping}
          </span>
          {chip('by', 'week', labels.weekly, grouping === 'week')}
          {chip('by', 'month', labels.monthly, grouping === 'month')}
        </div>
      )}
    </div>
  )
}
