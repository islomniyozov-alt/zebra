'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'
import { Button } from './Button'
import { cx } from '@/lib/cx'

// §7.4. Sits directly under the page title, never in a drawer. Chips, not
// dropdown menus, for the two or three filters a screen actually uses;
// everything else behind "More filters".
//
// FILTER STATE SERIALISES INTO THE URL. That is the whole feature: a
// dispatcher sends a filtered board to a colleague by pasting a link. It also
// means back/forward work and a reload keeps the view — none of which is true
// of filters held in component state.

export interface FilterChoice {
  value: string
  label: string
  /**
   * How many rows this chip would show, counted by the caller from the same
   * predicate the chip filters by.
   *
   * Optional because not every filter can be counted cheaply — a chip without
   * one renders exactly as it used to. Where it IS given, zero is shown rather
   * than hidden: "Delivered (0)" says the day is clear, and a chip that
   * disappeared would read as a filter that broke.
   */
  count?: number
}

export interface FilterGroup {
  /** The query-string key. Appears in the shared URL, so keep it readable. */
  param: string
  label: string
  choices: readonly FilterChoice[]
}

/**
 * A free-text box whose value lands in the URL like every chip does.
 *
 * OPTIONAL, and absent by default: most boards here are answered by chips, and
 * a search box on a screen with nothing worth typing is furniture. The loads
 * list has one because "is trip T-115HXB4HH in the system?" is a question with
 * a typed answer and no chip can hold it.
 */
export interface FilterSearch {
  /** The query-string key, same contract as a group's `param`. */
  param: string
  label: string
  placeholder: string
}

interface FilterBarProps {
  groups: readonly FilterGroup[]
  search?: FilterSearch
  clearLabel: string
  moreLabel: string
}

export function FilterBar({
  groups,
  search,
  clearLabel,
  moreLabel,
}: FilterBarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const toggle = useCallback(
    (param: string, value: string) => {
      const next = new URLSearchParams(params.toString())
      if (next.get(param) === value) {
        next.delete(param)
      } else {
        next.set(param, value)
      }
      router.replace(next.size > 0 ? `${pathname}?${next}` : pathname, {
        scroll: false,
      })
    },
    [params, pathname, router],
  )

  // SUBMIT, NOT KEYSTROKE. A debounce would put a database query behind every
  // letter of a nine-character trip id and re-render the table under the
  // typing hand. Enter is the gesture, and it is also what makes the resulting
  // URL a thing somebody chose to create rather than a trail of nine of them
  // in the history.
  const submitSearch = useCallback(
    (value: string) => {
      if (!search) return
      const next = new URLSearchParams(params.toString())
      const trimmed = value.trim()
      if (trimmed === '') next.delete(search.param)
      else next.set(search.param, trimmed)
      router.replace(next.size > 0 ? `${pathname}?${next}` : pathname, {
        scroll: false,
      })
    },
    [params, pathname, router, search],
  )

  const active =
    groups.some((group) => params.get(group.param) !== null) ||
    (search !== undefined && params.get(search.param) !== null)

  return (
    <div className="flex flex-wrap items-center gap-z2 border-b border-border bg-surface px-gutter py-z2">
      {groups.map((group) => (
        <div key={group.param} className="flex items-center gap-z1">
          <span className="text-xs font-medium uppercase tracking-[0.04em] text-ink-3">
            {group.label}
          </span>
          {group.choices.map((choice) => {
            const selected = params.get(group.param) === choice.value
            return (
              <button
                key={choice.value}
                type="button"
                aria-pressed={selected}
                onClick={() => toggle(group.param, choice.value)}
                className={cx(
                  'h-control-compact rounded-control border px-z2 text-xs font-medium',
                  'transition-colors duration-120 ease-out',
                  selected
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-border-strong bg-surface text-ink-2 hover:bg-surface-3',
                )}
              >
                {choice.label}
                {choice.count === undefined ? null : (
                  // Dimmer than the label and tabular, so a column of chips
                  // stays scannable and the numbers line up rather than
                  // jittering as they change.
                  <span
                    className={cx(
                      'ms-z1 font-mono tabular-nums',
                      selected ? 'text-accent' : 'text-ink-3',
                    )}
                  >
                    {choice.count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      ))}

      {search ? (
        <form
          className="flex items-center gap-z1"
          onSubmit={(event) => {
            event.preventDefault()
            const field = new FormData(event.currentTarget).get(search.param)
            submitSearch(typeof field === 'string' ? field : '')
          }}
        >
          <label
            htmlFor={`filter-${search.param}`}
            className="text-xs font-medium uppercase tracking-[0.04em] text-ink-3"
          >
            {search.label}
          </label>
          <input
            id={`filter-${search.param}`}
            name={search.param}
            type="search"
            dir="ltr"
            // `key` on the URL value so a cleared filter empties the box.
            // Without it the input keeps what was typed while the table shows
            // everything, which reads as a filter that stopped working.
            key={params.get(search.param) ?? ''}
            defaultValue={params.get(search.param) ?? ''}
            placeholder={search.placeholder}
            className="h-control-compact rounded-control border border-border-strong bg-surface px-z2 font-mono text-xs text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
          />
        </form>
      ) : null}

      <Button variant="ghost" size="compact" disabled>
        {moreLabel}
      </Button>

      {/* Only offered when there is something to clear. An always-present
       * "Clear filters" on an unfiltered view is noise. */}
      {active ? (
        <Button
          variant="ghost"
          size="compact"
          onClick={() => router.replace(pathname, { scroll: false })}
          className="ms-auto"
        >
          {clearLabel}
        </Button>
      ) : null}
    </div>
  )
}
