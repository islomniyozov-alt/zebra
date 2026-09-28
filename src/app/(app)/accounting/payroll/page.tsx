import Link from 'next/link'
import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { formatCents } from '@/lib/money'
import { companyScopeFilter } from '@/lib/tenancy'
import { payWeekFor } from '@/lib/settlement-week'
import { payrollWeek, recentWeeks, weekFromParam } from '@/lib/payroll'
import { readGridColumns, type GridId } from '@/lib/grid-columns'
import { applyList, sumCents, type RawParams } from '@/lib/list-view'
import {
  balanceShape,
  batchShape,
  oneTimeShape,
  readBalances,
  readBatches,
  readOneTimeCharges,
  readScheduled,
  readStatements,
  scheduledForWeek,
  scheduledShape,
  statementShape,
  type BalanceGridRow,
  type BatchGridRow,
  type OneTimeGridRow,
  type StatementGridRow,
} from '@/lib/accounting-grids'
import type { ChargeRow } from '@/lib/driver-deductions'
import { Table, type Column } from '@/components/ui/Table'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EmptyState } from '@/components/ui/EmptyState'
import { FilterBar } from '@/components/ui/FilterBar'
import { Tabs } from '@/components/ui/Tabs'
import { GridFooterNav } from '../GridFooterNav'
import { AccountingHeader } from '../AccountingHeader'
import { GridToolbar } from '../GridToolbar'
import { gridView, keepColumns, pagedFooterLabel } from '../grid-page'
import { WeekPicker } from './WeekPicker'
import { OpenWeek } from './OpenWeek'
import { BatchActions } from '../../settlements/batches/[id]/BatchActions'
import type { MessageKey } from '@/lib/i18n'
import type { StatusTone } from '@/lib/status'

// ACCOUNTING → PAYROLL (§6.2, §7.1.6): five tabs over one grid.
//
// ── EACH TAB IS A DIFFERENT QUESTION ──────────────────────────────────────
//
//   Batches            what runs exist, and what state each is in
//   Driver statements  one row per driver-week, across every run
//   Balances           what each driver has earned and owed this year
//   One-time charges   single lines somebody added to a week
//   Scheduled payments what comes off THIS week, every week
//
// None of them is a filter on another, which is §7.1.6's test. "Driver
// statements" is not "Batches, expanded" — a batch is a run and a statement is a
// document, and the second exists without the first for every settlement
// generated before batching.
//
// ── SCHEDULED PAYMENTS IS SCOPED TO THE WEEK, AND CHARGES IS NOT ──────────
//
// The one place this structure could have collapsed into a duplicate. Accounting
// → Charges is org-wide and every week: "who is not paying insurance", which
// needs no batch to answer. This tab is what comes off the week on screen. A rule
// dormant until November shows on one and not the other.

// ── STATUS, TONE AND LABEL, AS AN EXPLICIT MAP ────────────────────────────
//
// THE CAST WAS THE BUG. `t(`batchStatus.${row.status}` as MessageKey)` compiles
// against any string, and `translator` falls back to `en[key] ?? undefined` — so a
// key that does not exist renders an EMPTY badge instead of throwing. None of
// `batchStatus.DRAFT|FINAL|PAID` existed; typecheck passed; the status column
// would have shipped blank.
//
// A `Record` KEYED BY THE STATUS AND VALUED BY A REAL `MessageKey` is the fix, and
// it is a mechanism rather than care: a sixth status has to be added here to
// compile, and `MessageKey` has to exist in the dictionary to type.
const STATUS: Record<string, { tone: StatusTone; label: MessageKey }> = {
  DRAFT: { tone: 'neutral', label: 'batchStatus.DRAFT' },
  FINAL: { tone: 'progress', label: 'batchStatus.FINAL' },
  PAID: { tone: 'success', label: 'batchStatus.PAID' },
  APPROVED: { tone: 'progress', label: 'batchStatus.APPROVED' },
  VOID: { tone: 'muted', label: 'batchStatus.VOID' },
}

/** An unrecognised status shows the raw value rather than nothing at all. */
const statusOf = (value: string) =>
  STATUS[value] ?? { tone: 'neutral' as StatusTone, label: null }

