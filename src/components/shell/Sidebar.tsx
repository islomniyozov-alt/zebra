'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cx } from '@/lib/cx'

// §6.2 — the destinations, grouped (Operations, Fleet, Accounting, Payroll,
// Records, Admin), on §3.6's navy. The owner's brief (2026-11-06): a sidebar
// "stronger and darker, closer to Datatruck's", the content area light, accent
// secondary. The navy is this column and nothing to the right of its edge.
//
// The groups arriving here have already been filtered by `navigationFor`, so a
// dispatcher without financial permission is not handed a Money group to hide
// — the group is absent from the data. §7: never send it and hide it with CSS.
// Nothing about WHAT is in the sidebar changed with its colour.
//
// Wordmark in a 48px row so its rule meets the topbar's at the corner. Group
// labels nav-ink-2, 11px, uppercase, 0.08em, with more room above than below
// so each reads as a heading for the items under it.
//
// Active item: nav-active fill, nav-ink text, 2px ACCENT bar on the LEADING
// edge — inline-start, so it lands on the right in Farsi without a second
// rule. The bar is the one accent on the navy: accent means "you can do
// something here", and the current page is where the navigation still says so.
// No accent fill and no accent text (§3.6).

// Pre-translated by the layout. A translator is a closure, and a closure
// cannot cross the server/client boundary — React refuses to serialise it.
// Passing plain strings also means this component holds no i18n opinion at all.
export interface SidebarItem {
  key: string
  label: string
  href: string
}

export interface SidebarGroup {
  key: string
  label: string
  items: readonly SidebarItem[]
}

interface SidebarProps {
  groups: readonly SidebarGroup[]
  appName: string
  navLabel: string
}

export function Sidebar({ groups, appName, navLabel }: SidebarProps) {
  const pathname = usePathname()

  return (
    <nav
      aria-label={navLabel}
      className="flex h-full w-sidebar shrink-0 flex-col border-e border-nav-border bg-nav-bg"
    >
      <div className="flex h-topbar shrink-0 items-center border-b border-nav-border px-z4">
        <span className="text-md font-medium tracking-[0.08em] text-nav-ink">
          {appName.toUpperCase()}
        </span>
      </div>

      <div className="flex flex-col gap-z3 py-z3">
        {groups.map((group) => (
          <div key={group.key} className="flex flex-col gap-[2px]">
            <span className="px-z4 pt-z2 pb-z1 text-xs font-medium uppercase tracking-[0.08em] text-nav-ink-2">
              {group.label}
            </span>
            {group.items.map((item) => {
              // Exact match for the dashboard, prefix for everything else, so
              // /loads/123 keeps Loads lit.
              const active =
                item.href === '/'
                  ? pathname === '/'
                  : pathname === item.href ||
                    pathname.startsWith(`${item.href}/`)

              return (
                <Link
                  key={item.key}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'relative flex h-control items-center px-z4 text-base',
                    'transition-colors duration-120 ease-out',
                    active
                      ? 'bg-nav-active font-medium text-nav-ink'
                      : 'text-nav-ink-2 hover:bg-nav-surface hover:text-nav-ink',
                  )}
                >
                  {active ? (
                    <span
                      aria-hidden
                      className="absolute inset-y-0 start-0 w-[2px] bg-accent"
                    />
                  ) : null}
                  {item.label}
                </Link>
              )
            })}
          </div>
        ))}
      </div>
    </nav>
  )
}
