import Link from 'next/link'
import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyIdScopeFilter, companyScopeFilter } from '@/lib/tenancy'
import { formatCents } from '@/lib/money'
import { readGridColumns } from '@/lib/grid-columns'
import { applyList, sumCents, type RawParams } from '@/lib/list-view'
import { paymentShape, readPayments } from '@/lib/accounting-grids'
import type { PaymentRow } from '@/lib/payments'
import { Table, type Column } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { FilterBar } from '@/components/ui/FilterBar'
import { Tabs } from '@/components/ui/Tabs'
import { Button } from '@/components/ui/Button'
import { CompanyChips } from '../../_grid/CompanyChips'
import { PeriodPicker } from '../../_charts/PeriodPicker'
import { SummaryStrip } from '../../_grid/SummaryStrip'
import { paymentStrip } from '@/lib/accounting-reports'
import { narrowCompanyScope } from '@/lib/tenancy'
import { ALL_DATES, windowed } from '../../_grid/window-params'
import {
  DEFAULT_PERIOD,
  isPeriodKey,
  periodWindow,
  type PeriodKey,
} from '@/lib/rolling-period'
import { PageHeader } from '../../_grid/PageHeader'
import { GridToolbar } from '../../_grid/GridToolbar'
import { GridFooterNav } from '../../_grid/GridFooterNav'
import { gridView, keepColumns, pagedFooterLabel } from '../../_grid/grid-page'
import type { MessageKey } from '@/lib/i18n'

// ACCOUNTING → PAYMENTS (§6.2, §7.1.6): two tabs over one grid.
//
//   Payments   what came in, and what it paid for
//   Unapplied  money sitting on an account with nothing to show for it
//
// ── "UNAPPLIED" IS A TAB HERE AND A CHIP EVERYWHERE ELSE ──────────────────
//
// §7.1.6's test says a tab that could be written as a filter on the tab beside it
// IS a filter. This one could — and it stays a tab because it is the question the
// screen exists to answer on a Tuesday, and the count in the tab strip is the
// answer at a glance. The chip remains on the first tab, so the filter bar is not
// lying about what is possible; both set the same parameter through the same
// predicate and cannot disagree.
//
// THE STRIPE MEANS UNAPPLIED, which is the only thing here that asks somebody to
// do something. A fully applied payment is finished work.

const TABS = ['payments', 'unapplied'] as const
type Tab = (typeof TABS)[number]

const COLUMN_KEYS: readonly string[] = [
  'received',
  'method',
  'reference',
  'payer',
  'authority',
  'amount',
  'unapplied',
  'appliedTo',
]

const PATH = '/accounting/payments'

