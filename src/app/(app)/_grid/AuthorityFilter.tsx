'use client'

import { useId } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

interface Props {
  companies: readonly {
    id: string
    name: string
    /** Rows this authority would show. Inside the option, never beside the control. */
    count?: number
  }[]
  /** "Authority" — the word shown before the value while the control is closed. */
  label: string
  /**
   * "All". Omit on a screen where every view is one authority's — the
   * accident register — and the first authority (or `defaultTo`) is shown.
   */
  allLabel?: string
  /** The id shown when the URL names none and there is no All. */
  defaultTo?: string
}

/**
 * §6.3 (amended 2026-11-06) and §7.4.2 — THE AUTHORITY FILTER, A DROPDOWN.
 *
 * ── THE AUTHORITIES ARE NEVER ON SCREEN UNLESS THE USER OPENS THIS ────────
 *
 * Owner's ruling on dev, third round: someone beside the owner's screen must
 * not read the list of companies. The chip row this replaced named every
 * authority all the time on every screen that carried it. Closed, this reads
 * `Authority: All` or the one selected name — and that is all it reads. The
 * list exists only while the native `<select>` is open, drawn by the browser
 * on demand and gone on blur. There is no custom popover to leave open and
 * no chip to leave lit.
 *
 * ── ONLY WHERE THERE IS MORE THAN ONE AUTHORITY ───────────────────────────
 *
 * §6.3 is explicit: a single-authority organization sees no filter, no column
 * and no chip. A control with one setting teaches people the control does
 * nothing.
 *
 * ── IT PRESERVES EVERY OTHER PARAM ────────────────────────────────────────
 *
 * The same reason `sortHref` does: a filter that dropped `from`, `to`, `q`,
 * `ref` or `view` would widen the totals row under the reader's hand. `All`
 * DELETES the key rather than writing an empty one, so the URL a reader
 * copies is the URL they had before they touched this.
 *
 * ── ALL IS FIRST AND IS THE DEFAULT ───────────────────────────────────────
 *
 * The org-wide view is the one the settlement ruling is about (Islom,
 * 2026-09-11). A filter that remembered its last setting would quietly make
 * the exception into the normal case. The accident register is the one
 * screen with no All, because every view of it is one company's register;
 * it passes no `allLabel` and the first authority is shown.
 *
 * ── COUNTS GO INSIDE THE OPTIONS ──────────────────────────────────────────
 *
 * `RAM Haulage (12)` in the list, nothing beside the closed control: counts
 * beside it would be the list again, in numbers.
 */
export function AuthorityFilter({
  companies,
  label,
  allLabel,
  defaultTo,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const id = useId()

  if (companies.length < 2) return null

  const inUrl = params.get('company')
  const known = inUrl !== null && companies.some((c) => c.id === inUrl)
  const selected = known
    ? inUrl
    : allLabel === undefined
      ? (defaultTo ?? companies[0]?.id ?? '')
      : ''

  const go = (value: string) => {
    const next = new URLSearchParams(params.toString())
    if (value === '') next.delete('company')
    else next.set('company', value)
    router.replace(next.size > 0 ? `${pathname}?${next}` : pathname, {
      scroll: false,
    })
  }

  return (
    <label
      htmlFor={id}
      className="inline-flex items-center gap-z1 text-xs font-medium text-ink-2"
    >
      <span className="uppercase tracking-[0.04em] text-ink-3">{label}:</span>
      <select
        id={id}
        value={selected}
        onChange={(event) => go(event.target.value)}
        className="h-control-compact max-w-[16rem] truncate rounded-control border border-border-strong bg-surface px-z2 text-xs font-medium text-ink hover:bg-surface-3"
      >
        {allLabel === undefined ? null : <option value="">{allLabel}</option>}
        {companies.map((company) => (
          <option key={company.id} value={company.id}>
            {company.count === undefined
              ? company.name
              : `${company.name} (${String(company.count)})`}
          </option>
        ))}
      </select>
    </label>
  )
}
