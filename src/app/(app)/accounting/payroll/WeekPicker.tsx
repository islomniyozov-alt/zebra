'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { cx } from '@/lib/cx'

interface Props {
  weeks: readonly { start: string; end: string; hasBatch: boolean }[]
  selected: string
  label: string
  /** Read out for the dot; the dot alone would be colour-only (rule 5). */
  openedLabel: string
}

/**
 * The week selector — the control the three old screens did not have.
 *
 * ── LINKS, AND THE WEEK IN THE URL ────────────────────────────────────────
 *
 * Same argument §7.4 makes for filters: "the week of the 13th looks wrong" is a
 * thing one person sends another. A `<select>` holding the week in browser state
 * gives none of that, and the batch id in a path — which is what
 * `/settlements/batches/[id]` had — cannot be typed by somebody who knows only
 * the date.
 *
 * ── A DOT MARKS A WEEK THAT HAS A BATCH, AND CARRIES A WORD ───────────────
 *
 * Rule 5: never colour-only. The dot is reinforcement and the accessible name
 * says "opened", so a reader scanning for "which weeks have I done" gets it
 * peripherally and a screen reader gets it at all.
 *
 * NOTHING SCROLLS HERE (rule 10). Twelve weeks wrap; they do not sit in a rail
 * with hidden ends.
 */
export function WeekPicker({ weeks, selected, label, openedLabel }: Props) {
  const params = useSearchParams()

  const hrefFor = (start: string) => {
    // EVERY OTHER PARAM SURVIVES the week changing — a sort or a company chip
    // set while reading one week is still what the reader wants in the next.
    const next = new URLSearchParams(params.toString())
    next.set('week', start)
    return `/accounting/payroll?${next}`
  }

  return (
    <div
      className="flex flex-wrap items-center gap-z1 border-b border-border bg-surface px-gutter py-z2"
      role="group"
      aria-label={label}
    >
      <span className="text-xs font-medium uppercase tracking-[0.04em] text-ink-3">
        {label}
      </span>
      {weeks.map((week) => {
        const active = week.start === selected
        return (
          <Link
            key={week.start}
            href={hrefFor(week.start)}
            scroll={false}
            aria-current={active ? 'true' : undefined}
            className={cx(
              'inline-flex h-control-compact items-center gap-z1 rounded-control border px-z2',
              'font-mono text-xs transition-colors duration-120 ease-out',
              active
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-border-strong bg-surface text-ink-2 hover:bg-surface-3',
            )}
          >
            <span dir="ltr">{week.start.slice(5)}</span>
            {week.hasBatch ? (
              <>
                <span
                  aria-hidden
                  className={cx(
                    'size-[6px] rounded-full',
                    active ? 'bg-accent' : 'bg-success',
                  )}
                />
                <span className="sr-only">{openedLabel}</span>
              </>
            ) : null}
          </Link>
        )
      })}
    </div>
  )
}
