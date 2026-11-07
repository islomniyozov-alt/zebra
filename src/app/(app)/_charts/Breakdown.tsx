'use client'

import { useId, useState, type ReactNode } from 'react'
import { cx } from '@/lib/cx'

interface Props {
  /** Said while the breakdown is closed; open, the chart carries its own. */
  heading?: string
  labels: { show: string; hide: string }
  className?: string
  children: ReactNode
}

/**
 * §6.3 (amended 2026-11-07) — A BREAKDOWN BY AUTHORITY IS CLOSED BY DEFAULT.
 *
 * ── THE SAME REASON AS THE DROPDOWN ───────────────────────────────────────
 *
 * Owner's ruling on dev, round five: the by-authority donut on the dashboard
 * and the company cut of Accounting → Reports name every authority with money
 * beside each, all the time, to anyone who can see the screen. The authority
 * FILTER stopped doing that in v10.76; a chart that does it is the same list
 * with figures attached. So the breakdown sits behind "Show breakdown" and is
 * drawn only when the reader asks.
 *
 * ── OPEN FOR THE CURRENT VIEW ONLY, AND NEVER PERSISTED ───────────────────
 *
 * Component state and nothing else: not the URL, so a link somebody sends
 * does not open it for the next reader; not a preference row or storage, so
 * a reload closes it. The next render of this screen starts closed again,
 * which is the whole point — a breakdown that remembered it was open would
 * have been opened once and shown for ever. `tests/breakdown.test.tsx` reads
 * this file for any of those mechanisms by name.
 *
 * ── NOTHING IS RENDERED WHILE CLOSED ──────────────────────────────────────
 *
 * The children are not styled away with CSS; they are not in the document.
 * A CSS collapse would be the same bug as not collapsing at all (AGENTS.md:
 * leave it out of the payload — concealing it in CSS is the same bug as not
 * checking). The test holds this file to it by refusing the CSS word.
 */
export function Breakdown({ heading, labels, className, children }: Props) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-z2">
        {heading !== undefined && !open ? (
          <h3 className="text-sm font-medium text-ink">{heading}</h3>
        ) : (
          <span />
        )}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((value) => !value)}
          className={cx(
            'h-control-compact rounded-control border px-z2 text-xs font-medium',
            'transition-colors duration-120 ease-out',
            open
              ? 'border-accent bg-accent-soft text-accent'
              : 'border-border-strong bg-surface text-ink-2 hover:bg-surface-3',
          )}
        >
          {open ? labels.hide : labels.show}
        </button>
      </div>
      {open ? (
        <div id={id} className="mt-z2">
          {children}
        </div>
      ) : null}
    </div>
  )
}
