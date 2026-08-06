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

interface FilterBarProps {
  groups: readonly FilterGroup[]
  clearLabel: string
  moreLabel: string
}

export function FilterBar({ groups, clearLabel, moreLabel }: FilterBarProps) {
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

  const active = groups.some((group) => params.get(group.param) !== null)

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
