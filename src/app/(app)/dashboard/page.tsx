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

  // THREE SHORT READS, NOT ONE LONG TRANSACTION (Phase 6, the statement diet).
  //
  // This screen used to open a single interactive transaction and run the
  // queue, the fleet and the week inside it — eighteen statements, each a
  // round trip to us-east-2, against Prisma's 5 s ceiling. It expired in
  // production: "A commit cannot be executed on an expired transaction …
  // 6034 ms passed", caught under `wrangler tail`, and an owner got a 500 on
  // the main screen. Twice it had been reported as an unexplained walkthrough
  // flake before anybody caught it in the act.
  //
  // Phase 5 §7 flag 31's ruling was that the answer is fewer statements inside
  // the lock, not a longer lock. So: each section gets its OWN transaction,
  // and the three run CONCURRENTLY — the wall clock becomes the slowest
  // section rather than the sum of all three, and no single transaction is
  // open long enough to expire.
  //
  // The week keeps its two statements together because the second needs the
  // first: the authority ids decide which loads to total.
  const [queue, fleet, week] = await Promise.all([
    // 10 s, NOT the 5 s default and no longer the 20 s bandage.
    //
    // Measured, before and after, five loads each under `wrangler tail`:
    // ~7.0 s of client wall before the split, ~5.7 s after — and that 5.7 s is
    // three CONCURRENT transactions, so the slowest of them is still close
    // enough to five seconds that returning to the default would be betting
    // the screen on a quiet network. The numbers do not allow it yet.
    //
    // What would: fewer statements. `fleetGlance` runs five counts and
    // `actionQueue` several more, each a round trip, and Prisma serialises
    // them on the transaction's single connection however they are written.
    // Collapsing the counts is the next cut and is its own change — raw SQL
    // under RLS with a dynamic authority filter is not a thing to bolt onto a
    // measurement session.
    withCurrentOrg(
      'read',
      'dashboard',
      (tx, ctx) => actionQueue(tx, ctx, companyScopeFilter(ctx.companyScopes)),
      { timeoutMs: 10_000 },
    ),
    withCurrentOrg(
      'read',
      'dashboard',
      (tx, ctx) => fleetGlance(tx, companyScopeFilter(ctx.companyScopes)),
      { timeoutMs: 10_000 },
    ),
    maySeeWeek
      ? withCurrentOrg(
          'read',
          'dashboard',
          async (tx, ctx) => {
            const companies = await tx.company.findMany({
              // `id`, not `companyId` — Company IS the authority (tenancy.ts).
              where: {
                isActive: true,
                ...companyIdScopeFilter(ctx.companyScopes),
              },
              select: { id: true },
            })
            return thisWeek(
              tx,
              companies.map((company) => company.id),
            )
          },
          { timeoutMs: 10_000 },
        )
      : Promise.resolve([]),
  ])

  const data = { queue, fleet, week }

  // BY ASSIGNMENT STATE. "Nine trucks" is inventory; "seven paired, two idle"
  // is a decision somebody can act on before the load board closes.
  const fleetCards: { key: string; label: MessageKey; value: number }[] = [
    {
      key: 'trucksPaired',
      label: 'dash.fleet.trucksPaired',
      value: data.fleet.trucksPaired,
    },
    {
      key: 'trucksIdle',
      label: 'dash.fleet.trucksIdle',
      value: data.fleet.trucksIdle,
    },
    {
      key: 'driversPaired',
      label: 'dash.fleet.driversPaired',
      value: data.fleet.driversPaired,
    },
    {
      key: 'driversIdle',
      label: 'dash.fleet.driversIdle',
      value: data.fleet.driversIdle,
    },
    {
      key: 'inTransit',
      label: 'dash.fleet.inTransit',
      value: data.fleet.inTransit,
    },
  ]

  const hasFleet =
    data.fleet.trucksPaired +
      data.fleet.trucksIdle +
      data.fleet.driversPaired +
      data.fleet.driversIdle >
    0
  const weekTotal = data.week.reduce((sum, row) => sum + row.revenueCents, 0)
  const weekBooked = data.week.reduce((sum, row) => sum + row.booked, 0)
  const weekDelivered = data.week.reduce((sum, row) => sum + row.delivered, 0)
  const weekFactored = data.week.reduce(
    (sum, row) => sum + row.factoredCents,
    0,
  )
  const weekDirect = data.week.reduce((sum, row) => sum + row.directCents, 0)

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
                        {/* Where the row carries an amount, the AMOUNT is the
                         * headline: "3 payments not applied" is a filing job,
                         * "$14,200 not applied" is money nobody can see. The
                         * count follows in the sentence so both are there. */}
                        {row.amountCents === undefined
                          ? row.count
                          : formatCents(row.amountCents, locale)}
                      </span>
                      <span className="text-ink">
                        {t(`dash.action.${row.key}` as MessageKey)}
                        {row.amountCents === undefined ? null : (
                          <span className="text-ink-3"> ({row.count})</span>
                        )}
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

              {weekBooked + weekDelivered === 0 ? (
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
                          {t('dash.week.booked')}
                        </th>
                        <th className="px-z3 py-z2 text-end text-xs font-semibold uppercase tracking-[0.04em] text-ink-2">
                          {t('dash.week.delivered')}
                        </th>
                        <th className="px-z3 py-z2 text-end text-xs font-semibold uppercase tracking-[0.04em] text-ink-2">
                          {t('dash.week.revenue')}
                        </th>
                        <th className="px-z3 py-z2 text-end text-xs font-semibold uppercase tracking-[0.04em] text-ink-2">
                          {t('dash.week.factored')}
                        </th>
                        <th className="px-z3 py-z2 text-end text-xs font-semibold uppercase tracking-[0.04em] text-ink-2">
                          {t('dash.week.direct')}
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
                            {row.booked}
                          </td>
                          <td className="px-z3 py-z2 text-end font-mono tabular-nums text-ink">
                            {row.delivered}
                          </td>
                          <td className="px-z3 py-z2 text-end font-mono tabular-nums text-ink">
                            {formatCents(row.revenueCents, locale)}
                          </td>
                          {/* The two split the revenue beside them exactly —
                           * a reader can add them and check (rule 9-money). */}
                          <td className="px-z3 py-z2 text-end font-mono tabular-nums text-ink-2">
                            {formatCents(row.factoredCents, locale)}
                          </td>
                          <td className="px-z3 py-z2 text-end font-mono tabular-nums text-ink-2">
                            {formatCents(row.directCents, locale)}
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
                            {weekBooked}
                          </td>
                          <td className="px-z3 py-z2 text-end font-mono tabular-nums font-medium text-ink">
                            {weekDelivered}
                          </td>
                          <td className="px-z3 py-z2 text-end font-mono tabular-nums font-medium text-ink">
                            {formatCents(weekTotal, locale)}
                          </td>
                          <td className="px-z3 py-z2 text-end font-mono tabular-nums text-ink-2">
                            {formatCents(weekFactored, locale)}
                          </td>
                          <td className="px-z3 py-z2 text-end font-mono tabular-nums text-ink-2">
                            {formatCents(weekDirect, locale)}
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
