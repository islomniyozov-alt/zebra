import Link from 'next/link'
import { cx } from '@/lib/cx'
import {
  TRUCK_HEALTH_CHECKS,
  type TruckHealthCheck,
  type TruckHealthCounts,
} from '@/lib/data-health'

// THE DATA-HEALTH ROW (§6.5 part 0). Five figures under the grid, in the
// footer's register, every one a link to the list filtered by the same
// definition that produced the count. ZERO IS SHOWN: a row that drops its zeros
// teaches the office that an absent figure means fine.

interface Props {
  counts: TruckHealthCounts
  /** The check the list is currently filtered by, if any. */
  active: TruckHealthCheck | null
  /** Builds the list URL with the other filters kept and `missing` set/cleared. */
  hrefFor: (check: TruckHealthCheck | null) => string
  labels: {
    title: string
    all: string
    check: (check: TruckHealthCheck) => string
  }
}

export function DataHealthRow({ counts, active, hrefFor, labels }: Props) {
  return (
    <nav
      aria-label={labels.title}
      className="flex flex-wrap items-center gap-x-z4 gap-y-z1 border-t border-border bg-surface px-gutter py-z2 text-xs"
    >
      <span className="uppercase tracking-[0.04em] text-ink-3">
        {labels.title}
      </span>
      {TRUCK_HEALTH_CHECKS.map((check) => {
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
