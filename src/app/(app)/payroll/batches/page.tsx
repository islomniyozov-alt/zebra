import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { formatCents } from '@/lib/money'
import { companyScopeFilter } from '@/lib/tenancy'
import { payWeekFor } from '@/lib/settlement-week'
import { recentWeeks, weekBatch, weekFromParam } from '@/lib/payroll'
import { readGridColumns, type GridId } from '@/lib/grid-columns'
import { BATCH_COLUMN_KEYS, BATCH_COLUMNS_HIDDEN } from '@/lib/list-columns'
import {
  applyList,
  columnFilterParam,
  sumCents,
  type RawParams,
} from '@/lib/list-view'
import {
  balanceShape,
  batchShape,
  readBalances,
  readBatches,
  type BalanceGridRow,
  type BatchGridRow,
} from '@/lib/accounting-grids'
import { Table, type Column } from '@/components/ui/Table'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EmptyState } from '@/components/ui/EmptyState'
import { FilterBar } from '@/components/ui/FilterBar'
import { Tabs } from '@/components/ui/Tabs'
import { GridFooterNav } from '../../_grid/GridFooterNav'
import { PageHeader } from '../../_grid/PageHeader'
import { SummaryStrip } from '../../_grid/SummaryStrip'
import { PeriodPicker } from '../../_charts/PeriodPicker'
import { ALL_DATES, windowed } from '../../_grid/window-params'
import {
  DEFAULT_PERIOD,
  isPeriodKey,
  periodWindow,
  type PeriodKey,
} from '@/lib/rolling-period'
import { pipelineStrip } from '@/lib/accounting-reports'
import { ColumnFunnel } from '../../_grid/ColumnFunnel'
import { BulkStatus } from './BulkStatus'
import { GridToolbar } from '../../_grid/GridToolbar'
import { gridView, keepColumns, pagedFooterLabel } from '../../_grid/grid-page'
import Link from 'next/link'
import { Suspense } from 'react'
import { Button } from '@/components/ui/Button'
import { WeekPicker } from './WeekPicker'
import { WeekStrip } from './WeekStrip'
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

// TWO TABS: both are a run's totals (§6.2). Driver statements and the two
// charge grids became their own destinations under Payroll.
const TABS = ['batches', 'balances'] as const
type Tab = (typeof TABS)[number]

const GRID_FOR: Record<Tab, GridId> = {
  batches: 'payroll.batches',
  balances: 'payroll.balances',
}

// ── THE COLUMN KEYS, FOR THE PREFERENCE READ ────────────────────────────────
//
// Declared as data rather than derived from the `Column` arrays, because those
// are built inside the component with a translator and the preference has to be
// read in the same transaction as the rows. `tests/accounting-surface.test.ts`
// checks the two against each other, so a column added to one and not the other
// fails rather than quietly becoming unhideable.
const COLUMN_KEYS: Record<Tab, readonly string[]> = {
  // ELEVEN, SO PAST §7.1's NINE — the list and what starts hidden both live in
  // `src/lib/list-columns.ts` (§7.1.7), where one test counts every grid that
  // runs past the cap. This page rendered a 500 from the moment §6.2.9 added
  // gross, deductions and net to it.
  batches: BATCH_COLUMN_KEYS,
  balances: [
    'driver',
    'weeks',
    'opening',
    'gross',
    'deductions',
    'ytd',
    'escrow',
  ],
}

/** §7.1.7. Only the tab that is over the cap names any. */
const HIDDEN_BY_DEFAULT: Record<Tab, readonly string[]> = {
  batches: BATCH_COLUMNS_HIDDEN,
  balances: [],
}

