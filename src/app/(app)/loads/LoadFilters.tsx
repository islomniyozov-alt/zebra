'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { cx } from '@/lib/cx'
import { TypeaheadFilter } from './TypeaheadFilter'

// §6.7 chain two — the "Filters" button on the bar's second row, and what it
// opens: the two date presets, a pickup range, a delivery range, the broker and
// the driver. The badge counts how many of those are set, so a narrowed list
// says so without opening anything.
//
// EVERY DATE CONTROL WRITES A NAMED VIEW (`?view=` and, for a range, `from` and
// `to`), never a raw date filter, so the counts and the list read it one way.
// The list holds one view at a time: filling the pickup range empties the
// delivery range, and choosing Upcoming on the bar clears both.

const DATE_VIEWS = [
  'picksUpToday',
  'deliversThisWeek',
  'pickup',
  'delivery',
] as const

interface Props {
  selected: { customer: string | null; driver: string | null }
  labels: {
    open: string
    dates: string
    picksUpToday: string
    deliversThisWeek: string
    pickupRange: string
    deliveryRange: string
    from: string
    to: string
    broker: {
      label: string
      placeholder: string
      loading: string
      noMatch: string
      failed: string
      clear: string
    }
    driver: {
      label: string
      placeholder: string
      loading: string
      noMatch: string
      failed: string
      clear: string
    }
  }
}

const INPUT =
  'h-control-compact rounded-control border border-border-strong bg-surface px-z2 font-mono text-xs text-ink focus:border-accent focus:outline-none'

/** How many of the popover's filters are set: what the badge says. */
export function activeFilterCount(params: URLSearchParams): number {
  const view = params.get('view')
  return (
    (view !== null && (DATE_VIEWS as readonly string[]).includes(view)
      ? 1
      : 0) +
    (params.get('customer') ? 1 : 0) +
    (params.get('driver') ? 1 : 0)
  )
}

export function LoadFilters({ selected, labels }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const wrapper = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const view = params.get('view')
  const count = activeFilterCount(params)

  /** One write for the view and its bounds, dropping `page`. */
  const write = (next: { view: string | null; from?: string; to?: string }) => {
    const query = new URLSearchParams(params.toString())
    query.delete('page')
    query.delete('from')
    query.delete('to')
    if (next.view === null) query.delete('view')
    else query.set('view', next.view)
    if (next.from) query.set('from', next.from)
    if (next.to) query.set('to', next.to)
    router.replace(query.size > 0 ? `${pathname}?${query}` : pathname, {
      scroll: false,
    })
  }

  const preset = (name: 'picksUpToday' | 'deliversThisWeek', label: string) => {
    const active = view === name
    return (
      <button
        type="button"
        aria-pressed={active}
        onClick={() => write({ view: active ? null : name })}
        className={cx(
          'h-control-compact rounded-control border px-z2 text-xs font-medium',
          active
            ? 'border-accent bg-accent-soft text-accent'
            : 'border-border-strong bg-surface text-ink-2 hover:bg-surface-3',
        )}
      >
        {label}
      </button>
    )
  }

  /** A range bound to one view. Its inputs read the URL only when it is active. */
  const range = (which: 'pickup' | 'delivery', label: string) => {
    const active = view === which
    const from = active ? (params.get('from') ?? '') : ''
    const to = active ? (params.get('to') ?? '') : ''
    // Clearing `from` clears the range: `to` alone is not a range.
    const set = (bound: 'from' | 'to', value: string) => {
      const nextFrom = bound === 'from' ? value : from
      const nextTo = bound === 'to' ? value : to
      if (nextFrom === '') write({ view: active ? null : view })
      else write({ view: which, from: nextFrom, to: nextTo })
    }
    return (
      <fieldset className="flex flex-col gap-z1">
        <legend className="mb-z1 text-xs font-medium uppercase tracking-[0.04em] text-ink-3">
          {label}
        </legend>
        <div className="flex items-center gap-z1">
          <input
            type="date"
            aria-label={`${label}: ${labels.from}`}
            key={`${which}-from-${from}`}
            defaultValue={from}
            onChange={(event) => set('from', event.target.value)}
            className={INPUT}
          />
          <span aria-hidden className="text-xs text-ink-3">
            –
          </span>
          <input
            type="date"
            aria-label={`${label}: ${labels.to}`}
            key={`${which}-to-${to}`}
            defaultValue={to}
            onChange={(event) => set('to', event.target.value)}
            className={INPUT}
          />
        </div>
      </fieldset>
    )
  }

  return (
    <div ref={wrapper} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={cx(
          'inline-flex h-control-compact items-center gap-z1 rounded-control border px-z2 text-xs font-medium',
          count > 0
            ? 'border-accent bg-accent-soft text-accent'
            : 'border-border-strong bg-surface text-ink-2 hover:bg-surface-3',
        )}
      >
        {labels.open}
        {count > 0 ? (
          <span className="rounded-full bg-accent px-z1 font-mono text-[11px] leading-[16px] text-surface tabular-nums">
            {count}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label={labels.open}
          className="absolute start-0 top-[calc(100%+4px)] z-30 flex w-[360px] flex-col gap-z3 rounded-card border border-border-strong bg-surface p-z3 shadow-lg"
        >
          <div className="flex flex-col gap-z1">
            <span className="text-xs font-medium uppercase tracking-[0.04em] text-ink-3">
              {labels.dates}
            </span>
            <div className="flex flex-wrap gap-z1">
              {preset('picksUpToday', labels.picksUpToday)}
              {preset('deliversThisWeek', labels.deliversThisWeek)}
            </div>
          </div>
          {range('pickup', labels.pickupRange)}
          {range('delivery', labels.deliveryRange)}
          <TypeaheadFilter
            param="customer"
            selectedLabel={selected.customer}
            labels={labels.broker}
          />
          <TypeaheadFilter
            param="driver"
            selectedLabel={selected.driver}
            labels={labels.driver}
          />
        </div>
      ) : null}
    </div>
  )
}
