'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, type ReactNode } from 'react'
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
  /**
   * Tells two groups apart when they share a `param` (§6.7: the date presets
   * and the Upcoming/Unpaid chips are both `?view=`, so choosing one clears the
   * other). Defaults to `param`.
   */
  id?: string
  label: string
  choices: readonly FilterChoice[]
  /**
   * Cap each chip's width and truncate, with the full label as its title. For
   * chips that are names (the authorities), so a long legal name cannot push a
   * one-row bar past 1920 (§6.7 chain two).
   */
  truncate?: boolean
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

/**
 * §7.4.1 — two date inputs, and the label says WHICH DATE they bound.
 *
 * "Delivered", "Issued", "Paid" — never a bare "Date". Every financial list has
 * more than one date on it, and an unlabelled range is a filter nobody can
 * predict. Either end alone is valid: `from` with nothing after it means since.
 *
 * The keys are fixed at `from` and `to` rather than configurable, because the
 * bounds are read back by `readListParams`, and a screen that named them
 * something else would be a screen whose URL the shared reader could not parse.
 */
export interface FilterRange {
  /** What the range is ABOUT, translated. Rendered before the inputs. */
  label: string
  fromLabel: string
  toLabel: string
}

interface FilterBarProps {
  groups: readonly FilterGroup[]
  search?: FilterSearch
  range?: FilterRange
  clearLabel: string
  moreLabel: string
  /** Further controls a screen owns, rendered after the search (§6.7). */
  children?: ReactNode
  /**
   * The URL keys those controls write, so "Clear filters" appears when only
   * they are set. Clearing always clears every key.
   */
  extraParams?: readonly string[]
  /**
   * `twoRows` (§6.7 chain two, the loads list): every chip on row one, which
   * never wraps and scrolls sideways instead; the search, the screen's own
   * controls and Clear filters on row two. Group labels are spoken, not shown,
   * because every chip already says what it is. Default `wrap` is the bar every
   * other screen has always had.
   */
  layout?: 'wrap' | 'twoRows'
}

/** A wrapper element only when `on`, so one tree serves both layouts. */
function Wrap({
  on,
  className,
  children,
}: {
  on: boolean
  className: string
  children: ReactNode
}) {
  return on ? <div className={className}>{children}</div> : <>{children}</>
}

export function FilterBar({
  groups,
  search,
  range,
  clearLabel,
  moreLabel,
  children,
  extraParams = [],
  layout = 'wrap',
}: FilterBarProps) {
  const twoRows = layout === 'twoRows'
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

  // ON CHANGE, NOT ON SUBMIT, and deliberately unlike the search box above. A
  // date input fires `change` when a day is picked, not per keystroke, so there
  // is no query behind every character and nothing to debounce — and a range
  // that needed a separate Apply would be a control people leave half-set.
  const setDay = useCallback(
    (param: 'from' | 'to', value: string) => {
      const next = new URLSearchParams(params.toString())
      if (value === '') next.delete(param)
      else next.set(param, value)
      router.replace(next.size > 0 ? `${pathname}?${next}` : pathname, {
        scroll: false,
      })
    },
    [params, pathname, router],
  )

  const active =
    groups.some((group) => params.get(group.param) !== null) ||
    (search !== undefined && params.get(search.param) !== null) ||
    (range !== undefined &&
      (params.get('from') !== null || params.get('to') !== null)) ||
    extraParams.some((param) => params.get(param) !== null)

  return (
    <div
      data-filter-bar
      className={cx(
        'border-b border-border bg-surface px-gutter py-z2',
        twoRows ? 'flex flex-col gap-z2' : 'flex flex-wrap items-center gap-z2',
      )}
    >
      <Wrap
        on={twoRows}
        className="flex flex-nowrap items-center gap-z2 overflow-x-auto"
      >
        {groups.map((group, index) => (
          <div
            key={group.id ?? group.param}
            role="group"
            aria-label={group.label}
            className={cx(
              'flex shrink-0 items-center gap-z1',
              twoRows && index > 0 && 'border-s border-border ps-z2',
            )}
          >
            <span
              className={cx(
                'text-xs font-medium uppercase tracking-[0.04em] text-ink-3',
                twoRows && 'sr-only',
              )}
            >
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
                  title={group.truncate ? choice.label : undefined}
                  className={cx(
                    'h-control-compact rounded-control border px-z2 text-xs font-medium',
                    'transition-colors duration-120 ease-out',
                    group.truncate && 'max-w-[128px] truncate',
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
      </Wrap>

      <Wrap on={twoRows} className="flex flex-wrap items-center gap-z2">
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

        {range ? (
          <div className="flex items-center gap-z1">
            {/* WHICH DATE, said once, before both inputs (§7.4.1). */}
            <span className="text-xs font-medium uppercase tracking-[0.04em] text-ink-3">
              {range.label}
            </span>
            <input
              type="date"
              aria-label={range.fromLabel}
              key={`from-${params.get('from') ?? ''}`}
              defaultValue={params.get('from') ?? ''}
              onChange={(event) => setDay('from', event.target.value)}
              className="h-control-compact rounded-control border border-border-strong bg-surface px-z2 font-mono text-xs text-ink focus:border-accent focus:outline-none"
            />
            <span aria-hidden className="text-xs text-ink-3">
              –
            </span>
            <input
              type="date"
              aria-label={range.toLabel}
              key={`to-${params.get('to') ?? ''}`}
              defaultValue={params.get('to') ?? ''}
              onChange={(event) => setDay('to', event.target.value)}
              className="h-control-compact rounded-control border border-border-strong bg-surface px-z2 font-mono text-xs text-ink focus:border-accent focus:outline-none"
            />
          </div>
        ) : null}

        {children}

        {/* In two rows the screen's own controls take this place (§6.7). */}
        {twoRows ? null : (
          <Button variant="ghost" size="compact" disabled>
            {moreLabel}
          </Button>
        )}

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
      </Wrap>
    </div>
  )
}
