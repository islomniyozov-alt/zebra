'use client'

import { useId, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { cx } from '@/lib/cx'
import type { FilterOption } from '@/lib/load-filter-options'
import { loadFilterOptionsAction } from './filter-actions'

// §6.7 item 2 — a broker or driver filter you type into.
//
// THE OPTIONS ARRIVE ON FIRST FOCUS, through one server action, rather than in
// every render of the list. What is chosen lives in the URL as an id
// (`?customer=`, `?driver=`), so the list, its counts and a shared link all
// agree, and the name shown here comes from the server, which looked it up.

interface Props {
  param: 'customer' | 'driver'
  /** The chosen option's name, looked up by the page. Null when none is set. */
  selectedLabel: string | null
  labels: {
    label: string
    placeholder: string
    loading: string
    noMatch: string
    failed: string
    clear: string
  }
}

/** How many matches to show at once. More than this is a list, not a hint. */
const SHOWN = 8

export function TypeaheadFilter({ param, selectedLabel, labels }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)

  const [options, setOptions] = useState<FilterOption[] | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const chosen = params.get(param)

  const load = async () => {
    if (options !== null || state === 'loading') return
    setState('loading')
    try {
      setOptions(await loadFilterOptionsAction(param))
      setState('idle')
    } catch {
      // A sentence, not a spinner that never ends (§7.11).
      setState('failed')
    }
  }

  const matches = useMemo(() => {
    if (options === null) return []
    const needle = query.trim().toLowerCase()
    const hits =
      needle === ''
        ? options
        : options.filter((option) =>
            option.label.toLowerCase().includes(needle),
          )
    return hits.slice(0, SHOWN)
  }, [options, query])

  /** Write the param, and drop `page`: a narrower list starts at page one. */
  const go = (id: string | null) => {
    const next = new URLSearchParams(params.toString())
    next.delete('page')
    if (id === null) next.delete(param)
    else next.set(param, id)
    router.replace(next.size > 0 ? `${pathname}?${next}` : pathname, {
      scroll: false,
    })
    setOpen(false)
    setQuery('')
  }

  const status =
    state === 'loading'
      ? labels.loading
      : state === 'failed'
        ? labels.failed
        : options !== null && matches.length === 0
          ? labels.noMatch
          : null

  return (
    <div className="relative flex items-center gap-z1">
      <label
        htmlFor={`${listId}-input`}
        className="text-xs font-medium uppercase tracking-[0.04em] text-ink-3"
      >
        {labels.label}
      </label>
      <input
        ref={inputRef}
        id={`${listId}-input`}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && matches[active] ? `${listId}-${active}` : undefined
        }
        // THE CHOSEN NAME UNTIL SOMEBODY TYPES. Keyed on the URL value so a
        // cleared filter empties the box rather than keeping a stale name.
        key={chosen ?? ''}
        defaultValue={chosen ? (selectedLabel ?? '') : ''}
        placeholder={labels.placeholder}
        onFocus={() => {
          setOpen(true)
          void load()
        }}
        onBlur={() => setOpen(false)}
        onChange={(event) => {
          setQuery(event.target.value)
          setActive(0)
          setOpen(true)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setOpen(true)
            setActive((index) => Math.min(index + 1, matches.length - 1))
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActive((index) => Math.max(index - 1, 0))
          } else if (event.key === 'Enter') {
            const hit = matches[active]
            if (open && hit) {
              event.preventDefault()
              go(hit.id)
              inputRef.current?.blur()
            }
          } else if (event.key === 'Escape') {
            setOpen(false)
          }
        }}
        className={cx(
          'h-control-compact w-[180px] rounded-control border bg-surface px-z2 text-xs text-ink',
          'placeholder:text-ink-3 focus:border-accent focus:outline-none',
          chosen ? 'border-accent' : 'border-border-strong',
        )}
      />
      {chosen ? (
        <button
          type="button"
          onClick={() => go(null)}
          aria-label={`${labels.clear}: ${labels.label}`}
          className="h-control-compact rounded-control px-z1 text-xs text-ink-3 hover:text-ink"
        >
          ×
        </button>
      ) : null}
      {open && (status !== null || matches.length > 0) ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={labels.label}
          className="absolute start-0 top-[calc(100%+4px)] z-20 max-h-[280px] min-w-[240px] overflow-auto rounded-card border border-border-strong bg-surface py-z1 shadow-lg"
        >
          {status !== null ? (
            <li className="px-z2 py-z1 text-xs text-ink-3">{status}</li>
          ) : (
            matches.map((option, index) => (
              <li
                key={option.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                // `mousedown`, not `click`: the input's blur closes the list
                // before a click would land.
                onMouseDown={(event) => {
                  event.preventDefault()
                  go(option.id)
                }}
                onMouseEnter={() => setActive(index)}
                className={cx(
                  'cursor-pointer px-z2 py-z1 text-xs text-ink',
                  index === active && 'bg-surface-3',
                )}
              >
                {option.label}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  )
}
