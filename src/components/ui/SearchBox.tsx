'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'

// ONE SEARCH BOX (TMS §7.4, v11.52 — owner's ruling 2026-11-23, Uktam item 2).
// The filter bar's search and All Loads' own box were two controls doing one
// job; this is the one, and both render it.
//
// SUBMIT, NOT KEYSTROKE. A debounce would put a database query behind every
// letter of a nine-character trip id and re-render the table under the typing
// hand. Enter is the gesture, and it is also what makes the resulting URL a
// thing somebody chose to create rather than a trail of nine of them in the
// history.
//
// THE PAGE GOES BACK TO 1. A search typed on page 4 of 6 that leaves `page=4`
// in the URL lands past the end of a two-page answer and reads as "nothing".

export interface SearchBoxProps {
  /** The query-string key. Appears in the shared URL. */
  param: string
  label: string
  placeholder?: string
  /** Show the label beside the box (the filter bar) or only to readers. */
  showLabel?: boolean
  className?: string
}

/** The URL after a search for `value` — pure, so a test can read it. */
export function searchedQuery(
  current: URLSearchParams,
  param: string,
  value: string,
): URLSearchParams {
  const next = new URLSearchParams(current.toString())
  const trimmed = value.trim()
  if (trimmed === '') next.delete(param)
  else next.set(param, trimmed)
  next.delete('page')
  return next
}

export function SearchBox({
  param,
  label,
  placeholder,
  showLabel = true,
  className,
}: SearchBoxProps) {
  const params = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const current = params.get(param) ?? ''

  return (
    <form
      role="search"
      className={className ?? 'flex items-center gap-z1'}
      onSubmit={(event) => {
        event.preventDefault()
        const field = new FormData(event.currentTarget).get(param)
        const next = searchedQuery(
          new URLSearchParams(params.toString()),
          param,
          typeof field === 'string' ? field : '',
        )
        router.replace(next.size > 0 ? `${pathname}?${next}` : pathname, {
          scroll: false,
        })
      }}
    >
      <label
        htmlFor={`search-${param}`}
        className={
          showLabel
            ? 'text-xs font-medium uppercase tracking-[0.04em] text-ink-3'
            : 'sr-only'
        }
      >
        {label}
      </label>
      <input
        id={`search-${param}`}
        name={param}
        type="search"
        dir="ltr"
        // `key` on the URL value so a cleared filter empties the box. Without
        // it the input keeps what was typed while the table shows everything,
        // which reads as a filter that stopped working.
        key={current}
        defaultValue={current}
        placeholder={placeholder}
        className="h-control-compact w-[200px] rounded-control border border-border-strong bg-surface px-z2 font-mono text-xs text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
      />
    </form>
  )
}
