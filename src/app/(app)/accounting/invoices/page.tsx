import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyIdScopeFilter, companyScopeFilter } from '@/lib/tenancy'
import { formatCents } from '@/lib/money'
import { agingBucketFor, type AgingBucket } from '@/lib/factoring'
import { directSettledAwaiting, readyToInvoice } from '@/lib/invoices'
import {
  applyList,
  activeSort,
  readListParams,
  sortHref,
  sumCents,
  totalsLabel,
  type ListShape,
  type RawParams,
} from '@/lib/list-view'
import { Table, type Column } from '@/components/ui/Table'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EmptyState } from '@/components/ui/EmptyState'
import { FilterBar } from '@/components/ui/FilterBar'
import Link from 'next/link'
import { ReadyQueue, type ReadyRow } from '../../invoices/ReadyQueue'
import { CompanyChips } from '../CompanyChips'
import { AccountingHeader } from '../AccountingHeader'
import type { InvoiceStatus } from '@/generated/prisma/client'
import type { MessageKey } from '@/lib/i18n'
import type { StatusTone } from '@/lib/status'

// ACCOUNTING → INVOICES (§6.2, amended 2026-09-28): who owes us, and how old.
//
// ── RECEIVABLES FOLDED IN HERE ────────────────────────────────────────────
//
// `/receivables` was a second list of the same rows with a different heading.
// Aging is a VIEW of the invoice list — an age chip and a due-date sort — which
// §7.4 already makes shareable as a URL. What it is not is a separate page you
// have to remember exists, which is how "over 90 days" came to be a question
// nobody asked twice.
//
// The factor's reserve did NOT fold in, and is not on this screen: it is money
// owed by the factor rather than by a broker, and adding the two produces a
// figure that answers neither. It keeps its own screen at /receivables/factoring.

