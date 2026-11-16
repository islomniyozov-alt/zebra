'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { cx } from '@/lib/cx'

// §6.7, the second pass (owner's brief 2026-11-16) — the loads list's one
// toolbar row: Filter · Pickup date · Delivery date · Reference search ·
// Authority · Export · Density · Columns. This file holds the two date ranges
// and the search; the Filter popover is `LoadFilters`.
//
// EVERY DATE CONTROL WRITES A NAMED VIEW (`?view=` and its `from`/`to`), never
// a raw date filter, so the counts and the list read it one way — and the list
// holds one view at a time, so filling the pickup range empties the delivery
// range.

export const CONTROL =
  'inline-flex h-control-compact items-center gap-z1 rounded-control border px-z2 text-xs font-medium'
export const CONTROL_IDLE =
  'border-border-strong bg-surface text-ink-2 hover:bg-surface-3'
export const CONTROL_ON = 'border-accent bg-accent-soft text-accent'

const INPUT =
  'h-control-compact rounded-control border border-border-strong bg-surface px-z2 font-mono text-xs text-ink focus:border-accent focus:outline-none'

/** The URL writer every toolbar control shares: drops `page`, keeps the tab. */
export function useListWriter() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  return {
    params,
    replace: (edit: (query: URLSearchParams) => void) => {
      const query = new URLSearchParams(params.toString())
      query.delete('page')
      edit(query)
      router.replace(query.size > 0 ? `${pathname}?${query}` : pathname, {
        scroll: false,
      })
    },
  }
}

/** A button and the panel it opens; closes on a click elsewhere and Escape. */
export function Popover({
  label,
  active,
  badge,
  width = 'w-[320px]',
  children,
}: {
  label: ReactNode
  active: boolean
  badge?: number
  width?: string
  children: ReactNode
}) {
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

  return (
    <div ref={wrapper} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={cx(CONTROL, active ? CONTROL_ON : CONTROL_IDLE)}
      >
        {label}
        {badge !== undefined && badge > 0 ? (
          <span className="rounded-full bg-accent px-z1 font-mono text-[11px] leading-[16px] text-surface tabular-nums">
            {badge}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          id={panelId}
          role="dialog"
          className={cx(
            'absolute start-0 top-[calc(100%+4px)] z-30 flex flex-col gap-z3 rounded-card border border-border-strong bg-surface p-z3 shadow-lg',
            width,
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Pickup date or Delivery date: a from–to range bound to one view. Closed it
 * reads its label, and the range when one is set.
 */
export function DateRangeFilter({
  which,
  labels,
}: {
  which: 'pickup' | 'delivery'
  labels: { label: string; from: string; to: string; clear: string }
}) {
  const { params, replace } = useListWriter()
  const active = params.get('view') === which
  const from = active ? (params.get('from') ?? '') : ''
  const to = active ? (params.get('to') ?? '') : ''

  // Clearing `from` clears the range: `to` alone is not a range.
  const set = (bound: 'from' | 'to', value: string) => {
    const nextFrom = bound === 'from' ? value : from
    const nextTo = bound === 'to' ? value : to
    replace((query) => {
      query.delete('from')
      query.delete('to')
      if (nextFrom === '') {
        if (active) query.delete('view')
        return
      }
      query.set('view', which)
      query.set('from', nextFrom)
      if (nextTo) query.set('to', nextTo)
    })
  }

  return (
    <Popover
      active={active && from !== ''}
      label={
        active && from !== '' ? (
          <span>
            {labels.label}{' '}
            <span className="font-mono tabular-nums" dir="ltr">
              {from}
              {to ? ` – ${to}` : ''}
            </span>
          </span>
        ) : (
          labels.label
        )
      }
    >
      <fieldset className="flex flex-col gap-z1">
        <legend className="mb-z1 text-xs font-medium uppercase tracking-[0.04em] text-ink-3">
          {labels.label}
        </legend>
        <div className="flex items-center gap-z1">
          <input
            type="date"
            aria-label={`${labels.label}: ${labels.from}`}
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
            aria-label={`${labels.label}: ${labels.to}`}
            key={`${which}-to-${to}`}
            defaultValue={to}
            onChange={(event) => set('to', event.target.value)}
            className={INPUT}
          />
        </div>
      </fieldset>
      {active ? (
        <button
          type="button"
          onClick={() => set('from', '')}
          className="self-start text-xs font-medium text-accent hover:underline"
        >
          {labels.clear}
        </button>
      ) : null}
    </Popover>
  )
}

/** The reference search: submit, not keystroke (§7.4). */
export function ReferenceSearch({
  label,
  placeholder,
}: {
  label: string
  placeholder: string
}) {
  const { params, replace } = useListWriter()
  const current = params.get('ref') ?? ''
  return (
    <form
      role="search"
      className="flex items-center"
      onSubmit={(event) => {
        event.preventDefault()
        const field = new FormData(event.currentTarget).get('ref')
        const value = typeof field === 'string' ? field.trim() : ''
        replace((query) => {
          if (value === '') query.delete('ref')
          else query.set('ref', value)
        })
      }}
    >
      <input
        name="ref"
        type="search"
        dir="ltr"
        aria-label={label}
        // `key` on the URL value so a cleared filter empties the box.
        key={current}
        defaultValue={current}
        placeholder={placeholder}
        className="h-control-compact w-[200px] rounded-control border border-border-strong bg-surface px-z2 font-mono text-xs text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
      />
    </form>
  )
}
