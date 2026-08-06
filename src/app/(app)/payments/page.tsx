import Link from 'next/link'
import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyScopeFilter } from '@/lib/tenancy'
import { listPayments, type PaymentRow } from '@/lib/payments'
import { formatCents } from '@/lib/money'
import { Table, type Column } from '@/components/ui/Table'
import { KpiCard } from '@/components/ui/KpiCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import type { MessageKey } from '@/lib/i18n'

// §5 step 5 — money that arrived, and what is known about what it paid.
//
// The stripe means UNAPPLIED, which is the only thing on this screen that asks
// somebody to do something. A fully applied payment is finished work and gets
// the neutral bar; a payment with money still on it is a question waiting for
// an answer, and the total at the top is how much of that there is.

export default async function PaymentsPage() {
  if (!(await currentUserCan('read', 'payment'))) notFound()

  const { t, locale } = await getLocaleContext()
  const mayRecord = await currentUserCan('create', 'payment')

  const payments = await withCurrentOrg('read', 'payment', (tx, session) =>
    listPayments(tx, companyScopeFilter(session.companyScopes)),
  )

  const unappliedTotal = payments.reduce(
    (sum, payment) => sum + payment.unappliedCents,
    0,
  )
  const receivedTotal = payments.reduce(
    (sum, payment) => sum + payment.amountCents,
    0,
  )

  const day = (value: Date) => value.toISOString().slice(0, 10)

  const columns: Column<PaymentRow>[] = [
    {
      key: 'received',
      header: t('payments.received'),
      render: (row) => (
        <Link
          href={`/payments/${row.id}`}
          className="font-mono font-medium text-ink hover:text-accent"
        >
          {day(row.receivedAt)}
        </Link>
      ),
    },
    {
      key: 'method',
      header: t('payments.method'),
      render: (row) => t(`payments.method.${row.method}` as MessageKey),
    },
    {
      key: 'reference',
      header: t('payments.reference'),
      render: (row) => (
        // Never truncated: a check number is a field people copy.
        <span className="font-mono text-xs">{row.referenceNumber ?? '—'}</span>
      ),
    },
    {
      key: 'payer',
      header: t('payments.payer'),
      truncate: true,
      render: (row) => row.customerName,
    },
    {
      key: 'authority',
      header: t('payments.authority'),
      truncate: true,
      render: (row) => row.companyName,
    },
    {
      key: 'amount',
      header: t('payments.amount'),
      align: 'end',
      render: (row) => (
        <span className="font-mono tabular-nums">
          {formatCents(row.amountCents, locale)}
        </span>
      ),
    },
    {
      key: 'unapplied',
      header: t('payments.unapplied'),
      align: 'end',
      render: (row) =>
        row.unappliedCents === 0 ? (
          <span className="text-xs text-ink-3">
            {t('payments.fullyApplied')}
          </span>
        ) : (
          <span className="font-mono tabular-nums font-medium text-ink">
            {formatCents(row.unappliedCents, locale)}
          </span>
        ),
    },
  ]

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="text-lg font-medium text-ink">{t('payments.title')}</h1>
        {mayRecord ? (
          <Link href="/payments/new">
            <Button variant="primary" size="compact">
              {t('payments.record')}
            </Button>
          </Link>
        ) : null}
      </div>

      <section className="border-b border-border bg-surface-2 px-gutter py-z4">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-z3">
          <KpiCard
            label={t('payments.amount')}
            value={formatCents(receivedTotal, locale)}
          />
          <KpiCard
            label={t('payments.unapplied')}
            value={formatCents(unappliedTotal, locale)}
          />
        </div>
        <p className="mt-z2 max-w-[68ch] text-sm text-ink-3">
          {t('payments.unappliedHint')}
        </p>
      </section>

      <Table
        caption={t('payments.title')}
        columns={columns}
        rows={payments}
        rowKey={(row) => row.id}
        // One meaning per screen (§2): the stripe is "this one still needs
        // somebody", not the payment method or the age.
        stripeTone={(row) => (row.unappliedCents > 0 ? 'warning' : 'success')}
        empty={
          <EmptyState
            title={t('payments.empty.title')}
            body={t('payments.empty.body')}
            action={
              mayRecord ? (
                <Link href="/payments/new">
                  <Button variant="primary">{t('payments.record')}</Button>
                </Link>
              ) : null
            }
          />
        }
      />
    </>
  )
}
