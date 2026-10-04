import Link from 'next/link'
import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyIdScopeFilter, companyScopeFilter } from '@/lib/tenancy'
import { formatCents } from '@/lib/money'
import {
  directSettledAwaiting,
  readyToInvoice,
  readyToInvoiceWhere,
} from '@/lib/invoices'
import { readGridColumns } from '@/lib/grid-columns'
import {
  applyList,
  columnFilterParam,
  sumCents,
  type RawParams,
} from '@/lib/list-view'
import {
  invoiceShape,
  readInvoices,
  type InvoiceGridRow,
} from '@/lib/accounting-grids'
import { Table, type Column } from '@/components/ui/Table'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EmptyState } from '@/components/ui/EmptyState'
import { FilterBar } from '@/components/ui/FilterBar'
import { Tabs } from '@/components/ui/Tabs'
import { ReadyQueue, type ReadyRow } from '../../invoices/ReadyQueue'
import { CompanyChips } from '../../_grid/CompanyChips'
import { PeriodPicker } from '../../_charts/PeriodPicker'
import { SummaryStrip } from '../../_grid/SummaryStrip'
import { invoiceStrip } from '@/lib/accounting-reports'
import { narrowCompanyScope } from '@/lib/tenancy'
import {
  DEFAULT_PERIOD,
  isPeriodKey,
  periodWindow,
  type PeriodKey,
} from '@/lib/rolling-period'
import { PageHeader } from '../../_grid/PageHeader'
import { GridToolbar } from '../../_grid/GridToolbar'
import { BulkMarkSent } from './BulkMarkSent'
import { ColumnFunnel } from '../../_grid/ColumnFunnel'
import { GridFooterNav } from '../../_grid/GridFooterNav'
import { gridView, keepColumns, pagedFooterLabel } from '../../_grid/grid-page'
import type { InvoiceStatus } from '@/generated/prisma/client'
import type { MessageKey } from '@/lib/i18n'
import type { StatusTone } from '@/lib/status'

// ACCOUNTING → INVOICES (§6.2, §7.1.6): three tabs over one grid.
//
//   Invoices          who owes us, and how old is it
//   Ready to invoice  freight that could be billed and has not been
//   Direct-settled    freight that will never be invoiced, and is still owed
//
// Each is a different question, which is §7.1.6's test. "Ready to invoice" is
// not a filter on the invoice list — those rows are LOADS, and no invoice exists
// for them yet. That is the clearest case of the distinction in the section.
//
// RECEIVABLES FOLDED IN as the age chip on the first tab: aging is a view of the
// invoice list, not a second list of the same rows.

const INVOICE_TONE: Record<string, StatusTone> = {
  DRAFT: 'neutral',
  READY_TO_SEND: 'neutral',
  SENT: 'progress',
  PARTIALLY_PAID: 'progress',
  PAID: 'success',
  OVERDUE: 'danger',
  DISPUTED: 'danger',
  VOID: 'muted',
  WRITTEN_OFF: 'muted',
}

const BUCKETS = ['current', 'd31_60', 'd61_90', 'd90_plus'] as const

const ERROR_KEYS: MessageKey[] = [
  'invoices.error.noLoads',
  'invoices.error.notReady',
  'invoices.error.mixedCustomers',
  'invoices.error.mixedCompanies',
]

const TABS = ['invoices', 'ready', 'factored', 'direct'] as const
type Tab = (typeof TABS)[number]

const COLUMN_KEYS: readonly string[] = [
  'invoiceNumber',
  'customer',
  'authority',
  'issued',
  'due',
  'total',
  'balance',
  'status',
]

/**
 * How an invoice went out.
 *
 * `markInvoiceSent` takes any string; this list exists so the record does not
 * collect four spellings of "email". The VALUE is stored and the label is
 * translated — §7.1.5's rule about codes, applied to a thing that gets read
 * back during a payment chase.
 */
const SEND_CHANNELS = ['email', 'portal', 'edi', 'post'] as const

const PATH = '/accounting/invoices'