const TABS = [
  'batches',
  'statements',
  'balances',
  'oneTime',
  'scheduled',
] as const
type Tab = (typeof TABS)[number]

const GRID_FOR: Record<Tab, GridId> = {
  batches: 'payroll.batches',
  statements: 'payroll.statements',
  balances: 'payroll.balances',
  oneTime: 'payroll.oneTime',
  scheduled: 'payroll.scheduled',
}

const WEEKS_OFFERED = 12
const PATH = '/accounting/payroll'

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>
}) {
  if (!(await currentUserCan('read', 'settlement'))) notFound()

  const raw = await searchParams
  const { t, locale } = await getLocaleContext()
  const mayWrite = await currentUserCan('update', 'settlement')
  const mayOpen = await currentUserCan('create', 'settlement')
  // A DRIVER'S OWN MONEY IS A SEPARATE PERMISSION from a batch total. Three of
  // the five tabs are `driver.pay`, and a role holding only `settlement` sees
  // Batches and nothing under it.
  const maySeePay = await currentUserCan('read', 'driver.pay')

  const wanted = typeof raw.tab === 'string' ? raw.tab : null
  const requested: Tab = (TABS as readonly string[]).includes(wanted ?? '')
    ? (wanted as Tab)
    : 'batches'
  // AN UNPERMITTED TAB FALLS BACK RATHER THAN 404s. A link somebody was sent
  // should land them somewhere they can read, and the tab strip already does not
  // offer what they cannot see.
  const tab: Tab = !maySeePay && requested !== 'batches' ? 'batches' : requested

  const due = payWeekFor(new Date())
  const chosen =
    weekFromParam(typeof raw.week === 'string' ? raw.week : null) ?? due.period
  const offered = recentWeeks(due.period, WEEKS_OFFERED)
  const year = Number(raw.year) || new Date().getUTCFullYear()

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

  const data = await withCurrentOrg(
    'read',
    'settlement',
    async (tx, session) => {
      const scope = companyScopeFilter(session.companyScopes)
      const week = await payrollWeek(tx, {
        organizationId: session.organizationId,
        period: chosen,
      })
      const opened = await tx.settlementBatch.findMany({
        where: {
          organizationId: session.organizationId,
          deletedAt: null,
          periodStart: { in: offered.map((period) => period.start) },
        },
        select: { periodStart: true },
      })

      // ONLY THE TAB'S OWN ROWS. Reading all five would be four queries nobody
      // asked for on every page load, and the batches grid alone walks every
      // settlement's load lines.
      const batches = tab === 'batches' ? await readBatches(tx, scope) : []
      const statements =
        tab === 'statements' ? await readStatements(tx, scope) : []
      const balances =
        tab === 'balances' ? await readBalances(tx, scope, year) : []
      const oneTime =
        tab === 'oneTime'
          ? await readOneTimeCharges(tx, scope, {
              from: chosen.start,
              to: new Date(chosen.end.getTime() + 86_399_999),
            })
          : []
      const scheduled =
        tab === 'scheduled'
          ? scheduledForWeek(await readScheduled(tx, scope), chosen)
          : []

      const columns = await readGridColumns(
        tx,
        session.userId,
        GRID_FOR[tab],
        COLUMN_KEYS[tab],
      )

      return {
        week,
        opened: opened.map((row) => row.periodStart.getTime()),
        batches,
        statements,
        balances,
        oneTime,
        scheduled,
        columns,
      }
    },
  )

  const { week } = data
  const day = (value: Date) => value.toISOString().slice(0, 10)
  const money = (cents: number) => (
    <span className="font-mono tabular-nums">{formatCents(cents, locale)}</span>
  )
  const count = (value: number) => (
    <span className="font-mono tabular-nums">{value}</span>
  )
  const errors = {
    'grid.columns.errorEmpty': t('grid.columns.errorEmpty'),
    'grid.columns.errorGrid': t('grid.columns.errorGrid'),
  }
  const footerLabels = {
    of: t('grid.of'),
    previous: t('grid.previous'),
    next: t('grid.next'),
    perPage: t('grid.perPage'),
  }
  const toolbarLabels = {
    export: t('grid.export'),
    columns: t('grid.columns'),
    apply: t('grid.columns.apply'),
    cancel: t('grid.columns.cancel'),
    firstLocked: t('grid.columns.firstLocked'),
  }

  // ── THE FIVE COLUMN SETS ─────────────────────────────────────────────────

  const batchColumns: Column<BatchGridRow>[] = [
    {
      key: 'batchNumber',
      header: t('batches.batch'),
      sortable: true,
      render: (row) => (
        <span className="z-identifier font-mono" dir="ltr">
          {row.batchNumber ?? row.id.slice(0, 8)}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('payroll.status'),
      sortable: true,
      render: (row) => {
        const state = statusOf(row.status)
        return (
          <StatusBadge
            tone={state.tone}
            label={state.label ? t(state.label) : row.status}
          />
        )
      },
    },
    {
      key: 'created',
      header: t('batches.created'),
      sortable: true,
      render: (row) => (
        <span className="font-mono text-xs" dir="ltr">
          {day(row.createdAt)}
        </span>
      ),
    },
    {
      key: 'checkDate',
      header: t('batch.checkDate'),
      sortable: true,
      render: (row) => (
        <span className="font-mono text-xs" dir="ltr">
          {day(row.checkDate)}
        </span>
      ),
    },
    {
      key: 'period',
      header: t('batches.period'),
      sortable: true,
      render: (row) => (
        <span className="font-mono text-xs" dir="ltr">
          {day(row.periodStart)} — {day(row.periodEnd)}
        </span>
      ),
    },
    {
      key: 'statements',
      header: t('batches.statements'),
      align: 'end',
      sortable: true,
      render: (row) => count(row.statements),
      foot: (shown) => count(sumCents(shown, (row) => row.statements)),
    },
    {
      key: 'amount',
      header: t('batches.amount'),
      align: 'end',
      sortable: true,
      render: (row) => money(row.amountCents),
      foot: (shown) => money(sumCents(shown, (row) => row.amountCents)),
    },
    {
      key: 'payCompany',
      header: t('batches.payCompany'),
      sortable: true,
      // NO SOURCE FOR THIS YET. `SettlementBatch` carries no paying authority and
      // nothing in the schema does; see the note on `payCompanyName`. It says
      // "not recorded" rather than guessing at the authority with the largest
      // share, which would print a real company beside real money on an
      // assumption nobody made.
      render: (row) =>
        row.payCompanyName ?? (
          <span className="text-ink-3">{t('batches.payCompanyMissing')}</span>
        ),
    },
    {
      key: 'notes',
      header: t('batches.notes'),
      truncate: true,
      render: (row) => row.notes ?? <span className="text-ink-3">—</span>,
    },
  ]

  const statementColumns: Column<StatementGridRow>[] = [
    {
      key: 'driver',
      header: t('payroll.driver'),
      sortable: true,
      render: (row) => row.driverName,
    },
    {
      key: 'period',
      header: t('batches.period'),
      sortable: true,
      render: (row) => (
        <span className="font-mono text-xs" dir="ltr">
          {day(row.periodStart)} — {day(row.periodEnd)}
        </span>
      ),
    },
    {
      key: 'unit',
      header: t('payroll.unit'),
      sortable: true,
      render: (row) => (
        <span className="z-identifier font-mono text-xs" dir="ltr">
          {row.unitNumber ?? '—'}
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
    {
      key: 'status',
      header: t('payroll.status'),
      sortable: true,
      render: (row) => (
        <div className="flex items-baseline gap-z2">
          <StatusBadge
            tone={statusOf(row.status).tone}
            label={
              statusOf(row.status).label
                ? t(statusOf(row.status).label!)
                : row.status
            }
          />
          {/* A STATEMENT WITH NO RUN, said in words. These predate batching and
           * are the reason `batchId` is nullable. */}
          {row.batchId === null ? (
            <span className="text-xs text-ink-3">
              {t('statements.noBatch')}
            </span>
          ) : null}
        </div>
      ),
    },
  ]

  const balanceColumns: Column<BalanceGridRow>[] = [
    {
      key: 'driver',
      header: t('payroll.driver'),
      sortable: true,
      render: (row) => row.driverName,
    },
    {
      key: 'weeks',
      header: t('balances.weeks'),
      align: 'end',
      sortable: true,
      render: (row) => count(row.weeks),
      foot: (shown) => count(sumCents(shown, (row) => row.weeks)),
    },
    {
      key: 'opening',
      header: t('balances.opening'),
      align: 'end',
      sortable: true,
      render: (row) => money(row.openingNetCents),
      foot: (shown) => money(sumCents(shown, (row) => row.openingNetCents)),
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
      key: 'ytd',
      header: t('balances.ytd'),
      align: 'end',
      sortable: true,
      render: (row) => money(row.ytdNetCents),
      foot: (shown) => money(sumCents(shown, (row) => row.ytdNetCents)),
    },
    {
      key: 'escrow',
      header: t('balances.escrow'),
      align: 'end',
      sortable: true,
      render: (row) => money(row.escrowHeldCents),
      foot: (shown) => money(sumCents(shown, (row) => row.escrowHeldCents)),
    },
  ]

  const oneTimeColumns: Column<OneTimeGridRow>[] = [
    {
      key: 'driver',
      header: t('payroll.driver'),
      sortable: true,
      render: (row) => row.driverName,
    },
    {
      key: 'type',
      header: t('charges.type'),
      sortable: true,
      render: (row) => row.type,
    },
    {
      key: 'description',
      header: t('charges.description'),
      truncate: true,
      sortable: true,
      render: (row) => row.description,
    },
    {
      key: 'amount',
      header: t('batches.amount'),
      align: 'end',
      sortable: true,
      // SIGNED. Negative is money off the driver; §8 says a negative figure takes
      // a leading minus and the danger hue, never parentheses.
      render: (row) => (
        <span
          className={`font-mono tabular-nums ${row.amountCents < 0 ? 'text-danger' : ''}`}
        >
          {formatCents(row.amountCents, locale)}
        </span>
      ),
      foot: (shown) => money(sumCents(shown, (row) => row.amountCents)),
    },
    {
      key: 'appliesOn',
      header: t('oneTime.appliesOn'),
      sortable: true,
      render: (row) => (
        <span className="font-mono text-xs" dir="ltr">
          {day(row.appliesOn)}
        </span>
      ),
    },
    {
      key: 'load',
      header: t('oneTime.load'),
      render: (row) =>
        row.loadNumber === null ? (
          <span className="text-ink-3">—</span>
        ) : (
          <span className="z-identifier font-mono text-xs" dir="ltr">
            {row.loadNumber}
          </span>
        ),
    },
    {
      key: 'settled',
      header: t('oneTime.settled'),
      sortable: true,
      render: (row) => (
        <StatusBadge
          tone={row.settledAt ? 'success' : 'warning'}
          label={row.settledAt ? t('oneTime.settled') : t('oneTime.pending')}
        />
      ),
    },
  ]

  const scheduledColumns: Column<ChargeRow>[] = [
    {
      key: 'driver',
      header: t('payroll.driver'),
      sortable: true,
      render: (row) => row.driverName,
    },
    {
      key: 'type',
      header: t('charges.type'),
      sortable: true,
      render: (row) => row.type,
    },
    {
      key: 'amount',
      header: t('charges.weekly'),
      align: 'end',
      sortable: true,
      render: (row) => (
        <span className="inline-flex items-baseline gap-z1">
          {money(row.amountCents)}
          {row.monthlyTotalCents !== null ? (
            <span className="font-mono text-xs text-ink-3">
              /{formatCents(row.monthlyTotalCents, locale)}
            </span>
          ) : null}
        </span>
      ),
      foot: (shown) => money(sumCents(shown, (row) => row.amountCents)),
    },
    {
      key: 'target',
      header: t('charges.target'),
      align: 'end',
      sortable: true,
      render: (row) =>
        row.targetCents === null ? (
          <span className="text-ink-3">—</span>
        ) : (
          money(row.targetCents)
        ),
    },
    {
      key: 'from',
      header: t('charges.from'),
      sortable: true,
      render: (row) => (
        <span className="font-mono text-xs" dir="ltr">
          {day(row.effectiveFrom)}
        </span>
      ),
    },
    {
      key: 'to',
      header: t('charges.to'),
      sortable: true,
      render: (row) => (
        <span className="font-mono text-xs" dir="ltr">
          {row.effectiveTo ? day(row.effectiveTo) : '—'}
        </span>
      ),
    },
  ]

  // ── THE TAB STRIP ────────────────────────────────────────────────────────

  const tabHref = (key: string) => {
    const next = new URLSearchParams(search)
    next.set('tab', key)
    // EACH TAB OWNS ITS SORT AND ITS PAGE (§7.1.6). Carrying `sort=amount` into a
    // grid with no amount column would silently fall back to that grid's default
    // while the URL claimed otherwise.
    next.delete('sort')
    next.delete('dir')
    next.delete('page')
    return `${PATH}?${next}`
  }

  const visibleTabs = TABS.filter((key) => key === 'batches' || maySeePay).map(
    (key) => ({
      key,
      label: t(`payroll.tab.${key}` as MessageKey),
    }),
  )

  const header = (
    <>
      <AccountingHeader
        title={t('accounting.payroll.title')}
        stripeMeans={t('accounting.payroll.stripe')}
        action={
          week.batch === null ? (
            mayOpen ? (
              <OpenWeek week={day(chosen.start)} label={t('money.openBatch')} />
            ) : null
          ) : mayWrite ? (
            <BatchActions
              batchId={week.batch.id}
              status={week.batch.status}
              canFinalise={week.blockers.length === 0}
              labels={{
                refresh: t('batch.refresh'),
                finalise: t('batch.finalise'),
                markPaid: t('batch.markPaid'),
              }}
            />
          ) : null
        }
      />
      <Tabs
        tabs={visibleTabs}
        active={tab}
        hrefFor={tabHref}
        label={t('grid.tabs')}
      />
    </>
  )

  // THE WEEK PICKER IS ONLY ON THE TABS THE WEEK MEANS SOMETHING TO. Batches,
  // statements and balances span every week by definition; putting a week control
  // above them would be a control that changes nothing.
  const weekScoped = tab === 'oneTime' || tab === 'scheduled'

  const weekStrip = weekScoped ? (
    <>
      <WeekPicker
        weeks={offered.map((period) => ({
          start: day(period.start),
          end: day(period.end),
          hasBatch: data.opened.includes(period.start.getTime()),
        }))}
        selected={day(chosen.start)}
        label={t('payroll.week')}
        openedLabel={t('payroll.opened')}
      />
      <div className="flex flex-wrap items-baseline gap-z3 border-b border-border bg-surface-2 px-gutter py-z2 text-xs text-ink-2">
        <span className="font-mono" dir="ltr">
          {day(chosen.start)} — {day(chosen.end)}
        </span>
        {week.batch ? (
          <>
            <span className="font-mono text-ink" dir="ltr">
              {week.batch.batchNumber ?? week.batch.status}
            </span>
            <span>
              {t('batch.checkDate')}{' '}
              <span className="font-mono" dir="ltr">
                {day(week.batch.checkDate)}
              </span>
            </span>
          </>
        ) : (
          <span>{t('payroll.noBatch')}</span>
        )}
      </div>
    </>
  ) : null

  // ── ONE GRID, CHOSEN BY THE TAB ──────────────────────────────────────────
  //
  // Each branch is the same six steps — filter, sort, paginate, keep columns,
  // render, paginate control — over a different row type. `gridView` is the
  // arithmetic so that "paginate before filtering" is not reachable from here.

  const blockers =
    week.blockers.length > 0 && weekScoped ? (
      <section className="border-b border-border bg-danger-soft px-gutter py-z3">
        <h2 className="text-sm font-medium text-danger">
          {t('batch.blockers')}
        </h2>
        <ul className="mt-z1 flex flex-wrap gap-x-z5 gap-y-z1 text-xs text-ink">
          {week.blockers.map((row) => (
            <li key={row.driverId}>
              <span className="font-medium">{row.driverName}</span> —{' '}
              {t(row.reason as MessageKey)}
            </li>
          ))}
        </ul>
      </section>
    ) : null

  if (tab === 'batches') {
    const view = gridView(data.batches, raw, batchShape, applyList)
    const columns = keepColumns(batchColumns, data.columns)
    return (
      <>
        {header}
        <FilterBar
          groups={[]}
          search={{
            param: 'q',
            label: t('accounting.search'),
            placeholder: t('batches.batch'),
          }}
          range={{
            label: t('batch.checkDate'),
            fromLabel: t('accounting.from'),
            toLabel: t('accounting.to'),
          }}
          clearLabel={t('filter.clear')}
          moreLabel={t('filter.more')}
        />
        <div className="flex items-center justify-end gap-z2 border-b border-border bg-surface px-gutter py-z2">
          <GridToolbar
            grid="payroll.batches"
            columns={batchColumns.map((column) => ({
              key: column.key,
              header: column.header,
            }))}
            visible={data.columns}
            search={search}
            labels={toolbarLabels}
            errors={errors}
          />
        </div>
        <Table
          columns={columns}
          rows={view.paged.rows}
          footRows={view.filtered}
          rowKey={(row) => row.id}
          rowHref={(row) => `/settlements/batches/${row.id}`}
          stripeTone={(row) => statusOf(row.status).tone}
          caption={t('payroll.tab.batches')}
          sort={{
            key: view.sort.key,
            dir: view.sort.dir,
            hrefFor: view.sortFor(PATH),
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
              title={t('batches.empty')}
              body={t('accounting.emptyHint')}
            />
          }
          below={
            <>
              {/* THE PER-COMPANY BREAKDOWN, under the grid rather than inside it.
               * §6.2 asks for it as an indented continuation of each batch row;
               * `Table` renders one row per record and cannot nest, so this is the
               * honest version — a second reading of the same page's batches, in the
               * same order, with each authority's share. Flagged as a divergence from
               * the ruling rather than presented as satisfying it. */}
              {view.paged.rows.some((row) => row.breakdown.length > 0) ? (
                <section className="border-t border-border bg-surface-2 px-gutter py-z3">
                  <h2 className="text-xs font-medium uppercase tracking-[0.04em] text-ink-2">
                    {t('batches.breakdown')}
                  </h2>
                  <ul className="mt-z2 flex flex-col gap-z1">
                    {view.paged.rows.map((row) =>
                      row.breakdown.length === 0 ? null : (
                        <li
                          key={row.id}
                          className="flex flex-wrap items-baseline gap-z3"
                        >
                          <span
                            className="font-mono text-xs text-ink"
                            dir="ltr"
                          >
                            {row.batchNumber ?? row.id.slice(0, 8)}
                          </span>
                          {row.breakdown.map((company) => (
                            <span
                              key={company.companyId}
                              className="text-xs text-ink-2"
                            >
                              {company.companyName}{' '}
                              <span className="font-mono tabular-nums text-ink">
                                {formatCents(company.amountCents, locale)}
                              </span>{' '}
                              <span className="font-mono tabular-nums text-ink-3">
                                ({company.statements})
                              </span>
                            </span>
                          ))}
                        </li>
                      ),
                    )}
                  </ul>
                </section>
              ) : null}
            </>
          }
        />
        <GridFooterNav
          paged={view.paged}
          per={view.params.per}
          path={PATH}
          search={search}
          hrefForPage={view.hrefForPage(PATH)}
          labels={footerLabels}
        />
      </>
    )
  }

  if (tab === 'statements') {
    const view = gridView(data.statements, raw, statementShape, applyList)
    const columns = keepColumns(statementColumns, data.columns)
    return (
      <>
        {header}
        <FilterBar
          groups={[]}
          search={{
            param: 'q',
            label: t('accounting.search'),
            placeholder: t('accounting.payroll.searchHint'),
          }}
          range={{
            label: t('batches.period'),
            fromLabel: t('accounting.from'),
            toLabel: t('accounting.to'),
          }}
          clearLabel={t('filter.clear')}
          moreLabel={t('filter.more')}
        />
        <div className="flex items-center justify-end gap-z2 border-b border-border bg-surface px-gutter py-z2">
          <GridToolbar
            grid="payroll.statements"
            columns={statementColumns.map((column) => ({
              key: column.key,
              header: column.header,
            }))}
            visible={data.columns}
            search={search}
            labels={toolbarLabels}
            errors={errors}
          />
        </div>
        <Table
          columns={columns}
          rows={view.paged.rows}
          footRows={view.filtered}
          rowKey={(row) => row.id}
          rowHref={(row) => `/settlements/${row.id}`}
          stripeTone={(row) => statusOf(row.status).tone}
          isCancelled={(row) => row.status === 'VOID'}
          caption={t('payroll.tab.statements')}
          sort={{
            key: view.sort.key,
            dir: view.sort.dir,
            hrefFor: view.sortFor(PATH),
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
              title={t('statements.empty')}
              body={t('accounting.emptyHint')}
            />
          }
        />
        <GridFooterNav
          paged={view.paged}
          per={view.params.per}
          path={PATH}
          search={search}
          hrefForPage={view.hrefForPage(PATH)}
          labels={footerLabels}
        />
      </>
    )
  }

  if (tab === 'balances') {
    const view = gridView(data.balances, raw, balanceShape, applyList)
    const columns = keepColumns(balanceColumns, data.columns)
    return (
      <>
        {header}
        <FilterBar
          groups={[]}
          search={{
            param: 'q',
            label: t('accounting.search'),
            placeholder: t('payroll.driver'),
          }}
          clearLabel={t('filter.clear')}
          moreLabel={t('filter.more')}
        />
        <div className="flex items-center justify-between gap-z2 border-b border-border bg-surface px-gutter py-z2">
          {/* THE YEAR, because YTD is per calendar year and nothing else on this
           * grid says which one. A range would be wrong here: a YTD figure over
           * an arbitrary window is not a YTD figure. */}
          <span className="text-xs text-ink-2">
            {t('balances.year')}{' '}
            <span className="font-mono text-ink" dir="ltr">
              {year}
            </span>
          </span>
          <GridToolbar
            grid="payroll.balances"
            columns={balanceColumns.map((column) => ({
              key: column.key,
              header: column.header,
            }))}
            visible={data.columns}
            search={search}
            labels={toolbarLabels}
            errors={errors}
          />
        </div>
        <Table
          columns={columns}
          rows={view.paged.rows}
          footRows={view.filtered}
          rowKey={(row) => row.driverId}
          rowHref={(row) => `/drivers/${row.driverId}`}
          caption={t('payroll.tab.balances')}
          sort={{
            key: view.sort.key,
            dir: view.sort.dir,
            hrefFor: view.sortFor(PATH),
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
              title={t('balances.empty')}
              body={t('balances.emptyHint')}
            />
          }
        />
        <GridFooterNav
          paged={view.paged}
          per={view.params.per}
          path={PATH}
          search={search}
          hrefForPage={view.hrefForPage(PATH)}
          labels={footerLabels}
        />
      </>
    )
  }

  if (tab === 'oneTime') {
    const view = gridView(data.oneTime, raw, oneTimeShape, applyList)
    const columns = keepColumns(oneTimeColumns, data.columns)
    return (
      <>
        {header}
        {weekStrip}
        {blockers}
        <FilterBar
          groups={[]}
          search={{
            param: 'q',
            label: t('accounting.search'),
            placeholder: t('accounting.charges.searchHint'),
          }}
          clearLabel={t('filter.clear')}
          moreLabel={t('filter.more')}
        />
        <div className="flex items-center justify-end gap-z2 border-b border-border bg-surface px-gutter py-z2">
          <GridToolbar
            grid="payroll.oneTime"
            columns={oneTimeColumns.map((column) => ({
              key: column.key,
              header: column.header,
            }))}
            visible={data.columns}
            search={search}
            labels={toolbarLabels}
            errors={errors}
          />
        </div>
        <Table
          columns={columns}
          rows={view.paged.rows}
          footRows={view.filtered}
          rowKey={(row) => row.id}
          rowHref={(row) => `/drivers/${row.driverId}`}
          stripeTone={(row) => (row.settledAt ? 'success' : 'warning')}
          caption={t('payroll.tab.oneTime')}
          sort={{
            key: view.sort.key,
            dir: view.sort.dir,
            hrefFor: view.sortFor(PATH),
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
              title={t('oneTime.empty')}
              body={t('oneTime.emptyHint')}
            />
          }
        />
        <GridFooterNav
          paged={view.paged}
          per={view.params.per}
          path={PATH}
          search={search}
          hrefForPage={view.hrefForPage(PATH)}
          labels={footerLabels}
        />
      </>
    )
  }

  const view = gridView(data.scheduled, raw, scheduledShape, applyList)
  const columns = keepColumns(scheduledColumns, data.columns)
  return (
    <>
      {header}
      {weekStrip}
      {blockers}
      <FilterBar
        groups={[]}
        search={{
          param: 'q',
          label: t('accounting.search'),
          placeholder: t('accounting.charges.searchHint'),
        }}
        clearLabel={t('filter.clear')}
        moreLabel={t('filter.more')}
      />
      <div className="flex items-center justify-between gap-z2 border-b border-border bg-surface px-gutter py-z2">
        {/* SAID OUT LOUD, because it is the difference between this tab and the
         * Charges page: these are the rules that touch the week above, not every
         * rule in the organization. */}
        <p className="text-xs text-ink-3">
          {t('accounting.charges.title')} — {day(chosen.start)} →{' '}
          {day(chosen.end)}
        </p>
        <GridToolbar
          grid="payroll.scheduled"
          columns={scheduledColumns.map((column) => ({
            key: column.key,
            header: column.header,
          }))}
          visible={data.columns}
          search={search}
          labels={toolbarLabels}
          errors={errors}
        >
          <Link href="/accounting/charges">
            <span className="text-xs text-accent underline">
              {t('accounting.charges.title')}
            </span>
          </Link>
        </GridToolbar>
      </div>
      <Table
        columns={columns}
        rows={view.paged.rows}
        footRows={view.filtered}
        rowKey={(row) => row.id}
        rowHref={(row) => `/drivers/${row.driverId}`}
        stripeTone={(row) => (row.inForceToday ? 'success' : 'muted')}
        caption={t('payroll.tab.scheduled')}
        sort={{
          key: view.sort.key,
          dir: view.sort.dir,
          hrefFor: view.sortFor(PATH),
          label: t('accounting.sortBy'),
        }}
        totals={{
          label: pagedFooterLabel(
            t('accounting.weeklyTotal'),
            t('grid.rows'),
            view.paged,
          ),
        }}
        empty={
          <EmptyState
            title={t('accounting.charges.empty')}
            body={t('accounting.charges.emptyHint')}
          />
        }
      />
      <GridFooterNav
        paged={view.paged}
        per={view.params.per}
        path={PATH}
        search={search}
        hrefForPage={view.hrefForPage(PATH)}
        labels={footerLabels}
      />
    </>
  )
}

// ── THE COLUMN KEYS, FOR THE PREFERENCE READ ────────────────────────────────
//
// Declared as data rather than derived from the `Column` arrays, because those
// are built inside the component with a translator and the preference has to be
// read in the same transaction as the rows. The two are checked against each
// other in `tests/accounting-surface.test.ts`, so a column added to one and not
// the other fails rather than quietly becoming unhideable.
const COLUMN_KEYS: Record<Tab, readonly string[]> = {
  batches: [
    'batchNumber',
    'status',
    'created',
    'checkDate',
    'period',
    'statements',
    'amount',
    'payCompany',
    'notes',
  ],
  statements: [
    'driver',
    'period',
    'unit',
    'gross',
    'deductions',
    'net',
    'status',
  ],
  balances: [
    'driver',
    'weeks',
    'opening',
    'gross',
    'deductions',
    'ytd',
    'escrow',
  ],
  oneTime: [
    'driver',
    'type',
    'description',
    'amount',
    'appliesOn',
    'load',
    'settled',
  ],
  scheduled: ['driver', 'type', 'amount', 'target', 'from', 'to'],
}
