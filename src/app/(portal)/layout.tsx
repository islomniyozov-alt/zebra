import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { getSession } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { ribbonBranch } from '@/lib/environment'
import { PortalTabs } from './PortalTabs'
import { PendingQueue } from './PendingQueue'

// §9 — THE DRIVER PORTAL'S SHELL (Phase 7 step 2). A separate shell, not a
// responsive squeeze of the operator app: no sidebar, a bottom tab bar of
// five, base type 15 px, every target 44 px or more. The user is standing in
// a yard, in gloves, in sunlight, holding a phone in one hand.
//
// WHO GETS HERE. Any session reaches the shell; each PAGE refuses a role
// without `portal.*:read` as a 404 (§13.10), the way every operator page
// refuses a driver — the shell carries no data, so there is nothing here to
// leave out of a payload. An anonymous request goes to the login, as the
// operator shell sends it.
//
// `dir` is on <html>, from the locale, set by the root layout (§12): every
// class below is a logical property, so Farsi needs nothing more here.

export default async function PortalLayout({
  children,
}: {
  children: ReactNode
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  const { t } = await getLocaleContext()
  // §6.1.2 — which database this worker reads; null on production, and then
  // nothing renders at all.
  const dataFrom = ribbonBranch(process.env)

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-surface-2 text-[15px] text-ink">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-surface px-z4">
        <span className="text-base font-medium">{t('app.name')}</span>
        {dataFrom === null ? null : (
          <span className="rounded-control bg-warning-soft px-z2 py-[2px] text-xs font-medium uppercase tracking-[0.04em] text-warning">
            {t('topbar.dataFrom').replace('{branch}', dataFrom)}
          </span>
        )}
      </header>

      {/* THE PENDING STRIP (§9; step 6): mounted once, here, so the offline
       * queue's indicator and its replay are on every portal screen. Renders
       * nothing while the phone is online and nothing waits. */}
      <PendingQueue
        labels={{
          offline: t('portal.queue.offline'),
          waiting: t('portal.queue.waiting'),
          sending: t('portal.queue.sending'),
          retrying: t('portal.queue.retrying'),
          kept: t('portal.queue.kept'),
          notSent: t('portal.queue.notSent'),
          dismiss: t('portal.queue.dismiss'),
          status: t('portal.queue.status'),
        }}
      />

      <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>

      <PortalTabs
        label={t('portal.nav')}
        tabs={[
          { key: 'home', href: '/portal', label: t('portal.tab.home') },
          { key: 'loads', href: '/portal/loads', label: t('portal.tab.loads') },
          {
            key: 'documents',
            href: '/portal/documents',
            label: t('portal.tab.documents'),
          },
          {
            key: 'settlements',
            href: '/portal/settlements',
            label: t('portal.tab.settlements'),
          },
          { key: 'account', href: '/account', label: t('portal.tab.account') },
        ]}
      />
    </div>
  )
}
