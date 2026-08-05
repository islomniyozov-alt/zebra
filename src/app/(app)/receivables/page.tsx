import Link from 'next/link'
import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyScopeFilter } from '@/lib/tenancy'
import { AGING_BUCKETS, directAging, factoredInvoices } from '@/lib/factoring'
import { formatCents } from '@/lib/money'
import { Table, type Column } from '@/components/ui/Table'
import { KpiCard } from '@/components/ui/KpiCard'
import { EmptyState } from '@/components/ui/EmptyState'
import type { AgingRow, FactoredRow } from '@/lib/factoring'
import type { MessageKey } from '@/lib/i18n'
import type { StatusTone } from '@/lib/status'

// §5 step 4 — receivables, which is TWO questions with two different debtors:
//
//   "Who owes us, and for how long"      -> direct aging, factored excluded
//   "What has the factor not paid yet"   -> reserve outstanding
//
// One screen because a person asking either one is standing in the same place;
// two sections because adding them together produces a number that answers
// neither and reads as if it answered both.

const BUCKET_TONE: Record<string, StatusTone> = {
  current: 'neutral',
  d31_60: 'progress',
  d61_90: 'warning',
  d90_plus: 'danger',
}

export default async function ReceivablesPage() {
  if (!(await currentUserCan('read', 'receivable'))) notFound()

  const { t, locale } = await getLocaleContext()
  const maySetUp = await currentUserCan('update', 'receivable')

  const data = await withCurrentOrg(
    'read',
    'receivable',
    async (tx, session) => {
      const scope = companyScopeFilter(session.companyScopes)
      const [aging, factored] = await Promise.all([
        directAging(tx, scope),
        factoredInvoices(tx, scope),
      ])
      return { aging, factored }
    },
  )

  const day = (value: Date | null) =>
    value ? value.toISOString().slice(0, 10) : '—'

  // Released reserves are money the factor has already paid; keeping them in
  // "outstanding" would make the figure grow forever and mean nothing.
  const reserveOutstanding = data.factored
    .filter((row) => row.reserveReleasedAt === null)
    .reduce((sum, row) => sum + row.reserveCents, 0)

  const agingColumns: Column<AgingRow>[] = [
    {
      key: 'invoice',
      header: t('invoices.number'),
      render: (row) => (
        <Link
          href={`/invoices/${row.id}`}
          className="font-mono font-medium text-ink hover:text-accent"
        >
          {row.invoiceNumber}
        </Link>
      ),
    },
    {
      key: 'customer',
      header: t('invoices.customer'),
      truncate: true,
      render: (row) => row.customerName,
    },
    {
      key: 'due',
      header: t('invoices.due'),
      render: (row) => day(row.dueDate),
    },
    {
      key: 'age',
      header: t('receivables.daysPastDue'),
      render: (row) =>
        row.daysPastDue > 0 ? (
          // The bucket is the label, not a colour alone: a stripe carries the
          // same fact and one of the two has to survive being printed.
          <span className="tabular-nums">
            {row.daysPastDue} ·{' '}
            {t(`receivables.aging.${row.bucket}` as MessageKey)}
          </span>
        ) : (
          <span className="text-ink-3">{t('receivables.notDue')}</span>
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
  ]

  const factoredColumns: Column<FactoredRow>[] = [
    {
      key: 'invoice',
      header: t('invoices.number'),
      render: (row) => (
        <Link
          href={`/invoices/${row.id}`}
          className="font-mono font-medium text-ink hover:text-accent"
        >
          {row.invoiceNumber}
        </Link>
      ),
    },
    {
      key: 'customer',
      header: t('invoices.customer'),
      truncate: true,
      render: (row) => row.customerName,
    },
    {
      key: 'factor',
      header: t('receivables.factor'),
      truncate: true,
      render: (row) => row.factorName,
    },
    {
      key: 'soldOn',
      header: t('receivables.factoredOn'),
      render: (row) => day(row.factoredAt),
    },
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
      key: 'advance',
      header: t('receivables.advance'),
      align: 'end',
      render: (row) => (
        <span className="font-mono tabular-nums">
          {formatCents(row.advanceCents, locale)}
        </span>
      ),
    },
    {
      key: 'fee',
      header: t('receivables.fee'),
      align: 'end',
      render: (row) => (
        <span className="font-mono tabular-nums">
          {formatCents(row.feeCents, locale)}
        </span>
      ),
    },
    {
      key: 'reserve',
      header: t('receivables.reserve'),
      align: 'end',
      render: (row) =>
        row.reserveReleasedAt ? (
          <span className="font-mono tabular-nums text-ink-3">
            {t('receivables.reserveReleased')}
          </span>
        ) : (
          <span className="font-mono tabular-nums">
            {formatCents(row.reserveCents, locale)}
          </span>
        ),
    },
  ]

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="text-lg font-medium text-ink">
          {t('receivables.title')}
        </h1>
        {maySetUp ? (
          <Link
            href="/receivables/factoring"
            className="text-sm text-accent hover:underline"
          >
            {t('factoring.setup')}
          </Link>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2">
        <section className="border-b border-border px-gutter py-z4">
          <h2 className="text-md font-medium text-ink">
            {t('receivables.direct')}
          </h2>
          <p className="mt-z1 max-w-[68ch] text-sm text-ink-3">
            {t('receivables.directHint')}
          </p>

          <div className="mt-z3 grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-z3">
            {AGING_BUCKETS.map((bucket) => (
              <KpiCard
                key={bucket}
                label={t(`receivables.aging.${bucket}` as MessageKey)}
                value={formatCents(data.aging.totals[bucket], locale)}
              />
            ))}
            <KpiCard
              label={t('receivables.aging.total')}
              value={formatCents(data.aging.totalCents, locale)}
            />
          </div>
        </section>

        <div className="border-b border-border bg-surface">
          <Table
            caption={t('receivables.direct')}
            columns={agingColumns}
            rows={data.aging.rows}
            rowKey={(row) => row.id}
            stripeTone={(row) => BUCKET_TONE[row.bucket] ?? 'neutral'}
            empty={
              <EmptyState
                title={t('receivables.empty.title')}
                body={t('receivables.empty.body')}
              />
            }
          />
        </div>

        <section className="px-gutter py-z4">
          <div className="flex flex-wrap items-baseline justify-between gap-z3">
            <div>
              <h2 className="text-md font-medium text-ink">
                {t('receivables.factored')}
              </h2>
              <p className="mt-z1 max-w-[68ch] text-sm text-ink-3">
                {t('receivables.factoredHint')}
              </p>
            </div>
            <div className="text-end">
              <span className="text-xs font-medium uppercase tracking-[0.06em] text-ink-2">
                {t('receivables.reserveOutstanding')}
              </span>
              <p className="font-mono text-xl font-semibold text-ink">
                {formatCents(reserveOutstanding, locale)}
              </p>
            </div>
          </div>
        </section>

        <div className="bg-surface">
          <Table
            caption={t('receivables.factored')}
            columns={factoredColumns}
            rows={data.factored}
            rowKey={(row) => row.id}
            empty={
              <EmptyState
                title={t('receivables.factored')}
                body={t('receivables.factoredEmpty')}
              />
            }
          />
        </div>
      </div>
    </>
  )
}
