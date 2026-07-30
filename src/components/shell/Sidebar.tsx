'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cx } from '@/lib/cx'

// §6.2. Seventeen destinations grouped into five, with the group label at 11px
// ink-3, uppercase, 0.06em tracking.
//
// The groups arriving here have already been filtered by `navigationFor`, so a
// dispatcher without financial permission is not handed a Money group to hide
// — the group is absent from the data. §7: never send it and hide it with CSS.
//
// Active item: accent-soft fill, accent text, 2px accent bar on the LEADING
// edge — inline-start, so it lands on the right in Farsi without a second rule.

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
      className="flex h-full w-sidebar shrink-0 flex-col gap-z4 border-e border-border bg-surface py-z3"
    >
      <div className="px-z4">
        <span className="text-md font-medium tracking-[0.08em] text-ink">
          {appName.toUpperCase()}
        </span>
      </div>

      <div className="flex flex-col gap-z4">
        {groups.map((group) => (
          <div key={group.key} className="flex flex-col gap-[2px]">
            <span className="px-z4 pb-z1 text-xs font-medium uppercase tracking-[0.06em] text-ink-3">
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
                      ? 'bg-accent-soft font-medium text-accent'
                      : 'text-ink-2 hover:bg-surface-3',
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
