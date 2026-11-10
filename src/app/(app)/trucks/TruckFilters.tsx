'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { cx } from '@/lib/cx'

// §6.5 part 1 — the "Filters" button on the bar's second row, and what it
// opens: the status, the fleet status, the make, a year range and the
// warnings filter that used to be the "Needs attention" link. The badge counts
// how many of those are set, so a narrowed list says so without opening
// anything. Every control writes the URL and nothing else (§7.4).

interface Props {
  statuses: readonly { value: string; label: string }[]
  fleetStatuses: readonly string[]
  /** The fleet's own spellings, from the page's one `distinct` read. */
  makes: readonly string[]
  labels: {
    open: string
    status: string
    fleetStatus: string
    make: string
    anyMake: string
    year: string
    yearFrom: string
    yearTo: string
    warnings: string
    needsAttention: string
  }
}

// THE URL KEYS THIS POPOVER OWNS ARE `TRUCK_FILTER_PARAMS` IN THE LIB, not
// here. A value exported from a 'use client' module and imported by a server
// component arrives as a client REFERENCE, not the value: on dev, 2026-11-10,
// `TypeError: TRUCK_FILTER_PARAMS is not iterable` answered 500 on every
// /trucks request until the export moved. Only components cross that line.

const INPUT =
  'h-control-compact rounded-control border border-border-strong bg-surface px-z2 font-mono text-xs text-ink focus:border-accent focus:outline-none'

/** How many of the popover's filters are set: what the badge says. A year
 * range is one filter however many bounds it has. */
export function activeTruckFilterCount(params: URLSearchParams): number {
  return (
    (params.get('status') ? 1 : 0) +
    (params.get('fleet') ? 1 : 0) +
    (params.get('make') ? 1 : 0) +
    (params.get('yearFrom') || params.get('yearTo') ? 1 : 0) +
    (params.get('attention') === '1' ? 1 : 0)
  )
}

export function TruckFilters({
  statuses,
  fleetStatuses,
  makes,
  labels,
}: Props) {
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

  const count = activeTruckFilterCount(params)

  /** One key written or deleted; everything else in the URL kept. */
  const write = (key: string, value: string | null) => {
    const query = new URLSearchParams(params.toString())
    if (value === null || value === '') query.delete(key)
    else query.set(key, value)
    router.replace(query.size > 0 ? `${pathname}?${query}` : pathname, {
      scroll: false,
    })
  }

  const chip = (key: string, value: string, label: string) => {
    const active = params.get(key) === value
    return (
      <button
        key={value}
        type="button"
        aria-pressed={active}
        onClick={() => write(key, active ? null : value)}
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

  const group = (label: string, children: React.ReactNode) => (
    <div className="flex flex-col gap-z1">
      <span className="text-xs font-medium uppercase tracking-[0.04em] text-ink-3">
        {label}
      </span>
      <div className="flex flex-wrap gap-z1">{children}</div>
    </div>
  )

  // A YEAR IS WRITTEN WHEN THE FIELD IS LEFT OR ENTER IS PRESSED, not per
  // keystroke: "20" is not a year anyone meant, and a query behind each digit
  // would re-render the table under the typing hand (the search box's rule).
  const yearInput = (key: 'yearFrom' | 'yearTo', label: string) => (
    <input
      type="number"
      inputMode="numeric"
      min={1900}
      max={2100}
      aria-label={`${labels.year}: ${label}`}
      key={`${key}-${params.get(key) ?? ''}`}
      defaultValue={params.get(key) ?? ''}
      placeholder={label}
      onBlur={(event) => {
        if (event.target.value !== (params.get(key) ?? '')) {
          write(key, event.target.value)
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          write(key, (event.target as HTMLInputElement).value)
        }
      }}
      className={cx(INPUT, 'w-[88px]')}
    />
  )

  const attention = params.get('attention') === '1'

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
          {group(
            labels.status,
            statuses.map((status) =>
              chip('status', status.value, status.label),
            ),
          )}
          {group(
            labels.fleetStatus,
            fleetStatuses.map((value) => chip('fleet', value, value)),
          )}
          <label className="flex flex-col gap-z1 text-xs font-medium uppercase tracking-[0.04em] text-ink-3">
            {labels.make}
            <select
              value={params.get('make') ?? ''}
              onChange={(event) => write('make', event.target.value)}
              className={cx(INPUT, 'normal-case tracking-normal')}
            >
              <option value="">{labels.anyMake}</option>
              {makes.map((make) => (
                <option key={make} value={make}>
                  {make}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="flex flex-col gap-z1">
            <legend className="mb-z1 text-xs font-medium uppercase tracking-[0.04em] text-ink-3">
              {labels.year}
            </legend>
            <div className="flex items-center gap-z1">
              {yearInput('yearFrom', labels.yearFrom)}
              <span aria-hidden className="text-xs text-ink-3">
                –
              </span>
              {yearInput('yearTo', labels.yearTo)}
            </div>
          </fieldset>
          {group(
            labels.warnings,
            <button
              type="button"
              aria-pressed={attention}
              onClick={() => write('attention', attention ? null : '1')}
              className={cx(
                'h-control-compact rounded-control border px-z2 text-xs font-medium',
                attention
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-border-strong bg-surface text-ink-2 hover:bg-surface-3',
              )}
            >
              {labels.needsAttention}
            </button>,
          )}
        </div>
      ) : null}
    </div>
  )
}
