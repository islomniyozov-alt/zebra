'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cx } from '@/lib/cx'

// THE BOTTOM TAB BAR (§9): five tabs, one row, each at least 44 px tall and
// a fifth of the width — a thumb target, not a link. The active tab is the
// one whose path is the current path or its prefix, Home only on itself so
// that /portal/loads does not light two.

interface Tab {
  key: string
  href: string
  label: string
}

export function PortalTabs({ tabs, label }: { tabs: Tab[]; label: string }) {
  const pathname = usePathname()
  const isActive = (tab: Tab) =>
    tab.href === '/portal'
      ? pathname === '/portal'
      : pathname === tab.href || pathname.startsWith(`${tab.href}/`)

  return (
    <nav
      aria-label={label}
      className="grid shrink-0 grid-cols-5 border-t border-border bg-surface"
    >
      {tabs.map((tab) => {
        const active = isActive(tab)
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cx(
              'flex min-h-[56px] items-center justify-center px-z1 text-center text-[13px] font-medium leading-tight',
              active
                ? 'border-t-2 border-accent text-ink'
                : 'border-t-2 border-transparent text-ink-2',
            )}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
