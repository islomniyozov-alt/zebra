import Link from 'next/link'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyScopeFilter } from '@/lib/tenancy'
import { Table, type Column } from '@/components/ui/Table'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import { orDash } from '../_reference/shared'
import { fleetStatusKey } from '../trucks/fields'
import type { StatusTone } from '@/lib/status'
import type { TruckStatus } from '@/generated/prisma/client'

const TRAILER_TONE: Record<TruckStatus, StatusTone> = {
  AVAILABLE: 'neutral',
  DISPATCHED: 'progress',
  IN_TRANSIT: 'progress',
  MAINTENANCE: 'warning',
  OUT_OF_SERVICE: 'danger',
  SOLD: 'muted',
}

interface Row {
  id: string
  unitNumber: string
  companyName: string
  type: string | null
  year: number | null
  plate: string | null
  status: TruckStatus
  isRetired: boolean
}

export default async function TrailersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const { t } = await getLocaleContext()

  const showRetired = params['removed'] === '1'
  const companyParam =
    typeof params['company'] === 'string' ? params['company'] : undefined

  const { rows, companyCount } = await withCurrentOrg(
    'read',
    'trailer',
    async (tx, session) => {
      const companyCount = await tx.company.count()
      const trailers = await tx.trailer.findMany({
        where: {
          ...companyScopeFilter(session.companyScopes),
          ...(companyParam ? { companyId: companyParam } : {}),
          ...(showRetired ? {} : { deletedAt: null }),
        },
        orderBy: [{ company: { name: 'asc' } }, { unitNumber: 'asc' }],
        take: 200,
        select: {
          id: true,
          unitNumber: true,
          type: true,
          year: true,
          plate: true,
          status: true,
          deletedAt: true,
          company: { select: { name: true } },
        },
      })

      const rows: Row[] = trailers.map((trailer) => ({
        id: trailer.id,
        unitNumber: trailer.unitNumber,
        companyName: trailer.company.name,
        type: trailer.type,
        year: trailer.year,
        plate: trailer.plate,
        status: trailer.status,
        isRetired: trailer.deletedAt !== null,
      }))

      return { rows, companyCount }
    },
  )

  const mayCreate = await currentUserCan('create', 'trailer')
  const showCompany = companyCount > 1

  const columns: Column<Row>[] = [
    {
      key: 'unitNumber',
      header: t('fleet.unitNumber'),
      render: (row) => <span className="font-mono">{row.unitNumber}</span>,
    },
    ...(showCompany
      ? [
          {
            key: 'company',
            header: t('ref.authority'),
            truncate: true,
            render: (row: Row) => row.companyName,
          },
        ]
      : []),
    {
      key: 'type',
      header: t('trailers.type'),
      render: (row) => orDash(row.type),
    },
    {
      key: 'year',
      header: t('fleet.year'),
      align: 'end',
      render: (row) => orDash(row.year),
    },
    {
      key: 'plate',
      header: t('fleet.plate'),
      render: (row) => <span className="font-mono">{orDash(row.plate)}</span>,
    },
    {
      key: 'status',
      header: t('ref.status'),
      render: (row) =>
        row.isRetired ? (
          <span className="text-ink-3">{t('ref.retired')}</span>
        ) : (
          <StatusBadge
            tone={TRAILER_TONE[row.status]}
            label={t(fleetStatusKey(row.status))}
          />
        ),
    },
  ]

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="text-lg font-medium text-ink">{t('trailers.title')}</h1>
        <div className="flex items-center gap-z3">
          <p className="text-xs text-ink-3">{t('trailers.stripeMeaning')}</p>
          {mayCreate ? (
            <Link href="/trailers/new">
              <Button variant="primary" size="compact">
                {t('trailers.add')}
              </Button>
            </Link>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-z3 border-b border-border bg-surface-2 px-gutter py-z2">
        <Link
          href={showRetired ? '/trailers' : '/trailers?removed=1'}
          className="text-sm font-medium text-ink-2 hover:text-accent"
        >
          {showRetired ? t('ref.hideRetired') : t('ref.showRetired')}
        </Link>
      </div>

      <Table
        caption={t('trailers.title')}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        rowHref={(row) => `/trailers/${row.id}`}
        stripeTone={(row) => TRAILER_TONE[row.status]}
        isCancelled={(row) => row.isRetired}
        empty={
          <EmptyState
            title={t('trailers.empty.title')}
            body={t('trailers.empty.body')}
            action={
              mayCreate ? (
                <Link href="/trailers/new">
                  <Button variant="primary">{t('trailers.add')}</Button>
                </Link>
              ) : null
            }
          />
        }
      />
    </>
  )
}
