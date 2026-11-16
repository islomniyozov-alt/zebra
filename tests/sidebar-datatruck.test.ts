import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readRouteMatrix } from '../scripts/sweep.mjs'
import { translator, type MessageKey } from '@/lib/i18n'
import { activeNavHref } from '@/lib/nav-active'
import { navigationFor, type AuthorizedSession } from '@/lib/permissions'

// ---------------------------------------------------------------------------
// THE SIDEBAR IN DATATRUCK'S WORDS (§6.2, owner's ruling 2026-11-16). Labels
// and groups only: these hold the sidebar Islom reads to the ruling, hold every
// entry to §6.8's row for its route — so a regrouping cannot hand a role a
// page the table refuses it — and pin the hrefs, so nothing but labels moved.
// ---------------------------------------------------------------------------

const ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'DISPATCHER', 'ACCOUNTING'] as const
const session = (role: (typeof ROLES)[number]) =>
  ({
    userId: 'u',
    organizationId: 'o',
    role,
    companyScopes: [],
  }) as AuthorizedSession

const en = translator('en')
const sidebarIn = (role: (typeof ROLES)[number], t = en) =>
  navigationFor(session(role)).map((group) => [
    group.labelKey ? t(group.labelKey as MessageKey) : null,
    group.items.map((entry) => t(entry.labelKey as MessageKey)),
  ])

describe('the owner’s sidebar', () => {
  it('reads as the ruling wrote it, group by group', () => {
    expect(sidebarIn('OWNER')).toEqual([
      [null, ['Dashboard']],
      ['Load Management', ['All Loads', 'Incoming Loads', 'Documents']],
      ['Planning Calendar', ['Dispatch Board']],
      ['Billing', ['Invoice', 'Payments', 'Reports', 'Factoring']],
      ['Payroll', ['Driver Pay', 'Statements', 'Charges']],
      ['Customer Management', ['Customers']],
      ['Safety', ['Compliance', 'DQF']],
      ['Fleet Management', ['Trucks', 'Trailers', 'Inspections']],
      ['Maintenance', ['Work Orders']],
      ['HR Management', ['Drivers', 'Users']],
      ['Admin', ['Authorities', 'Settings', 'Audit']],
    ])
  })

  it('goes to the routes it went to, plus the three new entries', () => {
    const hrefs = navigationFor(session('OWNER')).flatMap((group) =>
      group.items.map((entry) => entry.href),
    )
    expect(new Set(hrefs)).toEqual(
      new Set([
        // The twenty entries of 2026-09-28's sidebar, unchanged.
        '/dashboard',
        '/dispatch',
        '/loads',
        '/loads/incoming',
        '/trucks',
        '/trailers',
        '/drivers',
        '/safety',
        '/maintenance',
        '/accounting/invoices',
        '/accounting/payments',
        '/accounting/reports',
        '/payroll/batches',
        '/payroll/statements',
        '/payroll/charges',
        '/brokers',
        '/documents',
        '/users',
        '/companies',
        '/settings',
        '/audit',
        // Tabs and a page that had no entry, by the ruling.
        '/safety/dqf',
        '/safety/inspections',
        '/receivables/factoring',
      ]),
    )
    expect(hrefs).toHaveLength(new Set(hrefs).size)
  })

  it('has a Russian and a Farsi label for every entry and heading', () => {
    for (const locale of ['ru', 'fa'] as const) {
      const t = translator(locale)
      for (const [heading, labels] of sidebarIn('OWNER', t)) {
        for (const text of [heading, ...(labels as string[])])
          if (text !== null) expect(text).not.toMatch(/^nav\./)
      }
    }
    expect(sidebarIn('OWNER', translator('ru'))[1]).toEqual([
      'Управление грузами',
      ['Все грузы', 'Входящие грузы', 'Документы'],
    ])
  })
})

describe('every entry is a route §6.8 lets that role reach', () => {
  const matrix = readRouteMatrix(readFileSync('TMS-DESIGN-SYSTEM.md', 'utf8'))

  for (const role of ROLES) {
    it(role, () => {
      const column = role.toLowerCase()
      const offered = navigationFor(session(role)).flatMap((group) =>
        group.items.map((entry) => entry.href),
      )
      expect(offered.length).toBeGreaterThan(0)
      const refused = offered.filter(
        (href) => matrix.get(href)?.[column] !== 'reach',
      )
      expect(refused).toEqual([])
    })
  }

  it('and the three new entries are offered to every role the table lets in', () => {
    for (const href of [
      '/safety/dqf',
      '/safety/inspections',
      '/receivables/factoring',
    ]) {
      const row = matrix.get(href)!
      for (const role of ROLES) {
        const offered = navigationFor(session(role)).some((group) =>
          group.items.some((entry) => entry.href === href),
        )
        expect(offered, `${href} for ${role}`).toBe(
          row[role.toLowerCase()] === 'reach',
        )
      }
    }
  })
})

describe('the entry a path lights', () => {
  const hrefs = navigationFor(session('OWNER')).flatMap((group) =>
    group.items.map((entry) => entry.href),
  )

  it('is the longest route the path sits under, and only that one', () => {
    expect(activeNavHref('/safety/dqf', hrefs)).toBe('/safety/dqf')
    expect(activeNavHref('/safety/inspections/abc', hrefs)).toBe(
      '/safety/inspections',
    )
    expect(activeNavHref('/safety/claims', hrefs)).toBe('/safety')
    expect(activeNavHref('/loads/incoming', hrefs)).toBe('/loads/incoming')
    expect(activeNavHref('/loads/123', hrefs)).toBe('/loads')
    expect(activeNavHref('/loadsx', hrefs)).toBeNull()
    expect(activeNavHref('/account', hrefs)).toBeNull()
  })
})
