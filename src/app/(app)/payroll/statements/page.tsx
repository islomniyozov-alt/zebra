import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyScopeFilter } from '@/lib/tenancy'
import { formatCents } from '@/lib/money'
import { readGridColumns } from '@/lib/grid-columns'
import {
  applyList,
  columnFilterParam,
  sumCents,
  type RawParams,
} from '@/lib/list-view'
import {
  readStatements,
  statementShape,
  type StatementGridRow,
} from '@/lib/accounting-grids'
import { Table, type Column } from '@/components/ui/Table'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EmptyState } from '@/components/ui/EmptyState'
import { FilterBar } from '@/components/ui/FilterBar'
import { Tabs } from '@/components/ui/Tabs'
import { PageHeader } from '../../_grid/PageHeader'
import { GridToolbar } from '../../_grid/GridToolbar'
import { ColumnFunnel } from '../../_grid/ColumnFunnel'
import { BulkPostPaid } from './BulkPostPaid'
import { GridFooterNav } from '../../_grid/GridFooterNav'
import { gridView, keepColumns, pagedFooterLabel } from '../../_grid/grid-page'
import type { MessageKey } from '@/lib/i18n'
import type { StatusTone } from '@/lib/status'

// PAYROLL → STATEMENTS (§6.2, split 2026-09-28): what one driver was paid for
// one week.
//
// ── WHY THIS IS A DESTINATION AND NOT A TAB UNDER BATCHES ─────────────────
//
// It was a tab, and it earns its own entry because it is the document a driver
// is HANDED — the thing people arrive looking for, usually with a name and a
// week in mind rather than a batch. A batch is a run; a statement is a piece of
// paper somebody is holding on the phone.
//
// ONE TAB, DELIBERATELY. §7.1.6 says a page is tabs over one grid; this page has
// one question and therefore one tab, and the strip renders so the section looks
// the same everywhere rather than having one destination that is shaped
// differently for no reason the reader can see.
//
// THE STRIPE MEANS THE RUN'S STATE, or the settlement's own where it belongs to
// no run — `Settlement.batchId` is nullable, and the rows that predate batching
// are exactly the ones a status column would otherwise render blank.

const STATUS: Record<string, { tone: StatusTone; label: MessageKey }> = {
  DRAFT: { tone: 'neutral', label: 'batchStatus.DRAFT' },
  FINAL: { tone: 'progress', label: 'batchStatus.FINAL' },
  PAID: { tone: 'success', label: 'batchStatus.PAID' },
  APPROVED: { tone: 'progress', label: 'batchStatus.APPROVED' },
  VOID: { tone: 'muted', label: 'batchStatus.VOID' },
}

const statusOf = (value: string) =>
  STATUS[value] ?? { tone: 'neutral' as StatusTone, label: null }

// ONE TAB, DECLARED THE SAME WAY THE OTHERS DECLARE THEIRS. The strip renders
// so the section looks the same everywhere, and the literal is here so
// `tests/accounting-surface.test.ts` can check this page against §6.2's table
// like the other five — a page whose tab list is inline is a page that table
// cannot see.
const TABS = ['statements'] as const

const COLUMN_KEYS: readonly string[] = [
  'driver',
  'period',
  'unit',
  'gross',
  'deductions',
  'net',
  'batch',
  'status',
]

/** Offered on bulk Mark paid. The value is stored; the label is translated. */
const PAY_METHODS = ['ACH', 'CHECK', 'WIRE', 'ZELLE', 'CASH'] as const

/** Every refusal these two paths can produce, so the client can say which. */
const BULK_REASON_KEYS = [
  'settlements.error.notFound',
  'settlements.error.notDraft',
  'settlements.error.notApproved',
  'settlements.error.alreadyPaid',
  'settlements.error.negativeNet',
  'settlements.error.noReference',
] as const

const PATH = '/payroll/statements'

