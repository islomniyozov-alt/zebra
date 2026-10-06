import Link from 'next/link'
import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { formatCents } from '@/lib/money'
import { SETTLEMENT_BATCH_TIMEOUT_MS } from '@/lib/settlement-batch'
import {
  assembleReport,
  driverPayByCompany,
  driverTotals,
  firstSettledPeriodStart,
  grossByCompany,
  type DriverTotalRow,
  type Grouping,
} from '@/lib/by-company'
import {
  applyList,
  sumCents,
  type ListShape,
  type RawParams,
} from '@/lib/list-view'
import { companyIdScopeFilter, narrowCompanyScope } from '@/lib/tenancy'
import {
  DEFAULT_PERIOD,
  bucketsIn,
  grainOf,
  isPartialBucket,
  isPeriodKey,
  periodWindow,
  type PeriodKey,
} from '@/lib/rolling-period'
import {
  deductionsByCategory,
  receivablesSeries,
  scopeSql,
  settlementsPaidSeries,
} from '@/lib/accounting-reports'
import { agingSums } from '@/lib/factoring'
import { CompanyChips } from '../../_grid/CompanyChips'
import { PeriodPicker } from '../../_charts/PeriodPicker'
import { BarChart, type Bar } from '../../_charts/BarChart'
import { SeriesBars } from '../../_charts/SeriesBars'
import { AgingBar } from '../../_charts/AgingBar'
import { Donut } from '../../_charts/Donut'
import type { MessageKey } from '@/lib/i18n'
import { Table, type Column } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { FilterBar } from '@/components/ui/FilterBar'
import { Tabs } from '@/components/ui/Tabs'
import { PageHeader } from '../../_grid/PageHeader'
import { GridToolbar } from '../../_grid/GridToolbar'
import { GridFooterNav } from '../../_grid/GridFooterNav'
import { gridView, keepColumns, pagedFooterLabel } from '../../_grid/grid-page'
import { readGridColumns } from '@/lib/grid-columns'
import {
  transactionsInWindow,
  type TransactionRow,
} from '@/lib/transactions-report'

// ACCOUNTING → REPORTS (§6.2): the same money cut by company, week or driver.
//
// ── THREE CUTS, ONE WINDOW ────────────────────────────────────────────────
//
// `/money/by-company` was two of these — company × week and company × month —
// and had no by-driver cut at all, so "what has this driver earned this quarter"
// was a question with no screen. All three now take the same date range, which is
// what makes them comparable: a company total and the driver totals under it are
// over the same weeks or they are two different reports.
//
// ── "AFTER DRIVER PAY" IS THE WHOLE LABEL, AND IT IS NOT PROFIT ───────────
//
// Gross minus settlement load lines. Not fuel, not tolls, not insurance, not
// escrow. Carried over verbatim from the screen this replaces, because a column
// named profit that ignores fuel is a figure somebody quotes at a bank.
//
// ── NULL IS NOT ZERO ──────────────────────────────────────────────────────
//
// Before Zebra's first FINAL batch, Datatruck paid those drivers and this system
// never saw it. A zero would read as "this freight cost nothing to drive", which
// is the most expensive wrong number this page can print. `—` and a sentence.

export type Cut = 'company' | 'week' | 'driver' | 'transactions'

const CUTS: readonly Cut[] = ['company', 'week', 'driver', 'transactions']

/**
 * §6.2.10 part 4. Eight columns, one under §7.1's cap, so a ninth has room.
 * The amount is signed as stored — a ledger is read down to a net (§6.2.10).
 */
const TRANSACTION_COLUMNS: readonly string[] = [
  'period',
  'driver',
  'kind',
  'description',
  'load',
  'statement',
  'authority',
  'amount',
]

