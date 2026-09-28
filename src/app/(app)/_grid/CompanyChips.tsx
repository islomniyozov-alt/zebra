'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { cx } from '@/lib/cx'

interface Props {
  companies: readonly { id: string; name: string }[]
  label: string
  allLabel: string
}

/**
 * §6.3 and §7.4.2 — the company filter on a financial list.
 *
 * ── ONLY WHERE THERE IS MORE THAN ONE AUTHORITY ───────────────────────────
 *
 * §6.3 is explicit: a single-authority organization sees no filter, no column
 * and no chip. Rendering an "All / RAM Haulage" pair for an org with one company
 * is a control with one setting, which teaches people the control does nothing.
 *
 * ── IT PRESERVES EVERY OTHER PARAM ────────────────────────────────────────
 *
 * The same reason `sortHref` does: a company chip that dropped `from`, `to` and
 * `q` would widen the totals row under the reader's hand. This is the bug the
 * old `CompanyFilter` had by construction — it wrote `/money/this-week?company=`
 * from scratch, so picking an authority cleared everything else. That screen had
 * nothing else to clear; a list with four controls does.
 *
 * ── ALL IS FIRST AND IS THE DEFAULT ───────────────────────────────────────
 *
 * The org-wide view is the one the settlement ruling is about (Islom,
 * 2026-09-11). A filter that remembered its last setting would quietly make the
 * exception into the normal case.
 */
export function CompanyChips({ companies, label, allLabel }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  if (companies.length < 2) return null

  const selected = params.get('company')

  const go = (id: string | null) => {
    const next = new URLSearchParams(params.toString())
    if (id === null) next.delete('company')
    else next.set('company', id)
    router.replace(next.size > 0 ? `${pathname}?${next}` : pathname, {
      scroll: false,
    })
  }

  const chip = (id: string | null, name: string) => {
    const active = selected === id
    return (
      <button
        key={id ?? 'all'}
        type="button"
        aria-pressed={active}
        onClick={() => go(id)}
        className={cx(
          'h-control-compact rounded-control border px-z2 text-xs font-medium',
          'transition-colors duration-120 ease-out',
          active
            ? 'border-accent bg-accent-soft text-accent'
            : 'border-border-strong bg-surface text-ink-2 hover:bg-surface-3',
        )}
      >
        {name}
      </button>
    )
  }

  return (
    <div
      className="flex flex-wrap items-center gap-z1 border-b border-border bg-surface px-gutter py-z2"
      role="group"
      aria-label={label}
    >
      <span className="text-xs font-medium uppercase tracking-[0.04em] text-ink-3">
        {label}
      </span>
      {chip(null, allLabel)}
      {companies.map((company) => chip(company.id, company.name))}
    </div>
  )
}
