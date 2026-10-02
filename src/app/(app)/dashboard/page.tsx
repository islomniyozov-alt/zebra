import Link from 'next/link'
import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyIdScopeFilter, companyScopeFilter } from '@/lib/tenancy'
import { actionQueue } from '@/lib/dashboard'
import {
  dashboardFor,
  isPeriodKey,
  periodWindow,
  type Dashboard,
  type PeriodKey,
} from '@/lib/dashboard-kpis'
import { formatCents } from '@/lib/money'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { TONE_STRIPE } from '@/lib/status'
import { CompanyChips } from '../_grid/CompanyChips'
import { PeriodPicker } from './PeriodPicker'
import { BarChart } from './BarChart'
import { Sparkline } from './Sparkline'
import { Donut } from './Donut'
import { DayBars } from './DayBars'
import type { RawParams } from '@/lib/list-view'
import type { MessageKey } from '@/lib/i18n'

// ---------------------------------------------------------------------------
// THE FIRST SCREEN OF THE DAY. §6.1.1, dashboard redesign part 1.
//
// ── WHAT PART 1 IS AND IS NOT ────────────────────────────────────────────
//
// It is the data layer and the skeleton: the chips, the period picker, the KPI
// strip, four empty panels and Needs-you as a rail. NO CHARTS. The panels are
// headings over empty cards on purpose — the brief's shape — and part 2 fills
// them.
//
// SO `fleetGlance` AND `thisWeek` ARE NOT READ HERE ANY MORE. They are the
// content of the Fleet and Charts panels, which are empty this commit, and a
// query whose result nothing renders is a round trip to us-east-2 for nothing.
// Both remain exported and tested in `dashboard.ts`, for part 2. This is said
// out loud because an unrendered export is how dead code starts, and the
// deadline for it is part 2 rather than someday.
//
// ── THE CHIPS AND THE PERIOD GOVERN EVERYTHING BELOW THEM ────────────────
//
// §6.1.1: not per panel. A strip answering for the quarter beside a chart
// answering for the week is two true numbers answering different questions,
// and nothing on the screen looks broken. One `?company=` and one `?period=`,
// read here on the server, passed down.
//
// ── THE STATEMENT DIET STILL APPLIES (Phase 5 §7 flag 31) ────────────────
//
// This screen once opened ONE interactive transaction around eighteen
// statements and expired in production — "A commit cannot be executed on an
// expired transaction … 6034 ms passed", an owner looking at a 500. The ruling
// was fewer statements inside the lock, not a longer lock.
//
// Two transactions now, running CONCURRENTLY: the money (four statements, one
// scan serving three panels) and the queue. MEASURED ON DEV: `dashboardFor` is
// 4 statements and 986 ms over Jul–Sep 2026 across 2,133 loads.
// ---------------------------------------------------------------------------

// ── BUCKET LABELS, ONE DEFINITION FOR EVERY CHART ─────────────────────────
//
// "Sep 20" under a weekly bar, "Oct 2" under a daily one — owner's review. The
// three helpers are here rather than in the components because the components
// take strings: a chart that formatted its own dates would need the locale, the
// grain and a second opinion about which week a Sunday opens.

/** Stable per bucket, and never a rendered date — §7.1.1's sort-key rule. */
const bucketKey = (at: Date) => at.toISOString().slice(0, 10)

/** Under the bar. Short, because forty of them sit side by side. */
const bucketLabel = (at: Date, grain: 'day' | 'week', locale: string) =>
  new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(at)

/**
 * In the tooltip and the hidden table. SAYS WHAT THE BUCKET COVERS.
 *
 * A weekly bar labelled "Sep 20" is ambiguous about whether it means that day
 * or that week, and the tooltip is where that question gets asked. So the week
 * case prints the span and the day case prints the weekday — which is the thing
 * a dispatcher actually wants from a daily bar.
 */
const bucketDetail = (at: Date, grain: 'day' | 'week', locale: string) => {
  if (grain === 'day') {
    return new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(at)
  }
  const end = new Date(at)
  end.setUTCDate(end.getUTCDate() + 6)
  const short = (value: Date) =>
    new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(value)
  return `${short(at)} – ${short(end)}`
}

