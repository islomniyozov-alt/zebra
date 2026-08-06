import Link from 'next/link'
import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyIdScopeFilter, companyScopeFilter } from '@/lib/tenancy'
import { actionQueue, fleetGlance, thisWeek } from '@/lib/dashboard'
import { formatCents } from '@/lib/money'
import { Button } from '@/components/ui/Button'
import { KpiCard } from '@/components/ui/KpiCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { TONE_STRIPE } from '@/lib/status'
import type { MessageKey } from '@/lib/i18n'

// THE FIRST SCREEN OF THE DAY.
//
// Three questions in the order they get asked: what needs me, what have I got,
// how is the week going. Everything on it is counted from real state at request
// time — see src/lib/dashboard.ts — so it cannot disagree with the screen it
// sends you to.
//
// §14 by name: no gradient hero, no chart, no "No data available". The design
// system's KPI card carries the counts and every empty state is an invitation
// with the action attached (§10).

export default async function DashboardPage() {
  if (!(await currentUserCan('read', 'dashboard'))) notFound()

  const { t, locale } = await getLocaleContext()

  // THE WEEK IS MONEY. A dispatcher gets the queue and the fleet and no
  // revenue at all — the section is not rendered, not greyed, and its query
  // does not run.
  const maySeeWeek = await currentUserCan('read', 'load.financials')
  const mayBookLoad = await currentUserCan('create', 'load')
  const mayAddTruck = await currentUserCan('create', 'truck')

  const data = await withCurrentOrg('read', 'dashboard', async (tx, ctx) => {
    const scope = companyScopeFilter(ctx.companyScopes)

    const [queue, fleet, companies] = await Promise.all([
      actionQueue(tx, ctx, scope),
      fleetGlance(tx, scope),
      maySeeWeek
        ? tx.company.findMany({
            // `id`, not `companyId` — Company IS the authority (tenancy.ts).
            where: {
              isActive: true,
              ...companyIdScopeFilter(ctx.companyScopes),
            },
            select: { id: true },
          })
        : Promise.resolve([]),
    ])

    const week = maySeeWeek
      ? await thisWeek(
          tx,
          companies.map((company) => company.id),
        )
      : []

    return { queue, fleet, week }
  })

  const fleetCards: { key: string; label: MessageKey; value: number }[] = [
    { key: 'trucks', label: 'dash.fleet.trucks', value: data.fleet.trucks },
    {
      key: 'trailers',
      label: 'dash.fleet.trailers',
      value: data.fleet.trailers,
    },
    { key: 'drivers', label: 'dash.fleet.drivers', value: data.fleet.drivers },
    {
      key: 'inTransit',
      label: 'dash.fleet.inTransit',
      value: data.fleet.inTransit,
    },
  ]

  const hasFleet =
    data.fleet.trucks + data.fleet.trailers + data.fleet.drivers > 0
  const weekTotal = data.week.reduce((sum, row) => sum + row.revenueCents, 0)
  const weekLoads = data.week.reduce((sum, row) => sum + row.loads, 0)

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="text-lg font-medium text-ink">{t('dash.title')}</h1>
        {mayBookLoad ? (
          <Link href="/loads/new">
            <Button variant="primary" size="compact">
              {t('loads.add')}
            </Button>
          </Link>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2 px-gutter py-z5">
        <div className="flex max-w-[1100px] flex-col gap-z5">
          {/* 1 — WHAT NEEDS ME */}
          <section>
            <h2 className="text-md font-medium text-ink">{t('dash.queue')}</h2>

            {data.queue.length === 0 ? (
              <div className="mt-z3 overflow-hidden rounded-card border border-border">
                <EmptyState
                  title={t('dash.queueEmpty.title')}
                  body={t('dash.queueEmpty.body')}
                  action={
                    mayBookLoad ? (
                      <Link href="/loads/new">
                        <Button variant="primary">
                          {t('dash.queueEmpty.action')}
                        </Button>
                      </Link>
                    ) : null
                  }
                />
              </div>
            ) : (
              <ul className="mt-z3 flex flex-col overflow-hidden rounded-card border border-border bg-surface">
                {data.queue.map((row) => (
                  <li key={row.key} className="relative">
                    {/* The whole row is the link (§7.1's stretched anchor), so
                     * middle-click and keyboard both work. */}
                    <Link
                      href={row.href}
                      className="flex items-center gap-z3 border-b border-border py-z3 pe-z4 text-sm last:border-b-0 hover:bg-surface-3"
                    >
                      <span
                        aria-hidden
                        className={`h-[28px] w-[3px] ${TONE_STRIPE[row.tone]}`}
                      />
                      <span className="font-mono text-md font-semibold tabular-nums text-ink">
                        {row.count}
                      </span>
                      <span className="text-ink">
                        {t(`dash.action.${row.key}` as MessageKey)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 2 — WHAT HAVE I GOT */}
          <section>
            <h2 className="text-md font-medium text-ink">{t('dash.fleet')}</h2>

            {hasFleet ? (
              <div className="mt-z3 grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-z3">
                {fleetCards.map((card) => (
                  <KpiCard
                    key={card.key}
                    label={t(card.label)}
                    // Plain integers, localised. Rule 4 permits abbreviation
                    // in a KPI card, but only money ever gets large enough to
                    // want it — a fleet is a number you can just read.
                    value={card.value.toLocaleString(locale)}
                  />
                ))}
              </div>
            ) : (
              <div className="mt-z3 overflow-hidden rounded-card border border-border">
                <EmptyState
                  title={t('dash.fleetEmpty.title')}
                  body={t('dash.fleetEmpty.body')}
                  action={
                    mayAddTruck ? (
                      <Link href="/trucks/new">
                        <Button variant="primary">
                          {t('dash.fleetEmpty.action')}
                        </Button>
                      </Link>
                    ) : null
                  }
                />
              </div>
            )}
          </section>

          {/* 3 — HOW IS THE WEEK GOING. Money roles only. */}
          {maySeeWeek ? (
            <section>
              <h2 className="text-md font-medium text-ink">{t('dash.week')}</h2>
              <p className="mt-z1 max-w-[68ch] text-sm text-ink-3">
                {t('dash.weekHint')}
              </p>

              {weekLoads === 0 ? (
                <div className="mt-z3 overflow-hidden rounded-card border border-border">
                  <EmptyState
                    title={t('dash.weekEmpty.title')}
                    body={t('dash.weekEmpty.body')}
                  />
                </div>
              ) : (
                // A PLAIN TABLE, not the `Table` component, and the reason is
                // worth stating: `Table` owns the full-height scrolling
                // container a list screen needs (`min-h-0 flex-1
                // overflow-auto`), which is wrong for a three-row summary
                // embedded in a page that scrolls as a whole. §7.1's rules
                // that still apply here are kept by hand — hairline
                // separators, uppercase header, money right-aligned and
                // tabular.
                <div className="mt-z3 overflow-hidden rounded-card border border-border bg-surface">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-surface-2">
                        <th className="px-z3 py-z2 text-start text-xs font-semibold uppercase tracking-[0.04em] text-ink-2">
                          {t('dash.week.authority')}
                        </th>
                        <th className="px-z3 py-z2 text-end text-xs font-semibold uppercase tracking-[0.04em] text-ink-2">
                          {t('dash.week.loads')}
                        </th>
                        <th className="px-z3 py-z2 text-end text-xs font-semibold uppercase tracking-[0.04em] text-ink-2">
                          {t('dash.week.revenue')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.week.map((row) => (
                        <tr
                          key={row.companyId}
                          className="border-t border-border"
                        >
                          <td className="px-z3 py-z2 text-ink">
                            {row.companyName}
                          </td>
                          <td className="px-z3 py-z2 text-end font-mono tabular-nums text-ink">
                            {row.loads}
                          </td>
                          <td className="px-z3 py-z2 text-end font-mono tabular-nums text-ink">
                            {formatCents(row.revenueCents, locale)}
                          </td>
                        </tr>
                      ))}
                      {/* The total is labelled as the GROUP, not as a carrier.
                       * Only shown where there is more than one authority to
                       * add up — otherwise it is the same row twice. */}
                      {data.week.length > 1 ? (
                        <tr className="border-t border-border-strong">
                          <td className="px-z3 py-z2 font-medium text-ink">
                            {t('dash.week.total')}
                          </td>
                          <td className="px-z3 py-z2 text-end font-mono tabular-nums font-medium text-ink">
                            {weekLoads}
                          </td>
                          <td className="px-z3 py-z2 text-end font-mono tabular-nums font-medium text-ink">
                            {formatCents(weekTotal, locale)}
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ) : null}
        </div>
      </div>
    </>
  )
}
