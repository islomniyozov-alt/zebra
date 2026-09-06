import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { getSession, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { navigationFor } from '@/lib/permissions'
import { readDensity } from '@/lib/preferences'
import { Sidebar, type SidebarGroup } from '@/components/shell/Sidebar'
import { Topbar } from '@/components/shell/Topbar'
import type { MessageKey } from '@/lib/i18n'

// §6.1 — the app shell. Sidebar 224px, topbar 48px, content the only scrolling
// region.
//
// Standing rule 6 / design-system rule 10: NO INNER SCROLL CONTAINER except
// designated table bodies. That is why this is h-screen with min-h-0 on the
// column rather than a page that grows and scrolls the body — the table body
// owns the scroll, and nothing else does.

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
  // THE AUTHORITY LIST WENT WITH THE TOPBAR FILTER (2026-09-06). Every page in
  // the shell used to load every active company the viewer could see, purely to
  // draw buttons at the top. The loads list fetches its own now, on the one
  // screen that offers the narrowing.
  //
  // THE RESOURCE STAYS `company` DELIBERATELY, even though this reads only a
  // density preference now. Every role that can load the shell already holds
  // `company:read` — that is what makes the app render today — so leaving it
  // changes nothing, while narrowing it is a permission change dressed as a
  // cleanup, and the wrong guess locks somebody out of every screen at once.
  // Worth revisiting against the role matrix, deliberately, not in passing.
  const { density, account } = await withCurrentOrg(
    'read',
    'company',
    async (tx, current) => ({
      density: await readDensity(tx, current.userId),
      // THE NAME ON THE ACCOUNT CONTROL, read here because the session does not
      // carry one — `SessionContext` has userId and role and nothing a person
      // would recognise as themselves. One more row on a connection already
      // open, which is the same argument the density read makes above.
      account: await tx.user.findUnique({
        where: { id: current.userId },
        select: { name: true, email: true },
      }),
    }),
  )

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
          // NAME FIRST, EMAIL AS THE FALLBACK, and never initials. Daler on the
          // "OW" badge it replaced: "everybody will call it account or admin
          // account or dispatch account; OW means nothing to anyone." A name
          // says the one thing the control needs to say — this is mine.
          accountName={account?.name?.trim() || account?.email || ''}
          labels={{
            notifications: t('topbar.notifications'),
            userMenu: t('topbar.userMenu'),
          }}
        />
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    </div>
  )
}
