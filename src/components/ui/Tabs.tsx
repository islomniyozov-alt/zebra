import Link from 'next/link'
import { cx } from '@/lib/cx'

export interface TabSpec {
  /** The `?tab=` value. Readable, because it appears in a shared URL. */
  key: string
  /** Already translated by the caller — this component does no i18n. */
  label: string
  /** Optional row count, shown dimmed. Zero is SHOWN, never hidden. */
  count?: number
}

interface TabsProps {
  tabs: readonly TabSpec[]
  active: string
  /** Where each tab points, built by the page from its own params. */
  hrefFor: (key: string) => string
  /** Names the set for a screen reader: "Payroll views". */
  label: string
}

/**
 * §7.1.6 — tabs across the top, one grid below.
 *
 * ── A TAB IS A DIFFERENT QUESTION, NEVER A FILTER ─────────────────────────
 *
 * "Unapplied" is a chip; "Balances" is a tab. The test is whether the tab could
 * be written as a filter on the tab beside it — if it could, it is a chip and it
 * belongs in the filter bar. Getting this wrong produces a page where the same
 * rows appear under three headings and nobody can say which one is authoritative.
 *
 * ── LINKS, NOT BUTTONS ────────────────────────────────────────────────────
 *
 * The same argument §7.4 makes for filters: the tab is in the URL, so a view is
 * something one person sends another, back/forward work, and a reload keeps the
 * place. It also keeps this a server component, which means a tab switch is one
 * request rather than a client fetch plus a spinner.
 *
 * ── A COUNT OF ZERO IS SHOWN ──────────────────────────────────────────────
 *
 * Same rule as §7.4's chips: "One-time charges (0)" says the week is clean, and a
 * count that disappeared would read as a tab that failed to load.
 */
export function Tabs({ tabs, active, hrefFor, label }: TabsProps) {
  return (
    <nav
      aria-label={label}
      className="flex items-stretch gap-z1 border-b border-border bg-surface px-gutter"
    >
      {tabs.map((tab) => {
        const current = tab.key === active
        return (
          <Link
            key={tab.key}
            href={hrefFor(tab.key)}
            scroll={false}
            aria-current={current ? 'page' : undefined}
            className={cx(
              'inline-flex items-center gap-z1 border-b-2 px-z3 py-z2 text-base font-medium',
              'transition-colors duration-120 ease-out',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
              current
                ? 'border-accent text-ink'
                : 'border-transparent text-ink-2 hover:text-ink',
            )}
          >
            {tab.label}
            {tab.count === undefined ? null : (
              <span
                className={cx(
                  'font-mono tabular-nums',
                  current ? 'text-ink-3' : 'text-ink-3',
                )}
              >
                {tab.count}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