const DRIVER_COLUMNS: readonly string[] = [
  'driver',
  'weeks',
  'gross',
  'deductions',
  'net',
]

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>
}) {
  if (!(await currentUserCan('read', 'settlement'))) notFound()

  const raw = await searchParams
  const { t, locale } = await getLocaleContext()

  const search = new URLSearchParams(
    Object.entries(raw).flatMap(([key, value]) =>
      value === undefined
        ? []
        : [
            [key, Array.isArray(value) ? (value[0] ?? '') : value] as [
              string,
              string,
            ],
          ],
    ),
  )

  const cutParam = typeof raw.cut === 'string' ? raw.cut : null
  const cut: Cut = (CUTS as readonly string[]).includes(cutParam ?? '')
    ? (cutParam as Cut)
    : 'company'

  // ── ONE WINDOW CONTROL, AND IT IS THE ROLLING PICKER (§6.2.7) ──────────
  //
  // This screen had a `from`/`to` range AND a weekly/monthly toggle. Both are
  // gone: v10.16 revoked the two-window arrangement, so a picker beside a range
  // would be one screen answering for two periods. Flag 45 records what that
  // costs — "January to March by month" is no longer askable here.
  //
  // THE GRAIN COMES FROM THE PRESET, never from the span (v10.17).
  const period: PeriodKey =
    typeof raw.period === 'string' && isPeriodKey(raw.period)
      ? raw.period
      : DEFAULT_PERIOD
  const grain = grainOf(period)
  const now = new Date()
  const window = periodWindow(period, now)
  const { from, to } = window
  const companyParam = typeof raw.company === 'string' ? raw.company : null

  // THE TABLES BELOW STILL GROUP BY WEEK, which is now the only grouping the
  // readers are asked for from this screen. `grossByCompany` keeps its monthly
  // branch — it is a reader, not a control — but nothing offers it any more.
  const grouping: Grouping = 'week'

  const data = await withCurrentOrg(
    'read',
    'settlement',
    async (tx, session) => {
      // THE CHIP NARROWS EVERY CHART, not some of them. §6.2.7, and the defect
      // this helper is named after: dashboard part 3 passed the session scope
      // to three panels while the strip above them took the chip.
      const companyIds = narrowCompanyScope(session.companyScopes, companyParam)

      // ── THE CHARTS, FOR EVERY CUT ──────────────────────────────────────
      //
      // They answer for the window and the authority, which the tabs below do
      // not change — so they are read once rather than per cut.
      const charts = {
        receivables: await receivablesSeries(tx, companyIds, window, grain),
        settlements: await settlementsPaidSeries(tx, companyIds, window, grain),
        deductions: await deductionsByCategory(tx, companyIds, window),
        // THE AGING RULE, FROM THE ONE PLACE IT LIVES (§6.2.7). The dashboard's
        // Cash panel reads the same fragment, so the two cannot drift.
        aging: await agingSums(tx, scopeSql('i', companyIds), now),
        companies: await tx.company.findMany({
          where: {
            isActive: true,
            ...companyIdScopeFilter(session.companyScopes),
          },
          orderBy: { name: 'asc' },
          select: { id: true, name: true },
        }),
      }

      if (cut === 'transactions') {
        return {
          kind: 'transactions' as const,
          charts,
          rows: await transactionsInWindow(tx, {
            from,
            to,
            companyId: companyParam,
          }),
          columns: await readGridColumns(
            tx,
            session.userId,
            'reports.transactions',
            TRANSACTION_COLUMNS,
          ),
        }
      }
      if (cut === 'driver') {
        return {
          kind: 'driver' as const,
          charts,
          rows: await driverTotals(tx, { from, to }),
          columns: await readGridColumns(
            tx,
            session.userId,
            'reports.driver',
            DRIVER_COLUMNS,
          ),
        }
      }
      const [gross, pay, first] = await Promise.all([
        grossByCompany(tx, { grouping, from, to }),
        driverPayByCompany(tx, { grouping, from, to }),
        firstSettledPeriodStart(tx),
      ])

      // ── THE CHIP, APPLIED TO THE ROWS BEFORE THEY ARE ASSEMBLED ────────
      //
      // Item 7's two readers take no company scope — they exist to break money
      // DOWN by authority, so they return every one and let the caller choose.
      //
      // FILTERED BEFORE `assembleReport`, NEVER AFTER. The "all authorities"
      // row is computed from these rows, so filtering first makes it mean "all
      // SELECTED authorities" for free. Filtering the assembled report instead
      // would leave that row summing authorities the reader cannot see, or
      // require recomputing it here — a second expression of a total.
      const chosen = companyParam === null ? null : companyIds
      const mine = <T extends { companyId: string }>(rows: T[]) =>
        chosen === null
          ? rows
          : rows.filter((row) => chosen.includes(row.companyId))

      return {
        kind: 'periods' as const,
        charts,
        report: assembleReport({
          gross: mine(gross),
          pay: mine(pay),
          firstSettledPeriodStart: first,
        }),
      }
    },
    { timeoutMs: SETTLEMENT_BATCH_TIMEOUT_MS },
  )

  const money = (cents: number) => (
    <span className="font-mono tabular-nums">{formatCents(cents, locale)}</span>
  )
  const dash = <span className="text-ink-3">—</span>
  const day = (value: Date) => value.toISOString().slice(0, 10)

  const header = (
    <>
      <PageHeader
        title={t('accounting.reports.title')}
        breadcrumb={[t('nav.group.accounting'), t('accounting.reports.title')]}
      />
      <Tabs
        tabs={[
          { key: 'company', label: t('reports.tab.company') },
          { key: 'week', label: t('reports.tab.week') },
          { key: 'driver', label: t('reports.tab.driver') },
          // §6.2.10 part 4 — a different QUESTION about the same money (§7.1.6):
          // not what each driver netted, but every line that made the net.
          { key: 'transactions', label: t('reports.tab.transactions') },
        ]}
        active={cut}
        hrefFor={(key) => {
          const next = new URLSearchParams(search)
          next.set('cut', key)
          // EACH CUT OWNS ITS ORDERING (§7.1.6). A sort by `net` means nothing in
          // the authority matrix, and a stale `sort` would sit in the URL waiting
          // to be misread when the reader came back.
          next.delete('sort')
          next.delete('dir')
          next.delete('page')
          return `/accounting/reports?${next}`
        }}
        label={t('grid.tabs')}
      />
      {/* ── THE CONTROLS, ONCE, AND THE SAME ONES AS THE DASHBOARD ──────
       *
       * §6.2.7: one window control on the screen. The chips and the picker are
       * the components from `_charts` and `_grid`, not copies — a second date
       * range beside them would be the two-window arrangement v10.16 revoked.
       *
       * THE SEARCH BOX STAYS, on the driver cut only, because searching a list
       * of drivers is not a window. */}
      <div className="flex flex-wrap items-center justify-between gap-z3 border-b border-border bg-surface px-gutter py-z2">
        <CompanyChips
          companies={data.charts.companies}
          label={t('accounting.company')}
          allLabel={t('accounting.allCompanies')}
        />
        <PeriodPicker
          legend={t('dash.period')}
          labels={{
            d7: t('dash.period.d7'),
            w4: t('dash.period.w4'),
            w13: t('dash.period.w13'),
            w52: t('dash.period.w52'),
          }}
        />
      </div>
      {cut !== 'driver' ? null : (
        <FilterBar
          groups={[]}
          search={{
            param: 'q',
            label: t('accounting.search'),
            placeholder: t('accounting.reports.searchHint'),
          }}
          clearLabel={t('filter.clear')}
          moreLabel={t('filter.more')}
        />
      )}
      <p className="border-b border-border bg-surface-2 px-gutter py-z2 text-xs text-ink-2">
        {t('reports.windowIs')}{' '}
        <span className="font-mono" dir="ltr">
          {day(from)} — {day(new Date(to.getTime() - 1))}
        </span>
      </p>
    </>
  )

  // ── THE CHARTED SECTIONS (§6.2.7) ────────────────────────────────────────
  //
  // Read once for every cut, because they answer for the window and the
  // authority — neither of which the tabs change. They sit above the tables:
  // the charts answer "which way is this going" and the tables answer "what
  // exactly", and §6.2.7 keeps both rather than replacing one with the other.
  const bucketLabel = (at: Date) =>
    new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(at)

  /** SAYS WHAT THE BUCKET COVERS. A weekly bar labelled "Sep 20" is ambiguous. */
  const bucketDetail = (at: Date) => {
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
    return `${bucketLabel(at)} – ${bucketLabel(end)}`
  }

  // EVERY BUCKET IN THE WINDOW, INCLUDING THE EMPTY ONES. A series built from
  // rows alone draws a dense week where there was a sparse one and labels none
  // of it — the axis comes from the window and the rows are looked up into it.
  const axis = bucketsIn(window, grain)
  const key = (at: Date) => at.toISOString().slice(0, 10)

  const receivablesBy = new Map(
    data.charts.receivables.map((point) => [key(point.bucketStart), point]),
  )
  const settlementsBy = new Map(
    data.charts.settlements.map((point) => [key(point.bucketStart), point]),
  )

  const charts = (
    <div className="flex flex-col gap-z5 border-b border-border bg-surface-2 px-gutter py-z4">
      {/* ── RECEIVABLES: AGE, THEN BILLED AGAINST COLLECTED ──────────── */}
      <section className="rounded-card border border-border bg-surface p-z4">
        <h2 className="text-md font-medium text-ink">
          {t('reports.chart.receivables')}
        </h2>
        <div className="mt-z3">
          <AgingBar
            aging={data.charts.aging}
            locale={locale}
            labels={{
              heading: t('reports.chart.aging'),
              note: t('reports.chart.agingNote'),
              // THE SAME WORDS AS THE CASH PANEL, from the same keys: two
              // screens quoting one reader must not label it differently.
              d0_30: t('dash.cash.d0_30'),
              d31_60: t('dash.cash.d31_60'),
              d61_90: t('dash.cash.d61_90'),
              d90plus: t('dash.cash.d90plus'),
              bucket: t('dash.cash.bucket'),
              amount: t('reports.chart.amount'),
              empty: t('dash.cash.noReceivables'),
            }}
          />
        </div>

        <div className="mt-z5">
          <p className="mb-z1 text-xs text-ink-3">
            {t('reports.chart.billingNote')}
          </p>
          <SeriesBars
            buckets={axis.map((at) => {
              const point = receivablesBy.get(key(at))
              return {
                key: key(at),
                label: bucketLabel(at),
                detail: bucketDetail(at),
                values: [
                  point?.invoicedCents ?? 0,
                  point?.factoredCents ?? 0,
                  point?.collectedCents ?? 0,
                ],
                partial: isPartialBucket(at, grain, window.to),
              }
            })}
            series={[
              { key: 'invoiced', label: t('reports.chart.invoiced') },
              { key: 'factored', label: t('reports.chart.factored') },
              { key: 'collected', label: t('reports.chart.collected') },
            ]}
            locale={locale}
            labels={{
              heading: t('reports.chart.billing'),
              bucket: t('reports.chart.bucket'),
              empty: t('reports.chart.empty'),
              partial: t('reports.chart.partial'),
            }}
          />
        </div>
      </section>

      {/* ── SETTLEMENTS: PAID PER PERIOD, AND WHAT CAME OFF ───────────── */}
      <section className="rounded-card border border-border bg-surface p-z4">
        <h2 className="text-md font-medium text-ink">
          {t('reports.chart.settlements')}
        </h2>
        <div className="mt-z3">
          <p className="mb-z1 text-xs text-ink-3">
            {t('reports.chart.settlementsNote')}
          </p>
          <SeriesBars
            buckets={axis.map((at) => {
              const point = settlementsBy.get(key(at))
              return {
                key: key(at),
                label: bucketLabel(at),
                detail: bucketDetail(at),
                values: [point?.grossCents ?? 0, point?.netCents ?? 0],
                partial: isPartialBucket(at, grain, window.to),
              }
            })}
            series={[
              { key: 'gross', label: t('reports.chart.paidGross') },
              { key: 'net', label: t('reports.chart.paidNet') },
            ]}
            locale={locale}
            labels={{
              heading: t('reports.chart.settlements'),
              bucket: t('reports.chart.bucket'),
              empty: t('reports.chart.empty'),
              partial: t('reports.chart.partial'),
            }}
          />
        </div>

        <div className="mt-z5 lg:w-1/2">
          <Donut
            slices={data.charts.deductions.map((slice) => ({
              key: slice.category,
              label: t(`reports.deduction.${slice.category}` as MessageKey),
              cents: slice.cents,
            }))}
            locale={locale}
            labels={{
              heading: t('reports.chart.deductions'),
              // FOUR CATEGORIES AND A `top` OF SIX, so there is never a
              // remainder slice — the label exists because the component takes
              // it, and it should never render.
              other: (count) =>
                `${t('reports.chart.other')} (${String(count)})`,
              name: t('reports.deduction.category'),
              value: t('reports.chart.amount'),
              share: t('reports.chart.share'),
              empty: t('reports.chart.empty'),
            }}
          />
        </div>
      </section>
    </div>
  )

  // ── BY DRIVER: A LIST, so it gets the four controls and a totals row ─────
  if (data.kind === 'transactions') {
    // ── EVERY LINE, SIGNED, SUMMING TO THE NET (§6.2.10 part 4) ────────────
    const KIND_LABEL: Record<TransactionRow['kind'], MessageKey> = {
      tripPay: 'reports.kind.tripPay',
      advance: 'reports.kind.advance',
      deduction: 'reports.kind.deduction',
      adjustment: 'reports.kind.adjustment',
    }
    const shape: ListShape<TransactionRow> = {
      searchText: (row) =>
        `${row.driverName} ${row.description} ${row.loadNumber ?? ''} ${row.settlementNumber}`,
      sorts: {
        period: (row) => row.periodEnd.getTime(),
        driver: (row) => row.driverName,
        kind: (row) => row.kind,
        amount: (row) => row.amountCents,
        statement: (row) => row.settlementNumber,
      },
      defaultSort: 'period',
      defaultDir: 'desc',
    }
    const view = gridView(data.rows, raw, shape, applyList)
    const columns: Column<TransactionRow>[] = [
      {
        key: 'period',
        header: t('reports.week'),
        sortable: true,
        render: (row) => (
          <span className="font-mono text-xs" dir="ltr">
            {row.periodEnd.toISOString().slice(0, 10)}
          </span>
        ),
      },
      {
        key: 'driver',
        header: t('payroll.driver'),
        truncate: true,
        sortable: true,
        render: (row) => row.driverName,
      },
      {
        key: 'kind',
        header: t('reports.kind'),
        sortable: true,
        // THE CATEGORY RIDES WITH A DEDUCTION, in smaller type: §6.2.7's four
        // words, from §6.2.7's own CASE, so the two screens agree.
        render: (row) => (
          <span className="flex flex-col">
            <span>{t(KIND_LABEL[row.kind])}</span>
            {row.category ? (
              <span className="text-xs text-ink-3">
                {t(`reports.deduction.${row.category}` as MessageKey)}
              </span>
            ) : null}
          </span>
        ),
      },
      {
        key: 'description',
        header: t('reports.description'),
        truncate: true,
        render: (row) => row.description,
      },
      {
        key: 'load',
        header: t('settlements.trip.load'),
        render: (row) =>
          row.loadNumber ? (
            <span className="z-identifier font-mono" dir="ltr">
              {row.loadNumber}
            </span>
          ) : (
            <span className="text-ink-3">—</span>
          ),
      },
      {
        key: 'statement',
        header: t('statements.statement'),
        sortable: true,
        render: (row) => (
          <span className="z-identifier font-mono" dir="ltr">
            {row.settlementNumber}
          </span>
        ),
      },
      {
        key: 'authority',
        header: t('accounting.company'),
        truncate: true,
        render: (row) => row.companyName,
      },
      {
        key: 'amount',
        header: t('reports.amount'),
        align: 'end',
        sortable: true,
        render: (row) => money(row.amountCents),
        // THE FOOT IS THE NET. Signed lines summed, which is what the statements
        // netted — the agreement test's own arithmetic, on the screen.
        foot: (shown) => money(sumCents(shown, (row) => row.amountCents)),
      },
    ]
    return (
      <>
        {header}
        {charts}
        <div className="flex items-center justify-end gap-z2 border-b border-border bg-surface px-gutter py-z2">
          <GridToolbar
            grid="reports.transactions"
            columns={columns.map((column) => ({
              key: column.key,
              header: column.header,
            }))}
            visible={data.columns}
            search={search}
            labels={{
              export: t('grid.export'),
              columns: t('grid.columns'),
              apply: t('grid.columns.apply'),
              cancel: t('grid.columns.cancel'),
              firstLocked: t('grid.columns.firstLocked'),
            }}
            errors={{
              'grid.columns.errorEmpty': t('grid.columns.errorEmpty'),
              'grid.columns.errorGrid': t('grid.columns.errorGrid'),
            }}
          />
        </div>
        <Table
          columns={keepColumns(columns, data.columns)}
          rows={view.paged.rows}
          footRows={view.filtered}
          rowKey={(row) => `${row.source}:${row.lineId}`}
          rowHref={(row) => `/settlements/${row.settlementId}`}
          caption={t('reports.tab.transactions')}
          sort={{
            key: view.sort.key,
            dir: view.sort.dir,
            hrefFor: view.sortFor('/accounting/reports'),
            label: t('accounting.sortBy'),
          }}
          totals={{
            label: pagedFooterLabel(
              t('reports.tab.transactions'),
              t('grid.rows'),
              view.paged,
            ),
          }}
          empty={
            <EmptyState
              title={t('reports.transactions.empty')}
              body={t('reports.transactions.emptyHint')}
            />
          }
        />
        <GridFooterNav
          paged={view.paged}
          per={view.params.per}
          path="/accounting/reports"
          search={search}
          hrefForPage={view.hrefForPage('/accounting/reports')}
          labels={{
            of: t('grid.of'),
            previous: t('grid.previous'),
            next: t('grid.next'),
            perPage: t('grid.perPage'),
          }}
        />
      </>
    )
  }
  if (data.kind === 'driver') {
    const shape: ListShape<DriverTotalRow> = {
      searchText: (row) => row.driverName,
      sorts: {
        driver: (row) => row.driverName,
        weeks: (row) => row.weeks,
        gross: (row) => row.grossCents,
        deductions: (row) => row.deductionsCents,
        net: (row) => row.netCents,
      },
      defaultSort: 'net',
      defaultDir: 'desc',
    }
    // THE FULL GRID CONTRACT ON THE ONE CUT THAT IS A LIST (§7.1.3). The other
    // two are a matrix — periods down, authorities across — and `Table` renders
    // one row per record, so they carry the range and nothing else.
    const view = gridView(data.rows, raw, shape, applyList)

    const columns: Column<DriverTotalRow>[] = [
      {
        key: 'driver',
        header: t('payroll.driver'),
        sortable: true,
        render: (row) => row.driverName,
      },
      {
        key: 'weeks',
        header: t('reports.weeksPaid'),
        align: 'end',
        sortable: true,
        render: (row) => (
          <span className="font-mono tabular-nums">{row.weeks}</span>
        ),
        foot: (shown) => (
          <span className="font-mono tabular-nums">
            {sumCents(shown, (row) => row.weeks)}
          </span>
        ),
      },
      {
        key: 'gross',
        header: t('payroll.gross'),
        align: 'end',
        sortable: true,
        render: (row) => money(row.grossCents),
        foot: (shown) => money(sumCents(shown, (row) => row.grossCents)),
      },
      {
        key: 'deductions',
        header: t('payroll.deductions'),
        align: 'end',
        sortable: true,
        render: (row) => money(row.deductionsCents),
        foot: (shown) => money(sumCents(shown, (row) => row.deductionsCents)),
      },
      {
        key: 'net',
        header: t('payroll.net'),
        align: 'end',
        sortable: true,
        render: (row) => money(row.netCents),
        foot: (shown) => money(sumCents(shown, (row) => row.netCents)),
      },
    ]

    return (
      <>
        {header}
        {charts}
        <div className="flex items-center justify-end gap-z2 border-b border-border bg-surface px-gutter py-z2">
          <GridToolbar
            grid="reports.driver"
            columns={columns.map((column) => ({
              key: column.key,
              header: column.header,
            }))}
            visible={data.columns}
            search={search}
            labels={{
              export: t('grid.export'),
              columns: t('grid.columns'),
              apply: t('grid.columns.apply'),
              cancel: t('grid.columns.cancel'),
              firstLocked: t('grid.columns.firstLocked'),
            }}
            errors={{
              'grid.columns.errorEmpty': t('grid.columns.errorEmpty'),
              'grid.columns.errorGrid': t('grid.columns.errorGrid'),
            }}
          />
        </div>
        <Table
          columns={keepColumns(columns, data.columns)}
          rows={view.paged.rows}
          footRows={view.filtered}
          rowKey={(row) => row.driverId}
          rowHref={(row) => `/drivers/${row.driverId}`}
          caption={t('reports.byDriver')}
          sort={{
            key: view.sort.key,
            dir: view.sort.dir,
            hrefFor: view.sortFor('/accounting/reports'),
            label: t('accounting.sortBy'),
          }}
          totals={{
            label: pagedFooterLabel(
              t('accounting.total'),
              t('grid.rows'),
              view.paged,
            ),
          }}
          empty={
            <EmptyState
              title={t('reports.emptyDriver')}
              body={t('reports.emptyDriverHint')}
            />
          }
        />
        <GridFooterNav
          paged={view.paged}
          per={view.params.per}
          path="/accounting/reports"
          search={search}
          hrefForPage={view.hrefForPage('/accounting/reports')}
          labels={{
            of: t('grid.of'),
            previous: t('grid.previous'),
            next: t('grid.next'),
            perPage: t('grid.perPage'),
          }}
        />
      </>
    )
  }

  // ── BY COMPANY / BY WEEK: a matrix, which is not a list ──────────────────
  //
  // Deliberately NOT `Table`: §7.1's component is one row per record with a
  // status stripe and a clickable row, and this is periods down, authorities
  // across. Forcing it through would mean nine columns of "company" headers
  // pretending to be fields.
  const { report } = data
  const periods =
    cut === 'week' ? report.periods : [...report.periods].reverse()

  // ── ONE SERIES PER AUTHORITY, FROM THE REPORT'S OWN CELLS ──────────────
  //
  // The chart is the table drawn, so it is built from the same cells rather
  // than from a second read — which also means it cannot show a period the
  // table does not have.
  //
  // THE AXIS IS THE WINDOW, NOT THE ROWS. A period with no freight produces no
  // row, and a chart built from rows alone draws twelve bars across thirteen
  // weeks. Each authority's series is looked up into the full axis, so a silent
  // week is a gap at its own position.
  const cellsOf = new Map<
    string,
    Map<number, (typeof report.periods)[number]['companies'][number]>
  >()
  const nameOf = new Map<string, string>()
  for (const entry of report.periods) {
    for (const cell of entry.companies) {
      nameOf.set(cell.companyId, cell.companyName)
      const mine = cellsOf.get(cell.companyId) ?? new Map()
      mine.set(entry.periodStart.getTime(), cell)
      cellsOf.set(cell.companyId, mine)
    }
  }

  const authorities = [...cellsOf.entries()]
    .map(([companyId, cells]) => ({
      companyId,
      companyName: nameOf.get(companyId) ?? companyId,
      bars: axis.map((at): Bar => {
        const cell = cells.get(at.getTime())
        return {
          key: key(at),
          label: bucketLabel(at),
          detail: bucketDetail(at),
          grossCents: cell?.grossCents ?? 0,
          // NULL SURVIVES. A period Zebra was not settling has unknown pay, and
          // the chart hatches it rather than drawing a zero that would say the
          // freight cost nothing to drive.
          driverPayCents: cell?.driverPayCents ?? null,
          marginCents: cell?.afterDriverPayCents ?? null,
          // NO LOAD COUNT ON THIS REPORT. `BarChart` takes it as optional and
          // leaves the row out of the tooltip rather than printing a zero —
          // item 7's readers group money, not loads.
          loads: null,
          partial: isPartialBucket(at, grain, window.to),
        }
      }),
    }))
    .sort((a, b) => a.companyName.localeCompare(b.companyName))

  return (
    <>
      {header}
      {/* ── BY COMPANY: WEEKLY BARS PER AUTHORITY (§6.2.7) ────────────────
       *
       * `BarChart` unchanged, which is the point: this is exactly the money
       * series it was built for — gross, driver pay, after driver pay, and the
       * hatch where pay was never recorded. One chart per authority, because
       * four authorities' gross on one axis is four series nobody asked to
       * compare bar-by-bar; the matrix below is where they are read together.
       *
       * THE PERIODS COME FROM THE REPORT, not from the axis: this chart is the
       * table's own figures drawn, and a bucket the table does not have is a
       * bucket this chart must not invent. */}
      <div className="flex flex-col gap-z5 border-b border-border bg-surface-2 px-gutter py-z4">
        {authorities.map((authority) => (
          <section
            key={authority.companyId}
            className="rounded-card border border-border bg-surface p-z4"
          >
            <BarChart
              bars={authority.bars}
              locale={locale}
              labels={{
                heading: `${authority.companyName} — ${t('reports.chart.byCompany')}`,
                gross: t('reports.gross'),
                driverPay: t('reports.chart.driverPay'),
                unrecorded: t('reports.chart.unrecorded'),
                afterDriverPay: t('reports.afterDriverPay'),
                loads: t('reports.chart.loads'),
                empty: t('reports.chart.empty'),
                partial: t('reports.chart.partial'),
                bucket:
                  grain === 'day' ? t('dash.chart.day') : t('reports.week'),
              }}
            />
          </section>
        ))}
      </div>
      {charts}
      {report.firstSettledPeriodStart === null ? (
        <p className="border-b border-border bg-warning-soft px-gutter py-z2 text-xs text-warning">
          {t('reports.noneSettled')}
        </p>
      ) : null}

      {periods.length === 0 ? (
        <EmptyState
          title={t('reports.emptyPeriods')}
          body={t('reports.emptyPeriodsHint')}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto bg-surface">
          <table className="w-full border-collapse text-start">
            <caption className="sr-only">
              {cut === 'week' ? t('reports.byWeek') : t('reports.byCompany')}
            </caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky top-0 z-10 border-b border-border bg-surface-2 px-z3 py-z2 text-start text-xs font-semibold uppercase tracking-[0.04em] text-ink-2"
                >
                  {grouping === 'week' ? t('reports.week') : t('reports.month')}
                </th>
                <th
                  scope="col"
                  className="sticky top-0 z-10 border-b border-border bg-surface-2 px-z3 py-z2 text-start text-xs font-semibold uppercase tracking-[0.04em] text-ink-2"
                >
                  {t('reports.authority')}
                </th>
                <th
                  scope="col"
                  className="sticky top-0 z-10 border-b border-border bg-surface-2 px-z3 py-z2 text-end text-xs font-semibold uppercase tracking-[0.04em] text-ink-2"
                >
                  {t('reports.gross')}
                </th>
                <th
                  scope="col"
                  className="sticky top-0 z-10 border-b border-border bg-surface-2 px-z3 py-z2 text-end text-xs font-semibold uppercase tracking-[0.04em] text-ink-2"
                >
                  {t('reports.atRate')}
                </th>
                <th
                  scope="col"
                  className="sticky top-0 z-10 border-b border-border bg-surface-2 px-z3 py-z2 text-end text-xs font-semibold uppercase tracking-[0.04em] text-ink-2"
                >
                  {t('reports.afterDriverPay')}
                </th>
              </tr>
            </thead>
            <tbody>
              {periods.map((period) =>
                [period.all, ...period.companies].map((cell, index) => (
                  <tr
                    key={`${period.periodStart.getTime()}-${cell.companyId}`}
                    className="h-[var(--z-row-height)] border-b border-border hover:bg-surface-3"
                  >
                    {/* THE PERIOD ONCE PER GROUP, not repeated down every
                     * authority — rule 1, and a column of identical dates is
                     * four rows of nothing to compare. */}
                    <td className="px-z3 py-[var(--z-cell-pad-y)] font-mono text-[length:var(--z-body-size)]/[var(--z-body-line)] text-ink">
                      {index === 0 ? (
                        <Link
                          href={`/accounting/payroll?week=${day(period.periodStart)}`}
                          className="font-medium text-ink hover:text-accent"
                          dir="ltr"
                        >
                          {day(period.periodStart)}
                        </Link>
                      ) : null}
                    </td>
                    <td
                      className={`px-z3 py-[var(--z-cell-pad-y)] text-[length:var(--z-body-size)]/[var(--z-body-line)] ${
                        index === 0 ? 'font-medium text-ink' : 'text-ink-2'
                      }`}
                    >
                      {index === 0
                        ? t('reports.allCompanies')
                        : cell.companyName}
                    </td>
                    <td className="px-z3 py-[var(--z-cell-pad-y)] text-end text-[length:var(--z-body-size)]/[var(--z-body-line)] text-ink">
                      {money(cell.grossCents)}
                    </td>
                    <td className="px-z3 py-[var(--z-cell-pad-y)] text-end text-[length:var(--z-body-size)]/[var(--z-body-line)] text-ink-2">
                      {money(cell.atRateCents)}
                    </td>
                    <td className="px-z3 py-[var(--z-cell-pad-y)] text-end text-[length:var(--z-body-size)]/[var(--z-body-line)] text-ink">
                      {cell.afterDriverPayCents === null
                        ? dash
                        : money(cell.afterDriverPayCents)}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
