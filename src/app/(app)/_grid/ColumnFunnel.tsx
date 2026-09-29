'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { cx } from '@/lib/cx'

interface Props {
  /** `f.<column>` — namespaced, so a column cannot collide with a screen chip. */
  param: string
  /** The column's own header, for the accessible name. */
  column: string
  labels: { open: string; apply: string; clear: string }
}

/**
 * §6.2.1 — the per-column filter funnel Datatruck has, without the hidden state.
 *
 * ── WHY THIS DOES NOT BREAK §7.4 ──────────────────────────────────────────
 *
 * §7.4 rejects "dropdown menus where three chips would do" and filters in a
 * drawer. The objection is to state the reader cannot see or send. This writes a
 * query parameter: it lands in the URL, the filter bar's Clear clears it, and a
 * filtered grid is still a link somebody can paste into a message. One filter,
 * two handles.
 *
 * ── THE ACTIVE STATE IS VISIBLE ON THE HEADER, NOT ONLY IN THE POPOVER ────
 *
 * A funnel that looks identical whether or not it is filtering is the hidden
 * state §7.4 is about, arriving through the control that was supposed to be
 * honest. Set, it takes the accent colour and its `aria-label` says so.
 */
export function ColumnFunnel({ param, column, labels }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [open, setOpen] = useState(false)

  const current = params.get(param) ?? ''

  const commit = (value: string) => {
    const next = new URLSearchParams(params.toString())
    const trimmed = value.trim()
    if (trimmed === '') next.delete(param)
    else next.set(param, trimmed)
    // A NEW FILTER MEANS PAGE ONE. Filtering while on page 7 would otherwise
    // clamp to the last page of a much shorter list, which reads as the filter
    // having jumped somewhere random.
    next.delete('page')
    setOpen(false)
    router.replace(next.size > 0 ? `${pathname}?${next}` : pathname, {
      scroll: false,
    })
  }

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={`${labels.open}: ${column}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cx(
          'ms-z1 inline-flex size-[16px] items-center justify-center rounded-[2px]',
          'transition-colors duration-120 ease-out hover:bg-surface-3',
          current === '' ? 'text-ink-3' : 'text-accent',
        )}
      >
        {/* A funnel, drawn rather than imported: one glyph, no icon set. */}
        <svg viewBox="0 0 10 10" aria-hidden className="size-[10px]">
          <path d="M0.5 1h9L6 5v4L4 8V5z" fill="currentColor" stroke="none" />
        </svg>
      </button>

      {open ? (
        <form
          className="absolute top-[calc(100%+4px)] z-30 flex items-center gap-z1 rounded-card border border-border-strong bg-surface p-z2 shadow-lg"
          onSubmit={(event) => {
            event.preventDefault()
            const field = new FormData(event.currentTarget).get('value')
            commit(typeof field === 'string' ? field : '')
          }}
        >
          <input
            name="value"
            defaultValue={current}
            autoFocus
            aria-label={column}
            className="h-control-compact w-[140px] rounded-control border border-border-strong bg-surface px-z2 text-xs text-ink focus:border-accent focus:outline-none"
          />
          <button
            type="submit"
            className="h-control-compact rounded-control bg-accent px-z2 text-xs font-medium text-white"
          >
            {labels.apply}
          </button>
          <button
            type="button"
            onClick={() => commit('')}
            className="h-control-compact rounded-control px-z2 text-xs text-ink-2 hover:text-ink"
          >
            {labels.clear}
          </button>
        </form>
      ) : null}
    </span>
  )
}