export default async function StatementsPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>
}) {
  // `driver.pay`, NOT `settlement`. One statement is one person's money, and a
  // role that may read a run's total does not thereby read every driver's.
  if (!(await currentUserCan('read', 'driver.pay'))) notFound()
  // POSTING IS ITS OWN PERMISSION. Signing off on what a person is paid is a
  // different act from preparing it — permissions.ts decides, this only asks.
  const mayApprove = await currentUserCan('approve', 'settlement')

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

  const data = await withCurrentOrg(
    'read',
    'driver.pay',
    async (tx, session) => {
      const scope = companyScopeFilter(session.companyScopes)
      const [statements, columns] = await Promise.all([
        readStatements(tx, scope),
        readGridColumns(tx, session.userId, 'payroll.statements', COLUMN_KEYS),
      ])
      return { statements, columns }
    },
  )

  const view = gridView(data.statements, raw, statementShape, applyList)

  const day = (value: Date) => value.toISOString().slice(0, 10)
  const money = (cents: number) => (
    <span className="font-mono tabular-nums">{formatCents(cents, locale)}</span>
  )

  // ONE CLIENT ISLAND PER HEADER, so `Table` stays server-rendered and only
  // the popover is interactive.
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

  const bulkReasons = Object.fromEntries(
    BULK_REASON_KEYS.map((key) => [key, t(key)]),
  )

  const columns: Column<StatementGridRow>[] = [
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
      key: 'batch',
      header: t('batches.batch'),
      sortable: true,
      // §6.2.6 — the filter narrows on the NUMBER a reader knows the run by.
      // An id in a filter chip is something nobody can type or recognise.
      filterable: true,
      render: (row) =>
        row.batchNumber === null ? (
          <span className="text-ink-3">—</span>
        ) : (
          <span className="z-identifier font-mono text-xs" dir="ltr">
            {row.batchNumber}
          </span>
        ),
    },
    {
      key: 'status',
      header: t('payroll.status'),
      sortable: true,
      filterable: true,
      render: (row) => {
        const state = statusOf(row.status)
        return (
          <div className="flex items-baseline gap-z2">
            <StatusBadge
              tone={state.tone}
              label={state.label ? t(state.label) : row.status}
            />
            {/* A STATEMENT WITH NO RUN, said in words. These predate batching
             * and are the reason `batchId` is nullable. */}
            {row.batchId === null ? (
              <span className="text-xs text-ink-3">
                {t('statements.noBatch')}
              </span>
            ) : null}
          </div>
        )
      },
    },
  ]

  return (
    <>
      <PageHeader
        title={t('payroll.tab.statements')}
        breadcrumb={[t('nav.group.payroll'), t('payroll.tab.statements')]}
      />
      <Tabs
        tabs={[
          {
            key: TABS[0],
            label: t('payroll.tab.statements'),
            count: data.statements.length,
          },
        ]}
        active={TABS[0]}
        hrefFor={() => PATH}
        label={t('grid.tabs')}
      />
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
      <BulkPostPaid
        methods={PAY_METHODS.map((method) => ({
          value: method,
          label: t(`payments.method.${method}` as MessageKey),
        }))}
        labels={{
          selected: t('grid.selected'),
          post: t('workbench.post'),
          markPaid: t('settlements.markPaid'),
          method: t('settlements.paymentMethod'),
          reference: t('settlements.paymentReference'),
          done: t('statements.bulkDone'),
        }}
        reasons={bulkReasons}
      >
        <Table
          columns={keepColumns(columns, data.columns)}
          rows={view.paged.rows}
          footRows={view.filtered}
          rowKey={(row) => row.id}
          rowHref={(row) => `/settlements/${row.id}`}
          funnelFor={funnelFor}
          {...(mayApprove
            ? { selection: { name: 'statement', label: t('grid.select') } }
            : {})}
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
      </BulkPostPaid>
      <GridFooterNav
        paged={view.paged}
        per={view.params.per}
        path={PATH}
        search={search}
        hrefForPage={view.hrefForPage(PATH)}
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
