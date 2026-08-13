import Link from 'next/link'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { brokerTone } from '@/lib/brokers'
import { Table, type Column } from '@/components/ui/Table'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import { orDash } from '../_reference/shared'
import { brokerStatusKey } from './fields'
import type { CustomerStatus } from '@/generated/prisma/client'

// No authority column here, ever: a broker belongs to the organization, not to
// an operating authority. §6.3's company column rule is about company-scoped
// rows, and this table has none.
//
// The stripe means "can you book freight for them right now" (§2, one meaning
// per screen, stated in the header).

interface Row {
  id: string
  name: string
  mcNumber: string | null
  city: string | null
  state: string | null
  phone: string | null
  terms: number
  status: CustomerStatus
  blockedReason: string | null
  isRetired: boolean
}

export default async function BrokersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const { t } = await getLocaleContext()
  const showRetired = params['removed'] === '1'

  const rows = await withCurrentOrg('read', 'customer', async (tx) => {
    const brokers = await tx.customer.findMany({
      where: showRetired ? {} : { deletedAt: null },
      orderBy: { name: 'asc' },
      take: 200,
      select: {
        id: true,
        name: true,
        mcNumber: true,
        city: true,
        state: true,
        phone: true,
        paymentTermsDays: true,
        status: true,
        blockedReason: true,
        deletedAt: true,
        // NOT selected: creditLimitCents. It is money, and this screen is
        // reachable by a DISPATCHER, who holds no money resource at all.
      },
    })

    return brokers.map(
      (broker): Row => ({
        id: broker.id,
        name: broker.name,
        mcNumber: broker.mcNumber,
        city: broker.city,
        state: broker.state,
        phone: broker.phone,
        terms: broker.paymentTermsDays,
        status: broker.status,
        blockedReason: broker.blockedReason,
        isRetired: broker.deletedAt !== null,
      }),
    )
  })

  const mayCreate = await currentUserCan('create', 'customer')

  const columns: Column<Row>[] = [
    {
      key: 'name',
      header: t('brokers.name'),
      truncate: true,
      // NO ANCHOR HERE ANY MORE. `Table` wraps the first cell in the row's
      // stretched link, and an anchor inside an anchor is invalid HTML that
      // browsers resolve by silently closing the outer one — which would make
      // the rest of the row unclickable again, the exact bug being fixed.
      render: (row) => row.name,
    },
    {
      key: 'mc',
      header: t('brokers.mc'),
      render: (row) => (
        <span className="font-mono">{orDash(row.mcNumber)}</span>
      ),
    },
    {
      key: 'where',
      header: t('brokers.city'),
      truncate: true,
      render: (row) => orDash([row.city, row.state].filter(Boolean).join(', ')),
    },
    {
      key: 'phone',
      header: t('brokers.phone'),
      render: (row) =>
        row.phone ? (
          // §7.1: "interactive controls inside the row raise z-index as dead
          // zones". Without this the stretched link sits over the number and
          // tapping a broker's phone on a tablet opens their detail page.
          <a
            href={`tel:${row.phone}`}
            className="relative z-10 font-mono hover:text-accent"
          >
            {row.phone}
          </a>
        ) : (
          '—'
        ),
    },
    {
      key: 'terms',
      header: t('brokers.terms'),
      align: 'end',
      render: (row) => <span className="font-mono">{row.terms}</span>,
    },
    {
      key: 'status',
      header: t('ref.status'),
      render: (row) =>
        row.isRetired ? (
          <span className="text-ink-3">{t('ref.retired')}</span>
        ) : (
          <div className="flex items-center gap-z2">
            <StatusBadge
              tone={brokerTone(row.status)}
              label={t(brokerStatusKey(row.status))}
            />
            {/* A block with no visible reason is a block a dispatcher
             * overrides. BIG M II is why this is on the row, not the detail. */}
            {row.blockedReason ? (
              <span className="truncate text-xs text-ink-3">
                {row.blockedReason}
              </span>
            ) : null}
          </div>
        ),
    },
  ]

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="text-lg font-medium text-ink">{t('brokers.title')}</h1>
        <div className="flex items-center gap-z3">
          <p className="text-xs text-ink-3">{t('brokers.stripeMeaning')}</p>
          {mayCreate ? (
            <Link href="/brokers/new">
              <Button variant="primary" size="compact">
                {t('brokers.add')}
              </Button>
            </Link>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-z3 border-b border-border bg-surface-2 px-gutter py-z2">
        <Link
          href={showRetired ? '/brokers' : '/brokers?removed=1'}
          className="text-sm font-medium text-ink-2 hover:text-accent"
        >
          {showRetired ? t('ref.hideRetired') : t('ref.showRetired')}
        </Link>
      </div>

      <Table
        caption={t('brokers.title')}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        rowHref={(row) => `/brokers/${row.id}`}
        stripeTone={(row) => brokerTone(row.status)}
        isCancelled={(row) => row.isRetired}
        empty={
          <EmptyState
            title={t('brokers.empty.title')}
            body={t('brokers.empty.body')}
            action={
              mayCreate ? (
                <Link href="/brokers/new">
                  <Button variant="primary">{t('brokers.add')}</Button>
                </Link>
              ) : null
            }
          />
        }
      />
    </>
  )
}