const INVOICE_TONE: Record<InvoiceStatus, StatusTone> = {
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

const ERROR_KEYS: MessageKey[] = [
  'invoices.error.noLoads',
  'invoices.error.notReady',
  'invoices.error.mixedCustomers',
  'invoices.error.mixedCompanies',
]

const BUCKETS: readonly AgingBucket[] = [
  'current',
  'd31_60',
  'd61_90',
  'd90_plus',
]

interface Row {
  id: string
  invoiceNumber: string
  customerName: string
  companyId: string
  companyName: string
  issued: Date | null
  due: Date | null
  totalCents: number
  balanceCents: number
  status: InvoiceStatus
  /** Null when nothing is outstanding — a paid invoice has no age. */
  bucket: AgingBucket | null
}

export default async function AccountingInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>
}) {
  if (!(await currentUserCan('read', 'invoice'))) notFound()

  const raw = await searchParams
  const params = readListParams(raw)
  const { t, locale } = await getLocaleContext()
  const mayCreate = await currentUserCan('create', 'invoice')

  const data = await withCurrentOrg('read', 'invoice', async (tx, session) => {
    const scope = companyScopeFilter(session.companyScopes)
    const [invoices, companies, ready, direct] = await Promise.all([
      tx.invoice.findMany({
        where: { deletedAt: null, ...scope },
        orderBy: { createdAt: 'desc' },
        take: 500,
        select: {
          id: true,
          invoiceNumber: true,
          issueDate: true,
          dueDate: true,
          totalCents: true,
          balanceCents: true,
          status: true,
          companyId: true,
          company: { select: { name: true } },
          customer: { select: { name: true } },
        },
      }),
      // `companyIdScopeFilter`, NOT `companyScopeFilter`. The second is
      // `{ companyId: ... }`, which is not a valid `CompanyWhereInput` — see
      // tenancy.ts: it compiles, and 500s for the first person whose membership
      // is scoped to one authority. And Company retires with `isActive`.
      tx.company.findMany({
        where: {
          isActive: true,
          ...companyIdScopeFilter(session.companyScopes),
        },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
      // READY TO INVOICE, and freight that will never be invoiced. Both came
      // with this list from `/invoices` — the create path is not a separate
      // question (§6.2) and a screen that only listed invoices would leave
      // "raise the ones that are ready" with nowhere to happen.
      mayCreate ? readyToInvoice(tx, scope) : Promise.resolve([]),
      directSettledAwaiting(tx, scope),
    ])
    return { invoices, companies, ready, direct }
  })

  const midnight = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  )

  const all: Row[] = data.invoices.map((invoice) => ({
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    customerName: invoice.customer.name,
    companyId: invoice.companyId,
    companyName: invoice.company.name,
    issued: invoice.issueDate,
    due: invoice.dueDate,
    totalCents: invoice.totalCents,
    balanceCents: invoice.balanceCents,
    status: invoice.status,
    // AGE IS A FACT ABOUT AN OUTSTANDING BALANCE. A paid invoice that was
    // settled late is not "90 days past due" — it is closed, and a bucket on it
    // would put it in a chip whose total is money somebody is chasing.
    bucket:
      invoice.balanceCents > 0 && invoice.dueDate !== null
        ? agingBucketFor(
            Math.floor((midnight - invoice.dueDate.getTime()) / 86_400_000),
          )
        : null,
  }))

  const shape: ListShape<Row> = {
    // The number, the broker and the authority — the three things on screen a
    // person would type. Not the status word: that is what the chips are for.
    searchText: (row) =>
      `${row.invoiceNumber} ${row.customerName} ${row.companyName}`,
    // §7.4.1 — ISSUED is the date this range bounds, and the bar says so.
    dateOf: (row) => row.issued,
    companyIdOf: (row) => row.companyId,
    sorts: {
      invoiceNumber: (row) => row.invoiceNumber,
      customer: (row) => row.customerName,
      issued: (row) => row.issued?.getTime() ?? null,
      due: (row) => row.due?.getTime() ?? null,
      total: (row) => row.totalCents,
      balance: (row) => row.balanceCents,
      status: (row) => row.status,
    },
    defaultSort: 'issued',
    defaultDir: 'desc',
  }

  // THE AGE CHIP IS APPLIED BEFORE `applyList`, because it is this screen's own
  // filter rather than one of the four shared ones. Order does not change the
  // set — both are predicates — and doing it here keeps the totals row over
  // exactly what the body renders.
  const age = typeof raw.age === 'string' ? raw.age : null
  const narrowed =
    age !== null && (BUCKETS as readonly string[]).includes(age)
      ? all.filter((row) => row.bucket === age)
      : all

  const rows = applyList(narrowed, params, shape)
  const current = activeSort(params, shape)

  const money = (cents: number) => (
    <span className="font-mono tabular-nums">{formatCents(cents, locale)}</span>
  )
  const day = (value: Date | null) =>
    value ? value.toISOString().slice(0, 10) : '—'

  const columns: Column<Row>[] = [
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
      render: (row) => (
        <StatusBadge
          tone={INVOICE_TONE[row.status]}
          label={t(`invoiceStatus.${row.status}` as MessageKey)}
        />
      ),
    },
  ]

  return (
    <>
      <AccountingHeader
        title={t('accounting.invoices.title')}
        stripeMeans={t('accounting.invoices.stripe')}
      />

      {mayCreate ? (
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
      ) : null}

      {/* DIRECT-SETTLED FREIGHT. Not invoiceable and not in broker AR — but it is
       * money owed, and a screen that omits it teaches everybody that Zebra does
       * not know about Relay work. */}
      {data.direct.length > 0 ? (
        <section className="border-b border-border bg-surface-2 px-gutter py-z3">
          <h2 className="text-sm font-medium text-ink">
            {t('invoices.direct')}
          </h2>
          <p className="mt-z1 text-xs text-ink-3">{t('invoices.directHint')}</p>
          <ul className="mt-z2 flex flex-wrap gap-x-z5 gap-y-z1">
            {data.direct.map((load) => (
              <li key={load.id} className="text-xs">
                <Link
                  href={`/loads/${load.id}`}
                  className="z-identifier font-mono font-medium text-ink hover:text-accent"
                  dir="ltr"
                >
                  {load.loadNumber}
                </Link>{' '}
                <span className="font-mono tabular-nums text-ink-2">
                  {formatCents(load.totalRevenueCents, locale)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <FilterBar
        groups={[
          {
            param: 'age',
            label: t('accounting.age'),
            choices: BUCKETS.map((bucket) => ({
              value: bucket,
              label: t(`aging.${bucket}` as MessageKey),
              // Counted from the same predicate the chip filters by, over every
              // invoice rather than the narrowed set — a chip showing the count
              // it would produce, not the count it currently shows.
              count: all.filter((row) => row.bucket === bucket).length,
            })),
          },
        ]}
        search={{
          param: 'q',
          label: t('accounting.search'),
          placeholder: t('accounting.invoices.searchHint'),
        }}
        range={{
          label: t('invoices.issued'),
          fromLabel: t('accounting.from'),
          toLabel: t('accounting.to'),
        }}
        clearLabel={t('filter.clear')}
        moreLabel={t('filter.more')}
      />

      <CompanyChips
        companies={data.companies}
        label={t('accounting.company')}
        allLabel={t('accounting.allCompanies')}
      />

      <Table
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        rowHref={(row) => `/invoices/${row.id}`}
        stripeTone={(row) => INVOICE_TONE[row.status]}
        isCancelled={(row) => row.status === 'VOID'}
        caption={t('accounting.invoices.title')}
        sort={{
          key: current.key,
          dir: current.dir,
          hrefFor: (key) => sortHref('/accounting/invoices', raw, key, current),
          label: t('accounting.sortBy'),
        }}
        totals={{
          label: totalsLabel(
            t('accounting.total'),
            rows.length,
            t('accounting.rows'),
          ),
        }}
        empty={
          <EmptyState
            title={t('accounting.invoices.empty')}
            body={t('accounting.emptyHint')}
          />
        }
      />
    </>
  )
}
