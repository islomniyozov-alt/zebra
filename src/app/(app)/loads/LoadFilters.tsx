'use client'

import { cx } from '@/lib/cx'
import { TypeaheadFilter } from './TypeaheadFilter'
import {
  CONTROL_IDLE,
  CONTROL_ON,
  Popover,
  useListWriter,
} from './ToolbarControls'

// §6.7, the second pass — the "Filter" button that opens the toolbar row, and
// what it opens: the two date presets, the broker, the driver, and Clear
// filters. The badge counts how many of those are set, so a narrowed list says
// so without opening anything. The two date RANGES are controls of their own
// on the row (`DateRangeFilter`).
//
// A PRESET IS A NAMED VIEW (`?view=`), like the ranges, so choosing one empties
// a range and the list holds one view at a time.

const PRESETS = ['picksUpToday', 'deliversThisWeek'] as const

/** The URL keys the toolbar filters on — what Clear filters removes. */
export const FILTER_PARAMS = [
  'view',
  'from',
  'to',
  'ref',
  'company',
  'customer',
  'driver',
  'status',
  'billing',
] as const

interface Props {
  selected: { customer: string | null; driver: string | null }
  labels: {
    open: string
    dates: string
    picksUpToday: string
    deliversThisWeek: string
    clear: string
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

/** How many of the popover's filters are set: what the badge says. */
export function activeFilterCount(params: URLSearchParams): number {
  const view = params.get('view')
  return (
    (view !== null && (PRESETS as readonly string[]).includes(view) ? 1 : 0) +
    (params.get('customer') ? 1 : 0) +
    (params.get('driver') ? 1 : 0)
  )
}

/** Whether anything on the toolbar narrows the list; the tab does not. */
export function anyFilter(params: URLSearchParams): boolean {
  return FILTER_PARAMS.some((key) => params.get(key) !== null)
}

export function LoadFilters({ selected, labels }: Props) {
  const { params, replace } = useListWriter()
  const view = params.get('view')
  const count = activeFilterCount(params)

  const preset = (name: (typeof PRESETS)[number], label: string) => {
    const active = view === name
    return (
      <button
        type="button"
        aria-pressed={active}
        onClick={() =>
          replace((query) => {
            query.delete('from')
            query.delete('to')
            if (active) query.delete('view')
            else query.set('view', name)
          })
        }
        className={cx(
          'h-control-compact rounded-control border px-z2 text-xs font-medium',
          active ? CONTROL_ON : CONTROL_IDLE,
        )}
      >
        {label}
      </button>
    )
  }

  return (
    <Popover label={labels.open} active={count > 0} badge={count}>
      <div className="flex flex-col gap-z1">
        <span className="text-xs font-medium uppercase tracking-[0.04em] text-ink-3">
          {labels.dates}
        </span>
        <div className="flex flex-wrap gap-z1">
          {preset('picksUpToday', labels.picksUpToday)}
          {preset('deliversThisWeek', labels.deliversThisWeek)}
        </div>
      </div>
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
      {/* EVERY FILTER ON THE ROW, NEVER THE TAB: a tab is a question, not a
       * narrowing of one. */}
      {anyFilter(params) ? (
        <button
          type="button"
          onClick={() =>
            replace((query) => {
              for (const key of FILTER_PARAMS) query.delete(key)
            })
          }
          className="self-start text-xs font-medium text-accent hover:underline"
        >
          {labels.clear}
        </button>
      ) : null}
    </Popover>
  )
}