/** Every panel §6.1.1 names, in its order. Empty in part 1. */
const PANELS = ['charts', 'fleet', 'cash', 'compliance'] as const

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>
}) {
  if (!(await currentUserCan('read', 'dashboard'))) notFound()

  const { t, locale } = await getLocaleContext()
  const raw = await searchParams

  // THE MONEY IS A PERMISSION. A dispatcher gets the queue, the chips and the
  // panels, and the KPI strip is NOT RENDERED and its query DOES NOT RUN —
  // never rendered-then-hidden, which §0 forbids and which would ship the
  // figures to the browser anyway.
  const maySeeMoney = await currentUserCan('read', 'load.financials')
  const mayBookLoad = await currentUserCan('create', 'load')

  const period: PeriodKey =
    typeof raw.period === 'string' && isPeriodKey(raw.period)
      ? raw.period
      : // THIS QUARTER, not this month. Owner's review 2026-10-02: on the 2nd of
        // October 'this month' rendered an empty dashboard — a correct answer to
        // a question nobody opens the screen to ask.
        'quarter'
  const companyParam = typeof raw.company === 'string' ? raw.company : null
  const now = new Date()
  const window = periodWindow(period, now)
  // UTC MIDNIGHT TODAY, so a bucket is future only if its whole day is.
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  )

  const [money, queue, companies] = await Promise.all([
    maySeeMoney
      ? withCurrentOrg(
          'read',
          'dashboard',
          (tx, ctx) =>
            dashboardFor(tx, ctx.organizationId, companyParam, window),
          { timeoutMs: 10_000 },
        )
      : Promise.resolve(null),
    withCurrentOrg(
      'read',
      'dashboard',
      (tx, ctx) => actionQueue(tx, ctx, companyScopeFilter(ctx.companyScopes)),
      { timeoutMs: 10_000 },
    ),
    withCurrentOrg(
      'read',
      'dashboard',
      (tx, ctx) =>
        tx.company.findMany({
          // `id`, not `companyId` — Company IS the authority (tenancy.ts).
          where: { isActive: true, ...companyIdScopeFilter(ctx.companyScopes) },
          orderBy: { name: 'asc' },
          select: { id: true, name: true },
        }),
      { timeoutMs: 10_000 },
    ),
  ])

  const day = (value: Date) => value.toISOString().slice(0, 10)

  // ONE LABEL SET FOR BOTH BAR CHARTS, so the legend cannot say one thing on
  // the money chart and another on the loads chart.
  const barLabels = {
    heading: t('dash.chart.weeks'),
    gross: t('dash.kpi.gross'),
    driverPay: t('dash.kpi.driverPay'),
    unrecorded: t('dash.chart.unrecorded'),
    afterDriverPay: t('dash.kpi.afterDriverPay'),
    loads: t('dash.kpi.loads'),
    empty: t('dash.chart.noRevenue'),
    bucket:
      money === null || money.grain === 'day'
        ? t('dash.chart.day')
        : t('dash.chart.week'),
  }

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

      {/* ── THE CONTROLS, ONCE, AT THE TOP ───────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-z3 border-b border-border bg-surface px-gutter py-z2">
        <CompanyChips
          companies={companies}
          label={t('accounting.company')}
          allLabel={t('accounting.allCompanies')}
        />
        <PeriodPicker
          legend={t('dash.period')}
          labels={{
            week: t('dash.period.week'),
            month: t('dash.period.month'),
            quarter: t('dash.period.quarter'),
            ytd: t('dash.period.ytd'),
          }}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2 px-gutter py-z5">
        {/* THE RAIL IS A COLUMN, not a row below. It collapses under the main
         * column on a narrow screen rather than disappearing. */}
        <div className="flex flex-col gap-z5 lg:flex-row lg:items-start">
          <div className="flex min-w-0 flex-1 flex-col gap-z5">
            {money === null ? null : (
              <KpiStrip board={money} locale={locale} t={t} day={day} />
            )}

            {/* ── FOUR PANELS, EMPTY IN PART 1 ───────────────────────── */}
            {/* ── CHARTS, FILLED (part 2) ──────────────────────────────
             *
             * Four cuts of the series `dashboardFor` already returns — no
             * extra query, which is why this panel costs nothing it did not
             * cost empty. All four are server-rendered inline SVG with a
             * `<title>` for hover and a visually hidden table of the same
             * figures (§6.1.1, §13).
             *
             * MONEY ROLES ONLY, like the strip: `money` is null for a
             * dispatcher and the panel is not rendered rather than rendered
             * empty — the query did not run either. */}
            {money === null ? null : (
              <section className="rounded-card border border-border bg-surface p-z4">
                <h2 className="text-md font-medium text-ink">
                  {t('dash.panel.charts')}
                </h2>

                {/* ONE WINDOW. The picker drives this chart, the donuts and
                 * the day strip alike — v10.14 let the bars ignore it and
                 * v10.16 revoked that, because a quarter of bars beside a
                 * month of donuts is one screen saying two things. */}
                <div className="mt-z3">
                  <BarChart
                    bars={money.weeks.map((point) => ({
                      key: bucketKey(point.weekStart),
                      label: bucketLabel(point.weekStart, money.grain, locale),
                      detail: bucketDetail(
                        point.weekStart,
                        money.grain,
                        locale,
                      ),
                      grossCents: point.grossCents,
                      driverPayCents: point.driverPayCents,
                      marginCents: point.marginCents,
                      loads: point.loads,
                      // A BUCKET AFTER TODAY HAS NOT HAPPENED. The week view runs
                      // Sunday to Sunday so the axis is always seven columns;
                      // the tail draws as gaps rather than as zeroes.
                      future: point.weekStart > today,
                    }))}
                    locale={locale}
                    labels={barLabels}
                  />
                </div>
                <div className="mt-z5 grid gap-z5 lg:grid-cols-2">
                  <Donut
                    slices={money.byCompany.map((row) => ({
                      key: row.companyId,
                      label: row.companyName,
                      cents: row.grossCents,
                    }))}
                    locale={locale}
                    labels={{
                      heading: t('dash.chart.byCompany'),
                      other: (count) =>
                        `${t('dash.chart.other')} (${String(count)})`,
                      name: t('accounting.company'),
                      value: t('dash.kpi.gross'),
                      share: t('dash.chart.share'),
                      empty: t('dash.chart.noRevenue'),
                    }}
                  />
                  <Donut
                    slices={money.byCustomer.map((row) => ({
                      key: row.customerId || '__none',
                      // A LOAD WITH NO CUSTOMER STILL EARNED MONEY, and
                      // `customerRows` LEFT JOINs for that reason. An empty
                      // name would render a blank legend row.
                      label: row.customerName || t('dash.chart.noCustomer'),
                      cents: row.grossCents,
                    }))}
                    locale={locale}
                    labels={{
                      heading: t('dash.chart.byCustomer'),
                      other: (count) =>
                        `${t('dash.chart.other')} (${String(count)})`,
                      name: t('loads.column.customer'),
                      value: t('dash.kpi.gross'),
                      share: t('dash.chart.share'),
                      empty: t('dash.chart.noRevenue'),
                    }}
                  />
                </div>

                <div className="mt-z5">
                  <DayBars
                    days={money.perDay}
                    period={window}
                    labels={{
                      heading: t('dash.chart.perDay'),
                      day: t('dash.chart.day'),
                      loads: t('dash.kpi.loads'),
                      empty: t('dash.chart.noRevenue'),
                    }}
                  />
                </div>
              </section>
            )}

            {/* THE THREE STILL TO COME. `charts` is filled above, so it is
             * excluded here rather than listed and skipped. */}
            {PANELS.filter((panel) => panel !== 'charts').map((panel) => (
              <section
                key={panel}
                className="rounded-card border border-border bg-surface p-z4"
              >
                <h2 className="text-md font-medium text-ink">
                  {t(`dash.panel.${panel}` as MessageKey)}
                </h2>
                {/* NOT "No data available" (§14). It says what will be here and
                 * that it is not here yet, which is a true sentence; the
                 * forbidden one claims the data is missing. */}
                <p className="mt-z2 text-sm text-ink-3">
                  {t('dash.panel.pending')}
                </p>
              </section>
            ))}
          </div>

          {/* ── NEEDS YOU, THE RIGHT RAIL ──────────────────────────────── */}
          <aside className="w-full shrink-0 lg:w-[320px]">
            <h2 className="text-md font-medium text-ink">{t('dash.queue')}</h2>
            {queue.length === 0 ? (
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
                {queue.map((row) => (
                  <li key={row.key}>
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
                         * "$14,200 not applied" is money nobody can see. */}
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
          </aside>
        </div>
      </div>
    </>
  )
}

/**
 * The KPI strip. PLAIN NUMBERS (§14 forbids the gradient hero card).
 *
 * ── AN EM DASH IS A REAL ANSWER HERE ─────────────────────────────────────
 *
 * `driverPayCents` and `marginCents` are null for any period Zebra was not yet
 * settling, and §8 renders that as an em dash. Measured on dev: gross
 * $2,755,782.16 against $184,774.65 of recorded pay over Jul–Sep 2026, because
 * 13,517 of those loads were paid in Datatruck. Printing the difference as a
 * margin would be the most expensive wrong number on the page, so the strip
 * says nothing and the sentence underneath says where the data starts.
 */
function KpiStrip({
  board,
  locale,
  t,
  day,
}: {
  board: Dashboard
  locale: string
  t: (key: MessageKey) => string
  day: (value: Date) => string
}) {
  const money = (cents: number | null) =>
    cents === null ? '—' : formatCents(cents, locale)

  // ── SIX CELLS, SIX SPARKLINES ──────────────────────────────────────────
  //
  // Owner's review, 2026-10-02. The strip had five cells and no sparklines; the
  // sixth is DRIVER PAY, which was only ever visible as the thing subtracted
  // inside "after driver pay". A reader asking "what did we pay out" had to do
  // the arithmetic from two other cells.
  //
  // EACH SERIES COMES FROM THE SAME BUCKETS THE BARS DRAW, so a cell and the
  // chart below it cannot disagree about the shape of the quarter.
  //
  // A NULL POINT IS A GAP, NOT A ZERO, on the two pay series: a bucket whose
  // driver pay was never recorded contributes no bar rather than a bar at the
  // floor, because a cliff that never happened is the same wrong number the
  // hatch exists to prevent.
  const cells: {
    key: string
    label: MessageKey
    value: string
    points: (number | null)[]
  }[] = [
    {
      key: 'gross',
      label: 'dash.kpi.gross',
      value: money(board.kpis.grossCents),
      points: board.weeks.map((point) => point.grossCents),
    },
    {
      key: 'driverPay',
      label: 'dash.kpi.driverPay',
      value: money(board.kpis.driverPayCents),
      points: board.weeks.map((point) => point.driverPayCents),
    },
    {
      key: 'afterPay',
      // NOT "margin" and NOT "profit" on screen, whatever the field is called.
      // Nothing but driver pay has been subtracted.
      label: 'dash.kpi.afterDriverPay',
      value: money(board.kpis.marginCents),
      points: board.weeks.map((point) => point.marginCents),
    },
    {
      key: 'loads',
      label: 'dash.kpi.loads',
      value: String(board.kpis.loads),
      points: board.weeks.map((point) => point.loads),
    },
    {
      key: 'miles',
      label: 'dash.kpi.miles',
      value: board.kpis.miles.toLocaleString(locale),
      points: board.weeks.map((point) => point.miles),
    },
    {
      key: 'perMile',
      label: 'dash.kpi.centsPerMile',
      value:
        board.kpis.centsPerMile === null
          ? '—'
          : formatCents(board.kpis.centsPerMile, locale),
      // PER MILE IS A RATIO, SO IT IS COMPUTED PER BUCKET rather than carried.
      // Dividing the period's gross by the period's miles would draw one flat
      // line; dividing each bucket's own figures shows the rate moving, which
      // is the only reason to plot a ratio at all.
      points: board.weeks.map((point) =>
        point.miles <= 0 ? null : Math.round(point.grossCents / point.miles),
      ),
    },
  ]

  return (
    <section>
      <dl className="grid grid-cols-2 gap-z3 md:grid-cols-3 xl:grid-cols-6">
        {cells.map((cell) => (
          <div
            key={cell.key}
            className="rounded-card border border-border bg-surface p-z3"
          >
            <dt className="text-xs uppercase tracking-[0.04em] text-ink-3">
              {t(cell.label)}
            </dt>
            <dd className="mt-z1 font-mono text-lg tabular-nums text-ink">
              {cell.value}
            </dd>
            {/* THE SHAPE BESIDE THE FIGURE. §6.1.1: a figure without a
             * direction is half an answer. */}
            <Sparkline points={cell.points} label={t(cell.label)} />
          </div>
        ))}
      </dl>

      {/* WHY THE DASHES, SAID ONCE. Without this a reader meets two em dashes
       * and has no way to learn that the freight predates this system — which
       * is the difference between "we do not know" and "something is broken". */}
      {board.kpis.marginCents === null ? (
        <p className="mt-z2 text-xs text-ink-3">
          {board.payKnownFrom === null
            ? t('dash.payNeverKnown')
            : `${t('dash.payKnownFrom')} ${day(board.payKnownFrom)}`}
        </p>
      ) : null}
    </section>
  )
}