export default async function AccountingInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>
}) {
  if (!(await currentUserCan('read', 'invoice'))) notFound()

  const raw = await searchParams
  const { t, locale } = await getLocaleContext()
  const mayCreate = await currentUserCan('create', 'invoice')
  // RECORDING A SEND IS AN UPDATE, not a create — the invoice exists and
  // this writes a fact about it. permissions.ts decides; this only asks.
  const mayUpdate = await currentUserCan('update', 'invoice')

  // ── ONE WINDOW CONTROL, THE SHARED ONE (§6.2.8) ──────────────────────
  //
  // The rolling picker replaces the from/to range here as it did on Reports:
  // v10.16 revoked the two-window arrangement, and a picker beside a range is
  // one screen answering for two periods.
  const period: PeriodKey =
    typeof raw.period === 'string' && isPeriodKey(raw.period)
      ? raw.period
      : DEFAULT_PERIOD
  const now = new Date()
  const window = periodWindow(period, now)
  const companyParam = typeof raw.company === 'string' ? raw.company : null

  const wanted = typeof raw.tab === 'string' ? raw.tab : null
  const requested: Tab = (TABS as readonly string[]).includes(wanted ?? '')
    ? (wanted as Tab)
    : 'invoices'
  // The queue is a create surface, so a role that cannot raise an invoice is not
  // offered it and cannot land on it by following a link.
  const tab: Tab = requested === 'ready' && !mayCreate ? 'invoices' : requested

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

  const data = await withCurrentOrg('read', 'invoice', async (tx, session) => {
    const scope = companyScopeFilter(session.companyScopes)
    const [invoices, companies, ready, direct, readyCount, columns, strip] =
      await Promise.all([
        readInvoices(tx, scope, new Date()),
        tx.company.findMany({
          where: {
            isActive: true,
            ...companyIdScopeFilter(session.companyScopes),
          },
          orderBy: { name: 'asc' },
          select: { id: true, name: true },
        }),
        mayCreate ? readyToInvoice(tx, scope) : Promise.resolve([]),
        directSettledAwaiting(tx, scope),
        // COUNTED, NOT INFERRED FROM THE ROWS. `readyToInvoice` takes 500, so
        // `ready.length` is the CAP once there are more than that — and the tab
        // would read "500" forever while the real number grew. Same predicate,
        // counted in SQL.
        mayCreate
          ? tx.load.count({ where: { ...readyToInvoiceWhere(), ...scope } })
          : Promise.resolve(0),
        readGridColumns(tx, session.userId, 'invoices.invoices', COLUMN_KEYS),
        // ── THE STRIP, AND EVERY COUNT ON IT, IN ONE STATEMENT ───────────
        //
        // Same lesson as readyCount above, applied to the rest of the screen:
        // the Factored tab read `invoices.filter(isFactored).length` over a
        // reader capped at 2000, so it was right only while the number was
        // small enough not to need. The chip counts come from here too.
        invoiceStrip(
          tx,
          narrowCompanyScope(session.companyScopes, companyParam),
          window,
          now,
        ),
      ])
    return { invoices, companies, ready, direct, readyCount, columns, strip }
  })

  const money = (cents: number) => (
    <span className="font-mono tabular-nums">{formatCents(cents, locale)}</span>
  )
  const day = (value: Date | null) =>
    value ? value.toISOString().slice(0, 10) : '—'
  const errors = {
    'grid.columns.errorEmpty': t('grid.columns.errorEmpty'),
    'grid.columns.errorGrid': t('grid.columns.errorGrid'),
  }
  const toolbarLabels = {
    export: t('grid.export'),
    columns: t('grid.columns'),
    apply: t('grid.columns.apply'),
    cancel: t('grid.columns.cancel'),
    firstLocked: t('grid.columns.firstLocked'),
  }
  // ONE CLIENT ISLAND PER HEADER, so `Table` stays server-rendered and only
  // the popover is interactive — the same shape the batches grid uses.
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

  const footerLabels = {
    of: t('grid.of'),
    previous: t('grid.previous'),
    next: t('grid.next'),
    perPage: t('grid.perPage'),
  }

  const tabHref = (key: string) => {
    const next = new URLSearchParams(search)
    next.set('tab', key)
    next.delete('sort')
    next.delete('dir')
    next.delete('page')
    return `${PATH}?${next}`
  }

  /**
   * Where a summary figure sends the reader. §6.2.8.
   *
   * IT CARRIES THE WINDOW AND THE AUTHORITY FORWARD, which is what makes the
   * figure and the list it opens the same number: both are computed over
   * whatever `?period=` and `?company=` say, so a link that dropped them would
   * open a list that disagrees with the figure it came from.
   *
   * AND IT CLEARS THE OTHER FILTERS — the age chip, a status chip, a search, a
   * page — because the figure is a claim about a state and anything left over
   * would narrow the rows below it without changing the number above.
   */
  const listHref = (into: Record<string, string>) => {
    const next = new URLSearchParams(search)
    // `f.`-PREFIXED, because that is what `applyList` reads
    // (`columnFilterParam`). Writing a bare `state=` wrote a parameter nothing
    // consumes, so every figure opened the unfiltered list.
    for (const key of [
      'age',
      'f.status',
      'f.state',
      'q',
      'page',
      'sort',
      'dir',
    ]) {
      next.delete(key)
    }
    next.set('tab', 'invoices')
    for (const [key, value] of Object.entries(into)) next.set(key, value)
    return `${PATH}?${next}`
  }

  const header = (
    <>
      <PageHeader
        title={t('accounting.invoices.title')}
        breadcrumb={[t('nav.group.accounting'), t('accounting.invoices.title')]}
      />
      <Tabs
        tabs={[
          { key: 'invoices', label: t('invoices.tab.invoices') },
          ...(mayCreate
            ? [
                {
                  key: 'ready',
                  label: t('invoices.tab.ready'),
                  count: data.readyCount,
                },
              ]
            : []),
          {
            key: 'factored',
            // COUNTED IN SQL. This was `invoices.filter(...).length` over a
            // reader that takes 2000 rows (§6.2.8).
            label: t('invoices.tab.factored'),
            count: data.strip.factoredCount,
          },
          {
            key: 'direct',
            label: t('invoices.tab.direct'),
            count: data.direct.length,
          },
        ]}
        active={tab}
        hrefFor={tabHref}
        label={t('grid.tabs')}
      />
    </>
  )

  // ── READY TO INVOICE ─────────────────────────────────────────────────────
  if (tab === 'ready') {
    return (
      <>
        {header}
        <ReadyQueue
          rows={data.ready.map(
            (load): ReadyRow => ({
              id: load.id,
              loadNumber: load.loadNumber,
              customerName: load.customerName,
              totalRevenueCents: load.totalRevenueCents,
            }),
          )}
          locale={locale}
          translate={Object.fromEntries(ERROR_KEYS.map((key) => [key, t(key)]))}
          labels={{
            ready: t('invoices.ready'),
            empty: t('invoices.readyEmpty'),
            create: t('invoices.create'),
            createHint: t('invoices.createBatch'),
            selected: t('invoices.selected'),
            customer: t('invoices.customer'),
            total: t('invoices.total'),
          }}
        />
      </>
    )
  }

  // ── DIRECT-SETTLED ───────────────────────────────────────────────────────
  //
  // Not invoiceable and not in broker AR — but it IS money owed, and a screen
  // that omits it teaches everybody that Zebra does not know about Relay work.
  if (tab === 'direct') {
    return (
      <>
        {header}
        <section className="min-h-0 flex-1 overflow-auto bg-surface px-gutter py-z3">
          <p className="text-xs text-ink-3">{t('invoices.directHint')}</p>
          {data.direct.length === 0 ? (
            <EmptyState
              title={t('invoices.direct')}
              body={t('accounting.emptyHint')}
            />
          ) : (
            <ul className="mt-z3 flex flex-col">
              {data.direct.map((load) => (
                <li
                  key={load.id}
                  className="flex items-baseline gap-z3 border-b border-border py-z1 text-sm last:border-b-0"
                >
                  <Link
                    href={`/loads/${load.id}`}
                    className="z-identifier font-mono font-medium text-ink hover:text-accent"
                    dir="ltr"
                  >
                    {load.loadNumber}
                  </Link>
                  <span className="font-mono tabular-nums text-ink-2">
                    {formatCents(load.totalRevenueCents, locale)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </>
    )
  }

  // ── THE INVOICE GRID, AND THE FACTORED TAB IS THE SAME GRID ─────────────
  //
  // §6.2: a factored invoice is SOLD, so it is a different question about the
  // same rows rather than a narrowing of this one — which is why it is a tab.
  // It shares every column, sort and filter; only the population differs.
  //
  // AND IT IS EXCLUDED FROM THE DEFAULT TAB, which is the half that matters.
  // An invoice the factor collects is not our receivable, so leaving it in
  // "Invoices" would put money somebody else already paid us for into the
  // aging chips and the balance total — a figure the office would chase.
  const age = typeof raw.age === 'string' ? raw.age : null
  const population =
    tab === 'factored'
      ? data.invoices.filter((row) => row.isFactored)
      : data.invoices.filter((row) => !row.isFactored)
  const narrowed =
    age !== null && (BUCKETS as readonly string[]).includes(age)
      ? population.filter((row) => row.bucket === age)
      : population

  const view = gridView(narrowed, raw, invoiceShape, applyList)

  const allColumns: Column<InvoiceGridRow>[] = [
    {
      key: 'invoiceNumber',
      header: t('invoices.number'),
      sortable: true,
      render: (row) => (
        <span className="z-identifier font-mono" dir="ltr">
          {row.invoiceNumber}
        </span>
      ),
    },
    {
      key: 'customer',
      header: t('invoices.customer'),
      truncate: true,
      sortable: true,
      render: (row) => row.customerName,
    },
    {
      key: 'authority',
      header: t('accounting.company'),
      truncate: true,
      render: (row) => row.companyName,
    },
    {
      key: 'issued',
      header: t('invoices.issued'),
      sortable: true,
      render: (row) => day(row.issued),
    },
    {
      key: 'due',
      header: t('invoices.due'),
      sortable: true,
      render: (row) => day(row.due),
    },
    {
      key: 'total',
      header: t('invoices.total'),
      align: 'end',
      sortable: true,
      render: (row) => money(row.totalCents),
      foot: (shown) => money(sumCents(shown, (row) => row.totalCents)),
    },
    {
      key: 'balance',
      header: t('invoices.balance'),
      align: 'end',
      sortable: true,
      render: (row) => money(row.balanceCents),
      foot: (shown) => money(sumCents(shown, (row) => row.balanceCents)),
    },
    {
      key: 'status',
      header: t('invoices.status'),
      sortable: true,
      // §6.2 (v10.8). Paired with `invoiceShape.columnFilters.status` — a
      // `filterable` column whose key has no entry there renders a control
      // that narrows nothing, which the grid contract forbids.
      filterable: true,
      render: (row) => (
        <StatusBadge
          tone={INVOICE_TONE[row.status] ?? 'neutral'}
          label={t(
            `invoiceStatus.${row.status as InvoiceStatus}` as MessageKey,
          )}
        />
      ),
    },
  ]

  return (
    <>
      {header}
      <SummaryStrip
        locale={locale}
        windowNote={t('strip.window')}
        windowHref="/accounting/reports"
        windowHrefLabel={t('strip.allTime')}
        figures={[
          {
            key: 'open',
            label: t('strip.open'),
            cents: data.strip.openCents,
            note: t('strip.openNote'),
            // THE LINK CARRIES THE SAME WINDOW AND AUTHORITY the figure was
            // computed over, which is what makes them tie to the cent.
            href: listHref({ 'f.state': 'open' }),
          },
          {
            key: 'overdue',
            label: t('strip.overdue'),
            cents: data.strip.overdueCents,
            note: t('strip.overdueNote'),
            alarming: true,
            href: listHref({ 'f.state': 'overdue' }),
          },
          {
            key: 'factored',
            label: t('strip.factored'),
            cents: data.strip.factoredCents,
            note: t('strip.factoredNote'),
            href: listHref({ 'f.state': 'factored' }),
          },
        ]}
      />
      <div className="flex flex-wrap items-center justify-between gap-z3 border-b border-border bg-surface px-gutter py-z2">
        <CompanyChips
          companies={data.companies}
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
      <FilterBar
        groups={[
          {
            param: 'age',
            label: t('accounting.age'),
            choices: BUCKETS.map((bucket) => ({
              value: bucket,
              label: t(`aging.${bucket}` as MessageKey),
              count: data.invoices.filter((row) => row.bucket === bucket)
                .length,
            })),
          },
        ]}
        search={{
          param: 'q',
          label: t('accounting.search'),
          placeholder: t('accounting.invoices.searchHint'),
        }}
        clearLabel={t('filter.clear')}
        moreLabel={t('filter.more')}
      />
      <div className="flex items-center justify-between gap-z2 border-b border-border bg-surface px-gutter py-z2">
        <CompanyChips
          companies={data.companies}
          label={t('accounting.company')}
          allLabel={t('accounting.allCompanies')}
        />
        <GridToolbar
          grid="invoices.invoices"
          columns={allColumns.map((column) => ({
            key: column.key,
            header: column.header,
          }))}
          visible={data.columns}
          search={search}
          labels={toolbarLabels}
          errors={errors}
        />
      </div>
      <BulkMarkSent
        channels={SEND_CHANNELS.map((channel) => ({
          value: channel,
          label: t(`invoices.channel.${channel}` as MessageKey),
        }))}
        labels={{
          selected: t('grid.selected'),
          markSent: t('invoices.markSentSelected'),
          channel: t('invoices.channel'),
          clear: t('grid.clearSelection'),
          done: t('invoices.bulkSentDone'),
        }}
        reasons={errors}
      >
        <Table
          columns={keepColumns(allColumns, data.columns)}
          rows={view.paged.rows}
          footRows={view.filtered}
          rowKey={(row) => row.id}
          rowHref={(row) => `/invoices/${row.id}`}
          funnelFor={funnelFor}
          {...(mayUpdate
            ? { selection: { name: 'invoice', label: t('grid.select') } }
            : {})}
          stripeTone={(row) => INVOICE_TONE[row.status] ?? 'neutral'}
          isCancelled={(row) => row.status === 'VOID'}
          caption={t('accounting.invoices.title')}
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
              title={t('accounting.invoices.empty')}
              body={t('accounting.emptyHint')}
            />
          }
        />
      </BulkMarkSent>
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
