import Link from 'next/link'
import { cx } from '@/lib/cx'

// THE DATA-HEALTH ROW (§6.5 part 0 and 0b). Five figures under a grid, in the
// footer's register, every one a link to the list filtered by the same
// definition that produced the count. ZERO IS SHOWN: a row that drops its
// zeros teaches the office that an absent figure means fine.
//
// GENERIC OVER THE CHECK LIST — trucks and drivers render the one component
// with their own five, rather than a copy each. The component knows nothing
// about what a check means; the lib does.

interface Props<C extends string> {
  checks: readonly C[]
  counts: Record<C, number>
  /** The check the list is currently filtered by, if any. */
  active: C | null
  /** Builds the list URL with the other filters kept and `missing` set/cleared. */
  hrefFor: (check: C | null) => string
  labels: {
    title: string
    all: string
    check: (check: C) => string
  }
}

export function DataHealthRow<C extends string>({
  checks,
  counts,
  active,
  hrefFor,
  labels,
}: Props<C>) {
  return (
    <nav
      aria-label={labels.title}
      className="flex flex-wrap items-center gap-x-z4 gap-y-z1 border-t border-border bg-surface px-gutter py-z2 text-xs"
    >
      <span className="uppercase tracking-[0.04em] text-ink-3">
        {labels.title}
      </span>
      {checks.map((check) => {
        const current = check === active
        return (
          <Link
            key={check}
            href={hrefFor(current ? null : check)}
            aria-current={current ? 'true' : undefined}
            className={cx(
              'inline-flex items-baseline gap-z1 hover:text-accent',
              current ? 'font-medium text-accent' : 'text-ink-2',
            )}
          >
            <span>{labels.check(check)}</span>
            <span className="font-mono tabular-nums">{counts[check]}</span>
          </Link>
        )
      })}
      {active ? (
        <Link href={hrefFor(null)} className="text-ink-3 hover:text-accent">
          {labels.all}
        </Link>
      ) : null}
    </nav>
  )
}