const WEEKS_OFFERED = 12
const PATH = '/payroll/batches'

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
      // THE CHEAP HALF ONLY. `payrollWeek` ran the engine over every driver
      // to find the blockers — 8,493ms and nine statements against 408ms for
      // the grid — so the page waited nine seconds to render four rows. The
      // blockers stream in behind it, through `<WeekStrip>`.
      const week = await weekBatch(tx, {
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

      // ONLY THE TAB'S OWN ROWS. Reading both would be a query nobody asked
      // for on every page load, and the batches grid walks every settlement's
      // load lines to build the per-authority breakdown.
      const batches = tab === 'batches' ? await readBatches(tx, scope) : []
      // ── THE PIPELINE, AS OF TODAY (§6.2.9) ───────────────────────────
      //
      // One statement, three states. NOT windowed: "how much pay is sitting in
      // draft" is not a question about a period (§6.2.8's balance rule), and the
      // one with a deadline is FINAL — approved and unpaid.
      //
      // ONLY ON THE BATCHES TAB, like the grid above it: Balances is a year's
      // totals and a pipeline figure there would answer a question that tab is
      // not asking.
      const pipeline =
        tab === 'batches'
          ? await pipelineStrip(tx, session.companyScopes)
          : null
      const balances =
        tab === 'balances' ? await readBalances(tx, scope, year) : []

      const columns = await readGridColumns(
        tx,
        session.userId,
        GRID_FOR[tab],
        COLUMN_KEYS[tab],
        HIDDEN_BY_DEFAULT[tab],
      )

      return {
        week,
        opened: opened.map((row) => row.periodStart.getTime()),
        batches,
        balances,
        pipeline,
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
  // ONE CLIENT ISLAND PER HEADER, rather than a client boundary around the
  // grid: `Table` stays server-rendered and only the popover is interactive.
  const funnelFor = (columnKey: string, header: string) => (
    <ColumnFunnel
      param={columnFilterParam(columnKey)}
      column={header}
      labels={{
        open: t('grid.filterColumn'),
        apply: t('grid.filterApply'),
        clear: t('grid.filterClear'),
      }}
    />
  )

  const bulkLabels = {
    selected: t('grid.selected'),
    finalise: t('batches.finaliseSelected'),
    markPaid: t('batches.markPaidSelected'),
    clear: t('grid.clearSelection'),
    blocked: t('batches.bulkBlocked'),
    done: t('batches.bulkDone'),
  }
  const bulkReasons = {
    'batch.error.notFound': t('batch.error.notFound'),
    'batch.error.notDraft': t('batch.error.notDraft'),
    'batch.error.notAWeek': t('batch.error.notAWeek'),
    'batch.blockers': t('batch.blockers'),
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
      filterable: true,
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
      filterable: true,
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
    // ── GROSS, DEDUCTIONS, NET — AND NOT AN EQUATION (§6.2.9) ──────────
    //
    // net = gross − deductions + reimbursements + other pay, so these three do
    // NOT subtract to each other. Gross sits first and Net last with Deductions
    // between them, in the order a statement reads, rather than gross and net
    // adjacent inviting the subtraction.
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
      key: 'amount',
      header: t('batches.amount'),
      align: 'end',
      sortable: true,
      render: (row) => money(row.amountCents),
      foot: (shown) => money(sumCents(shown, (row) => row.amountCents)),
    },
    {
      key: 'payCompany',
      filterable: true,
      header: t('batches.payCompany'),
      sortable: true,
      // "ALL AUTHORITIES", because that is what a Zebra batch pays out of
      // (Islom, 2026-09-11) — and the names are on the breakdown rows under the
      // grid. Datatruck needs a real company here only because a batch there
      // belongs to one payer. Owner's ruling, 2026-09-28: no migration.
      render: (row) =>
        row.payCompanyName ?? (
          <span className="text-ink-2">{t('batches.allAuthorities')}</span>
        ),
    },
    {
      key: 'notes',
      filterable: true,
      header: t('batches.notes'),
      truncate: true,
      render: (row) => row.notes ?? <span className="text-ink-3">—</span>,
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

  // ── THE TAB STRIP ────────────────────────────────────────────────────────

  /**
   * Where a pipeline figure sends the reader: the batches grid, filtered to that
   * status, with NO date filter.
   *
   * `?period=all` for the same reason as §6.2.8's balances — the figure counts
   * every run in that state, so the list it opens must not be windowed, or the
   * number above the rows is not the sum of the rows.
   */
  const pipelineHref = (status: string) => {
    const next = new URLSearchParams(search)
    for (const key of ['q', 'page', 'sort', 'dir', 'from', 'to']) {
      next.delete(key)
    }
    next.set('tab', 'batches')
    next.set('period', ALL_DATES)
    next.set('f.status', status)
    return `${PATH}?${next}`
  }

  // ── ONE WINDOW CONTROL, THE SHARED ONE (§6.2.9) ──────────────────────
  //
  // The picker replaces the from/to range, as on Invoices and Payments. It
  // filters by the date each list already sorts on — `dateOf` in the shape —
  // so the window means what the list already meant by a date.
  //
  // `?period=all` IS NO DATE FILTER, which is what a balance figure links to.
  const allDates = raw.period === ALL_DATES
  const period: PeriodKey =
    typeof raw.period === 'string' && isPeriodKey(raw.period)
      ? raw.period
      : DEFAULT_PERIOD
  const listWindow = allDates ? null : periodWindow(period, new Date())

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
      <PageHeader
        title={t('accounting.payroll.title')}
        breadcrumb={[t('nav.group.payroll'), t('payroll.tab.batches')]}
        action={
          week === null ? (
            mayOpen ? (
              // THE PREVIEW, NOT A BARE CREATE. `OpenWeek` opened the selected
              // week with one click and no sight of what was about to go in;
              // the flow at /new shows the trips and, more usefully, what is
              // being left out and why. The one-click button is gone rather
              // than kept beside it — two ways to open a batch is two ways to
              // open the wrong one.
              <Link
                href={`/payroll/batches/new?from=${day(chosen.start)}&to=${day(chosen.end)}`}
              >
                <Button variant="primary" size="compact">
                  {t('money.openBatch')}
                </Button>
              </Link>
            ) : null
          ) : mayWrite ? (
            <BatchActions
              batchId={week.id}
              status={week.status}
              // ── FINALISE IS OFFERED AND THE SERVER DECIDES ──────────
              //
              // It was gated on a blocker count this page no longer computes,
              // and computing one here would put the 8.5 seconds back. The
              // button is enabled; `finaliseBatch` refreshes the draft and
              // refuses by name if anything blocks, which it did anyway — the
              // gate here was never the real one, and its own comment said so:
              // "the action re-checks the blockers server-side regardless".
              canFinalise
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

  // THE WEEK PICKER IS ON THE BATCHES TAB, because that is where a run is
  // opened, refreshed and finalised — and the Tuesday strip below it is about
  // the same week. BALANCES IS A YEAR, not a week, so it gets neither: a week
  // control above a year's totals is a control that changes nothing.

  const weekStrip =
    tab === 'batches' ? (
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
          {week ? (
            <>
              <span className="font-mono text-ink" dir="ltr">
                {week.batchNumber ?? week.status}
              </span>
              <span>
                {t('batch.checkDate')}{' '}
                <span className="font-mono" dir="ltr">
                  {day(week.checkDate)}
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

  // BLOCKERS SIT WITH THE BATCHES TAB, beside the week they block. On Balances
  // — a year's totals — a list of "who cannot be paid this week" would be an
  // alarm about a period the grid is not showing.
  // ── THE STRIP, BEHIND ITS OWN BOUNDARY ────────────────────────────────
  //
  // Only on the Batches tab, and only for the selected week (owner's ruling).
  // Balances is a YEAR, so a week's blockers above it would be an alarm about a
  // period the grid is not showing.
  //
  // THE FALLBACK IS EMPTY, NOT A SKELETON. §14 rejects skeleton loaders on a
  // table that returns quickly, and the same argument holds here: this is one
  // strip that is usually absent entirely, so a placeholder would flash a
  // problem that most weeks do not have.
  const blockers =
    tab === 'batches' ? (
      <Suspense fallback={null}>
        <WeekStrip
          period={chosen}
          batchId={week?.id ?? null}
          batchStatus={week?.status ?? null}
        />
      </Suspense>
    ) : null

  if (tab === 'batches') {
    const view = gridView(
      data.batches,
      windowed(raw, listWindow),
      batchShape,
      applyList,
    )
    const columns = keepColumns(batchColumns, data.columns)
    return (
      <>
        {header}
        {/* ── THE TUESDAY STRIP, BACK AT THE TOP (owner's ruling, 2026-09-28) ──
         *
         * The week picker, the period with its two dates, and the blockers by
         * name. This is where a run is opened, refreshed and finalised, so it
         * is where "which week, and who cannot be paid in it" belongs — and a
         * blocked driver has no settlement row, so the grid below cannot carry
         * them. */}
        {data.pipeline === null ? null : (
          <SummaryStrip
            locale={locale}
            scopeLabels={{
              balance: t('strip.asOfToday'),
              window: t('strip.inWindow'),
              all: t('strip.allDates'),
            }}
            figures={[
              {
                key: 'draft',
                label: t('batchStatus.DRAFT'),
                cents: data.pipeline.draftCents,
                note: `${String(data.pipeline.draftCount)} ${t('strip.runs')}`,
                scope: 'balance',
                href: pipelineHref('DRAFT'),
              },
              {
                key: 'final',
                label: t('batchStatus.FINAL'),
                cents: data.pipeline.finalCents,
                note: `${String(data.pipeline.finalCount)} ${t('strip.runs')}`,
                // APPROVED AND UNPAID — the figure with a deadline, so it is the
                // one drawn in the danger tone. §3.3's hues mean something, and
                // "money owed this week" is what this one means.
                alarming: data.pipeline.finalCents > 0,
                scope: 'balance',
                href: pipelineHref('FINAL'),
              },
              {
                key: 'paid',
                label: t('batchStatus.PAID'),
                cents: data.pipeline.paidCents,
                note: `${String(data.pipeline.paidCount)} ${t('strip.runs')}`,
                scope: 'balance',
                href: pipelineHref('PAID'),
              },
            ]}
          />
        )}
        <div className="flex flex-wrap items-center justify-end gap-z3 border-b border-border bg-surface px-gutter py-z2">
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
        {weekStrip}
        {blockers}
        <FilterBar
          groups={[]}
          search={{
            param: 'q',
            label: t('accounting.search'),
            placeholder: t('batches.batch'),
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
        <BulkStatus labels={bulkLabels} reasons={bulkReasons}>
          <Table
            columns={columns}
            rows={view.paged.rows}
            footRows={view.filtered}
            rowKey={(row) => row.id}
            rowHref={(row) => `/settlements/batches/${row.id}`}
            funnelFor={funnelFor}
            selection={{ name: 'batch', label: t('grid.select') }}
            // §6.2 — AN INDENTED CONTINUATION OF ITS PARENT ROW. It was
            // rendered after the table, which put it under the FOOT: four
            // batches and ten authority rows became two lists to match up by
            // number. A reader comparing shares of one week needs them
            // adjacent (rule 1).
            rowDetail={(row) =>
              row.breakdown.length === 0 ? null : (
                <span className="flex flex-wrap items-baseline gap-x-z4 gap-y-z1">
                  <span className="uppercase tracking-[0.04em] text-ink-3">
                    {t('batches.breakdown')}
                  </span>
                  {row.breakdown.map((company) => (
                    <span key={company.companyId}>
                      {company.companyName}{' '}
                      <span className="font-mono tabular-nums text-ink">
                        {formatCents(company.amountCents, locale)}
                      </span>{' '}
                      <span className="font-mono tabular-nums text-ink-3">
                        ({company.statements})
                      </span>
                    </span>
                  ))}
                </span>
              )
            }
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
          />
        </BulkStatus>
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

  // ── BALANCES IS THE OTHER TAB, AND THE TAIL ─────────────────────────────
  //
  // `batches` returns above, so `tab` is narrowed to this one here. Written as
  // a third guarded branch the function would have no final return, and the
  // two-tab shape would be stated twice — once in TABS and once in a chain of
  // ifs that has to agree with it.

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