export default async function AccountingPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>
}) {
  if (!(await currentUserCan('read', 'payment'))) notFound()

  const raw = await searchParams
  const { t, locale } = await getLocaleContext()
  const mayRecord = await currentUserCan('create', 'payment')

  // ONE WINDOW CONTROL, THE SHARED ONE (§6.2.8). The picker replaces the
  // from/to range, as on Invoices and Reports.
  // `?period=all` — no date filter, the state a balance figure links to.
  const allDates = raw.period === ALL_DATES
  const period: PeriodKey =
    typeof raw.period === 'string' && isPeriodKey(raw.period)
      ? raw.period
      : DEFAULT_PERIOD
  const window = allDates ? null : periodWindow(period, new Date())
  const companyParam = typeof raw.company === 'string' ? raw.company : null

  const wanted = typeof raw.tab === 'string' ? raw.tab : null
  const tab: Tab = (TABS as readonly string[]).includes(wanted ?? '')
    ? (wanted as Tab)
    : 'payments'

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

  const data = await withCurrentOrg('read', 'payment', async (tx, session) => {
    const scope = companyScopeFilter(session.companyScopes)
    const [payments, companies, columns, strip] = await Promise.all([
      readPayments(tx, scope),
      tx.company.findMany({
        where: {
          isActive: true,
          ...companyIdScopeFilter(session.companyScopes),
        },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
      readGridColumns(tx, session.userId, 'payments.payments', COLUMN_KEYS),
      // COUNTED AND SUMMED IN SQL (§6.2.8). The unapplied tab's count was a
      // `.length` over `listPayments`, which takes 300 rows.
      paymentStrip(
        tx,
        narrowCompanyScope(session.companyScopes, companyParam),
        window,
      ),
    ])
    return { payments, companies, columns, strip }
  })

  // FROM SQL, over the window. See the reader above.
  const unappliedCount = data.strip.unappliedCount

  const state =
    tab === 'unapplied'
      ? 'unapplied'
      : typeof raw.state === 'string'
        ? raw.state
        : null
  const narrowed =
    state === 'unapplied'
      ? data.payments.filter((row) => row.unappliedCents > 0)
      : state === 'applied'
        ? data.payments.filter((row) => row.unappliedCents === 0)
        : data.payments

  // THE PICKER FILTERS THE LIST, by received date. See the note on Invoices.
  const view = gridView(
    narrowed,
    windowed(raw, window),
    paymentShape,
    applyList,
  )

  const money = (cents: number) => (
    <span className="font-mono tabular-nums">{formatCents(cents, locale)}</span>
  )
  const errors = {
    'grid.columns.errorEmpty': t('grid.columns.errorEmpty'),
    'grid.columns.errorGrid': t('grid.columns.errorGrid'),
  }

  const allColumns: Column<PaymentRow>[] = [
    {
      key: 'received',
      header: t('payments.received'),
      sortable: true,
      render: (row) => (
        <span className="font-mono" dir="ltr">
          {row.receivedAt.toISOString().slice(0, 10)}
        </span>
      ),
    },
    {
      key: 'method',
      header: t('payments.method'),
      sortable: true,
      render: (row) => t(`payments.method.${row.method}` as MessageKey),
    },
    {
      key: 'reference',
      header: t('payments.reference'),
      sortable: true,
      render: (row) => (
        // Never truncated: a check number is a field people copy. `dir="ltr"`
        // per §12 — a reference is read back into somebody else's system.
        <span className="z-identifier font-mono text-xs" dir="ltr">
          {row.referenceNumber ?? '—'}
        </span>
      ),
    },
    {
      key: 'payer',
      header: t('payments.payer'),
      truncate: true,
      sortable: true,
      render: (row) => row.customerName,
    },
    {
      key: 'authority',
      header: t('accounting.company'),
      truncate: true,
      sortable: true,
      render: (row) => row.companyName,
    },
    {
      key: 'amount',
      header: t('payments.amount'),
      align: 'end',
      sortable: true,
      render: (row) => money(row.amountCents),
      foot: (shown) => money(sumCents(shown, (row) => row.amountCents)),
    },
    {
      key: 'unapplied',
      header: t('payments.unapplied'),
      align: 'end',
      sortable: true,
      render: (row) => money(row.unappliedCents),
      foot: (shown) => money(sumCents(shown, (row) => row.unappliedCents)),
    },
    {
      key: 'appliedTo',
      header: t('payments.appliedTo'),
      align: 'end',
      sortable: true,
      render: (row) => (
        <span className="font-mono tabular-nums">{row.appliedToCount}</span>
      ),
    },
  ]

  /**
   * Where the unapplied figure sends the reader. §6.2.8.
   *
   * CARRIES THE WINDOW AND THE AUTHORITY, so the figure and the list it opens
   * are the same number, and clears the filters that would narrow the rows
   * without changing the figure above them.
   */
  const stripHref = (
    state: string | null,
    kind: 'balance' | 'flow' = 'balance',
  ) => {
    const next = new URLSearchParams(search)
    for (const key of ['q', 'page', 'sort', 'dir']) next.delete(key)
    next.set('tab', 'payments')
    // A BALANCE OPENS AN UNFILTERED LIST (owner's ruling 2026-10-04): the figure
    // has no date bound, so neither may the rows it is the sum of.
    if (kind === 'balance') next.set('period', ALL_DATES)
    if (state === null) next.delete('state')
    else next.set('state', state)
    return `${PATH}?${next}`
  }

  const tabHref = (key: string) => {
    const next = new URLSearchParams(search)
    next.set('tab', key)
    next.delete('sort')
    next.delete('dir')
    next.delete('page')
    // The tab owns the state, so a chip set on the other tab does not follow it
    // across and quietly narrow a grid that already narrowed itself.
    next.delete('state')
    return `${PATH}?${next}`
  }

  return (
    <>
      <PageHeader
        title={t('accounting.payments.title')}
        breadcrumb={[t('nav.group.accounting'), t('accounting.payments.title')]}
        action={
          mayRecord ? (
            <div className="flex items-center gap-z2">
              <Link href="/payments/import">
                <Button variant="secondary" size="compact">
                  {t('accounting.import')}
                </Button>
              </Link>
              <Link href="/payments/new">
                <Button variant="primary" size="compact">
                  {t('payments.record')}
                </Button>
              </Link>
            </div>
          ) : null
        }
      />
      <Tabs
        tabs={[
          { key: 'payments', label: t('payments.tab.payments') },
          {
            key: 'unapplied',
            label: t('payments.tab.unapplied'),
            count: unappliedCount,
          },
        ]}
        active={tab}
        hrefFor={tabHref}
        label={t('grid.tabs')}
      />
      <SummaryStrip
        locale={locale}
        scopeLabels={{
          balance: t('strip.asOfToday'),
          window: t('strip.inWindow'),
          all: t('strip.allDates'),
        }}
        figures={[
          // A BALANCE: every unapplied dollar, whenever it arrived.
          {
            key: 'unapplied',
            label: t('strip.unapplied'),
            cents: data.strip.unappliedCents,
            // THE COUNT BESIDE THE MONEY: "$14,200 unapplied" is the fact,
            // "across 3 payments" is what says how long it takes to clear.
            note: `${String(data.strip.unappliedCount)} ${t('strip.payments')}`,
            scope: 'balance',
            href: stripHref('unapplied'),
          },
          // AND THE FLOW: what arrived inside the picker's window.
          {
            key: 'received',
            label: t('strip.received'),
            cents: data.strip.receivedCents,
            note: `${String(data.strip.receivedCount)} ${t('strip.payments')}`,
            scope: allDates ? 'all' : 'window',
            href: stripHref(null, 'flow'),
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
        groups={
          tab === 'unapplied'
            ? []
            : [
                {
                  param: 'state',
                  label: t('accounting.payments.state'),
                  choices: [
                    {
                      value: 'unapplied',
                      label: t('accounting.payments.unappliedOnly'),
                      count: unappliedCount,
                    },
                    {
                      value: 'applied',
                      label: t('accounting.payments.appliedOnly'),
                      count: data.strip.appliedCount,
                    },
                  ],
                },
              ]
        }
        search={{
          param: 'q',
          label: t('accounting.search'),
          placeholder: t('accounting.payments.searchHint'),
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
          grid="payments.payments"
          columns={allColumns.map((column) => ({
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
          errors={errors}
        />
      </div>
      <Table
        columns={keepColumns(allColumns, data.columns)}
        rows={view.paged.rows}
        footRows={view.filtered}
        rowKey={(row) => row.id}
        rowHref={(row) => `/payments/${row.id}`}
        stripeTone={(row) => (row.unappliedCents > 0 ? 'warning' : 'neutral')}
        caption={t('accounting.payments.title')}
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
            title={t('accounting.payments.empty')}
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
