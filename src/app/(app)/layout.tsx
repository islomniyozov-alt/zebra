import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { getSession, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { navigationFor } from '@/lib/permissions'
import { readDensity } from '@/lib/preferences'
import { Sidebar, type SidebarGroup } from '@/components/shell/Sidebar'
import { Topbar, type CompanyOption } from '@/components/shell/Topbar'
import type { MessageKey } from '@/lib/i18n'

// §6.1 — the app shell. Sidebar 224px, topbar 48px, content the only scrolling
// region.
//
// Standing rule 6 / design-system rule 10: NO INNER SCROLL CONTAINER except
// designated table bodies. That is why this is h-screen with min-h-0 on the
// column rather than a page that grows and scrolls the body — the table body
// owns the scroll, and nothing else does.

const CHIP_TONES: ReadonlyArray<CompanyOption['tone']> = [
  'accent',
  'progress',
  'success',
  'warning',
  'danger',
  'muted',
]

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { t } = await getLocaleContext()

  // Filtered by permission before it reaches the component. A dispatcher
  // without financial permission is not handed a Money group to hide — the
  // group is absent from the payload (§7).
  // Translated here, on the server, because a translator is a closure and a
  // closure cannot be serialised across to a client component.
  const groups: SidebarGroup[] = navigationFor(session).map((group) => ({
    key: group.key,
    label: t(group.labelKey as MessageKey),
    items: group.items.map((item) => ({
      key: item.key,
      label: t(item.labelKey as MessageKey),
      href: item.href,
    })),
  }))

  // §6.3 — the authorities this user may see, by name. An empty scope list
  // means every authority in the organization, so the query answers both cases
  // without the layout knowing which it is in.
  //
  // The chip colour is positional and therefore stable for a given
  // organization: the colour a dispatcher learns does not move between
  // sessions.
  //
  // The density preference rides along in the same transaction. It is one
  // more row read on a connection that is already open, and putting it in its
  // own `withCurrentOrg` would cost a second round trip to us-east-2 on every
  // single page — see the arithmetic on LOAD_WRITE_TIMEOUT_MS.
  const { authorities, density } = await withCurrentOrg(
    'read',
    'company',
    async (tx, current) => ({
      authorities: await tx.company.findMany({
        where: {
          isActive: true,
          ...(current.companyScopes.length > 0
            ? { id: { in: [...current.companyScopes] } }
            : {}),
        },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
      density: await readDensity(tx, current.userId),
    }),
  )

  const companies: CompanyOption[] = authorities.map((company, index) => ({
    id: company.id,
    name: company.name,
    tone: CHIP_TONES[index % CHIP_TONES.length]!,
  }))

  return (
    /* §5.1 lives HERE rather than on <html>: the preference belongs to a
     * signed-in user and the root layout has no session — the login screen has
     * no density to have. `--z-row-height` is a custom property, so it cascades
     * from this element to everything the shell contains. */
    <div
      data-density={density}
      className="flex h-screen overflow-hidden bg-surface-2"
    >
      <Sidebar
        groups={groups}
        appName={t('app.name')}
        navLabel={t('nav.group.operations')}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          companies={companies}
          userInitials="OW"
          labels={{
            allAuthorities: t('topbar.allAuthorities'),
            authority: t('loads.filter.authority'),
            notifications: t('topbar.notifications'),
            userMenu: t('topbar.userMenu'),
          }}
        />
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    </div>
  )
}
