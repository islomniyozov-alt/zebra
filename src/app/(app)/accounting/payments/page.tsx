import Link from 'next/link'
import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyIdScopeFilter, companyScopeFilter } from '@/lib/tenancy'
import { listPayments, type PaymentRow } from '@/lib/payments'
import { formatCents } from '@/lib/money'
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
import { EmptyState } from '@/components/ui/EmptyState'
import { FilterBar } from '@/components/ui/FilterBar'
import { Button } from '@/components/ui/Button'
import { CompanyChips } from '../CompanyChips'
import { AccountingHeader } from '../AccountingHeader'
import type { MessageKey } from '@/lib/i18n'

// ACCOUNTING → PAYMENTS (§6.2): what came in, and what it paid for.
//
// THE STRIPE MEANS UNAPPLIED, which is the only thing on this screen that asks
// somebody to do something. A fully applied payment is finished work and takes
// the neutral bar; a payment with money still on it is a question waiting for an
// answer. Carried over unchanged from `/payments`, and now SAID IN THE HEADER as
// §2 has always required.
//
// IMPORT IS A BUTTON HERE, not a fifth destination in the sidebar. It is how the
// Amazon remittance workbooks arrive, which is most of the rows on this screen —
// but it is an action on this list rather than a question of its own, and §6.2's
// table is about questions.

export default async function AccountingPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>
}) {
  if (!(await currentUserCan('read', 'payment'))) notFound()

  const raw = await searchParams
  const params = readListParams(raw)
  const { t, locale } = await getLocaleContext()
  const mayRecord = await currentUserCan('create', 'payment')

  const data = await withCurrentOrg('read', 'payment', async (tx, session) => {
    const scope = companyScopeFilter(session.companyScopes)
    const [payments, companies] = await Promise.all([
      listPayments(tx, scope),
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
    ])
    return { payments, companies }
  })

  const shape: ListShape<PaymentRow> = {
    // The reference is the field people are holding when they come to this
    // screen — a check number off a stub, an Amazon payment id off a workbook.
    searchText: (row) =>
      `${row.referenceNumber ?? ''} ${row.customerName} ${row.companyName}`,
    // §7.4.1 — RECEIVED is the date bounded, and the bar says so. A payment has
    // only one date, which is why this is the easy one; Invoices has three.
    dateOf: (row) => row.receivedAt,
    companyIdOf: (row) => row.companyId,
    sorts: {
      received: (row) => row.receivedAt.getTime(),
      method: (row) => row.method,
      reference: (row) => row.referenceNumber,
      payer: (row) => row.customerName,
      authority: (row) => row.companyName,
      amount: (row) => row.amountCents,
      unapplied: (row) => row.unappliedCents,
    },
    defaultSort: 'received',
    defaultDir: 'desc',
  }

  // UNAPPLIED IS A CHIP, because "what still needs applying" is the question
  // this screen exists to answer and a sort does not answer it — a sort puts the
  // zeroes at the other end of a list somebody still has to scroll.
  const only = typeof raw.state === 'string' ? raw.state : null
  const narrowed =
    only === 'unapplied'
      ? data.payments.filter((row) => row.unappliedCents > 0)
      : only === 'applied'
        ? data.payments.filter((row) => row.unappliedCents === 0)
        : data.payments

  const rows = applyList(narrowed, params, shape)
  const current = activeSort(params, shape)

  const money = (cents: number) => (
    <span className="font-mono tabular-nums">{formatCents(cents, locale)}</span>
  )

  const columns: Column<PaymentRow>[] = [
    {
      key: 'received',
      header: t('payments.received'),
      sortable: true,
      render: (row) => (
        <span className="font-mono">
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
      render: (row) =>
        // §8 — empty and zero are different facts, and here they are the same
        // fact rendered differently on purpose: a zero is the finished state and
        // should read as a number, not as an absence.
        money(row.unappliedCents),
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

  return (
    <>
      <AccountingHeader
        title={t('accounting.payments.title')}
        stripeMeans={t('accounting.payments.stripe')}
        action={
          mayRecord ? (
            <div className="flex items-center gap-z2">
              {/* Link wrapping Button — the house pattern; `Button` takes no
               * `asChild`. */}
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

      <FilterBar
        groups={[
          {
            param: 'state',
            label: t('accounting.payments.state'),
            choices: [
              {
                value: 'unapplied',
                label: t('accounting.payments.unappliedOnly'),
                count: data.payments.filter((row) => row.unappliedCents > 0)
                  .length,
              },
              {
                value: 'applied',
                label: t('accounting.payments.appliedOnly'),
                count: data.payments.filter((row) => row.unappliedCents === 0)
                  .length,
              },
            ],
          },
        ]}
        search={{
          param: 'q',
          label: t('accounting.search'),
          placeholder: t('accounting.payments.searchHint'),
        }}
        range={{
          label: t('payments.received'),
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
        rowHref={(row) => `/payments/${row.id}`}
        stripeTone={(row) => (row.unappliedCents > 0 ? 'warning' : 'neutral')}
        caption={t('accounting.payments.title')}
        sort={{
          key: current.key,
          dir: current.dir,
          hrefFor: (key) => sortHref('/accounting/payments', raw, key, current),
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
            title={t('accounting.payments.empty')}
            body={t('accounting.emptyHint')}
          />
        }
      />
    </>
  )
}
