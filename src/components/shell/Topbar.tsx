'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { cx } from '@/lib/cx'

// §6.1 — 48px. Search, company filter, notification bell, user menu.
//
// §6.3 AS AMENDED: the company control is a FILTER, not a switcher. It narrows
// the view; it does not put the interface into one authority. And it renders
// only when the organization holds more than one company — a single-authority
// customer never sees an authority picker anywhere.

export interface CompanyOption {
  id: string
  name: string
  /** The per-company chip colour, as a token name (§6.3). */
  tone: 'accent' | 'progress' | 'success' | 'warning' | 'danger' | 'muted'
}

const CHIP: Record<CompanyOption['tone'], string> = {
  accent: 'bg-accent',
  progress: 'bg-progress',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  muted: 'bg-muted',
}

interface TopbarProps {
  companies: readonly CompanyOption[]
  userInitials: string
  /** Pre-translated. A translator closure cannot cross to a client component. */
  labels: {
    searchHint: string
    allAuthorities: string
    authority: string
    notifications: string
    userMenu: string
  }
}

export function Topbar({ companies, userInitials, labels }: TopbarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  // §6.3: only when the org holds more than one authority.
  const showCompanyFilter = companies.length > 1
  const selected = params.get('company')

  const narrowTo = (companyId: string | null) => {
    const next = new URLSearchParams(params.toString())
    if (companyId === null) next.delete('company')
    else next.set('company', companyId)
    router.replace(next.size > 0 ? `${pathname}?${next}` : pathname, {
      scroll: false,
    })
  }

  return (
    <header className="flex h-topbar shrink-0 items-center gap-z4 border-b border-border bg-surface px-gutter">
      {/* ⌘K opens this properly in Phase 2; the affordance is here now so the
       * shell is not rearranged around it later. */}
      <button
        type="button"
        className="flex h-control-compact flex-1 items-center gap-z2 rounded-control border border-border-strong bg-surface-2 px-z2 text-start text-sm text-ink-3 hover:bg-surface-3"
      >
        <span>{labels.searchHint}</span>
        <kbd className="ms-auto font-mono text-xs text-ink-3">⌘K</kbd>
      </button>

      {showCompanyFilter ? (
        <div
          className="flex items-center gap-z1"
          role="group"
          aria-label={labels.authority}
        >
          <button
            type="button"
            aria-pressed={selected === null}
            onClick={() => narrowTo(null)}
            className={cx(
              'h-control-compact rounded-control border px-z2 text-xs font-medium',
              selected === null
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-border-strong bg-surface text-ink-2 hover:bg-surface-3',
            )}
          >
            {labels.allAuthorities}
          </button>
          {companies.map((company) => (
            <button
              key={company.id}
              type="button"
              aria-pressed={selected === company.id}
              onClick={() => narrowTo(company.id)}
              className={cx(
                'flex h-control-compact items-center gap-z1 rounded-control border px-z2 text-xs font-medium',
                selected === company.id
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-border-strong bg-surface text-ink-2 hover:bg-surface-3',
              )}
            >
              <span
                aria-hidden
                className={cx('h-z3 w-[3px] rounded-full', CHIP[company.tone])}
              />
              {company.name}
            </button>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        aria-label={labels.notifications}
        className="flex h-control-compact w-control-compact items-center justify-center rounded-control text-ink-2 hover:bg-surface-3"
      >
        <span aria-hidden>◔</span>
      </button>

      <button
        type="button"
        aria-label={labels.userMenu}
        className="flex h-control-compact w-control-compact items-center justify-center rounded-control border border-border-strong bg-surface-2 text-xs font-medium text-ink-2 hover:bg-surface-3"
      >
        {userInitials}
      </button>
    </header>
  )
}
