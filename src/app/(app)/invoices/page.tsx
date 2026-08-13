import Link from 'next/link'
import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyScopeFilter } from '@/lib/tenancy'
import { directSettledAwaiting, readyToInvoice } from '@/lib/invoices'
import { formatCents } from '@/lib/money'
import { Table, type Column } from '@/components/ui/Table'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EmptyState } from '@/components/ui/EmptyState'
import { ReadyQueue, type ReadyRow } from './ReadyQueue'
import type { InvoiceStatus } from '@/generated/prisma/client'
import type { MessageKey } from '@/lib/i18n'
import type { StatusTone } from '@/lib/status'

// §5 step 3 — the invoice screen: what is ready, what exists, and what is
// settled directly and therefore never becomes either.

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

interface Row {
  id: string
  invoiceNumber: string
  customerName: string
  issued: string
  due: string
  totalCents: number
  balanceCents: number
  status: InvoiceStatus
  sent: boolean
}

const ERROR_KEYS: MessageKey[] = [
  'invoices.error.noLoads',
  'invoices.error.notReady',
  'invoices.error.mixedCustomers',
  'invoices.error.mixedCompanies',
]

export default async function InvoicesPage() {
  if (!(await currentUserCan('read', 'invoice'))) notFound()

  const { t, locale } = await getLocaleContext()
  const mayCreate = await currentUserCan('create', 'invoice')

  const data = await withCurrentOrg('read', 'invoice', async (tx, session) => {
    const scope = companyScopeFilter(session.companyScopes)

    const [ready, direct, invoices] = await Promise.all([
      mayCreate ? readyToInvoice(tx, scope) : Promise.resolve([]),
      directSettledAwaiting(tx, scope),
      tx.invoice.findMany({
        where: { deletedAt: null, ...scope },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
          id: true,
          invoiceNumber: true,
          issueDate: true,
          dueDate: true,
          totalCents: true,
          balanceCents: true,
          status: true,
          sentAt: true,
          customer: { select: { name: true } },
        },
      }),
    ])

    return { ready, direct, invoices }
  })

  const day = (value: Date | null) =>
    value ? value.toISOString().slice(0, 10) : '—'

  const rows: Row[] = data.invoices.map((invoice) => ({
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    customerName: invoice.customer.name,
    issued: day(invoice.issueDate),
    due: day(invoice.dueDate),
    totalCents: invoice.totalCents,
    balanceCents: invoice.balanceCents,
    status: invoice.status,
    sent: invoice.sentAt !== null,
  }))

  const columns: Column<Row>[] = [
    {
      key: 'invoiceNumber',
      header: t('invoices.number'),
      // The mono face stays on the value; the anchor around it is `Table`'s.
      render: (row) => <span className="font-mono">{row.invoiceNumber}</span>,
    },
    {
      key: 'customer',
      header: t('invoices.customer'),
      truncate: true,
      render: (row) => row.customerName,
    },
    {
      key: 'issued',
      header: t('invoices.issued'),
      render: (row) => row.issued,
    },
    { key: 'due', header: t('invoices.due'), render: (row) => row.due },
    {
      key: 'total',
      header: t('invoices.total'),
      align: 'end',
      render: (row) => (
        <span className="font-mono tabular-nums">
          {formatCents(row.totalCents, locale)}
        </span>
      ),
    },
    {
      key: 'balance',
      header: t('invoices.balance'),
      align: 'end',
      render: (row) => (
        <span className="font-mono tabular-nums">
          {formatCents(row.balanceCents, locale)}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('invoices.status'),
      render: (row) => (
        <StatusBadge
          tone={INVOICE_TONE[row.status]}
          label={t(`invoiceStatus.${row.status}` as MessageKey)}
        />
      ),
    },
  ]

  const readyRows: ReadyRow[] = data.ready.map((load) => ({
    id: load.id,
    loadNumber: load.loadNumber,
    customerName: load.customerName,
    totalRevenueCents: load.totalRevenueCents,
  }))

  const translate = Object.fromEntries(ERROR_KEYS.map((key) => [key, t(key)]))

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="text-lg font-medium text-ink">{t('invoices.title')}</h1>
      </div>

      {mayCreate ? (
        <ReadyQueue
          rows={readyRows}
          locale={locale}
          translate={translate}
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

      {/* Direct-settled freight. Not invoiceable and not in broker AR — but it
       * is money owed, and a screen that simply omits it teaches everybody
       * that Zebra does not know about Relay work. Step 5 gives it a payment
       * path; this makes it visible in the meantime. */}
      {data.direct.length > 0 ? (
        <section className="border-b border-border bg-surface-2 px-gutter py-z3">
          <h2 className="text-sm font-medium text-ink">
            {t('invoices.direct')}
          </h2>
          <p className="mt-z1 text-xs text-ink-3">{t('invoices.directHint')}</p>
          <ul className="mt-z2 flex flex-col">
            {data.direct.map((load) => (
              <li
                key={load.id}
                className="flex items-baseline gap-z3 border-b border-border py-z1 text-sm last:border-b-0"
              >
                <Link
                  href={`/loads/${load.id}`}
                  className="z-identifier font-mono font-medium text-ink hover:text-accent"
                >
                  {load.loadNumber}
                </Link>
                <span className="truncate text-ink-2">{load.customerName}</span>
                <span className="ms-auto font-mono tabular-nums text-ink">
                  {formatCents(load.totalRevenueCents, locale)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Table
        caption={t('invoices.title')}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        rowHref={(row) => `/invoices/${row.id}`}
        stripeTone={(row) => INVOICE_TONE[row.status]}
        empty={
          <EmptyState
            title={t('invoices.empty.title')}
            body={t('invoices.empty.body')}
          />
        }
      />
    </>
  )
}
