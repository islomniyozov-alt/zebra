import Link from 'next/link'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyScopeFilter } from '@/lib/tenancy'
import { Table, type Column } from '@/components/ui/Table'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import { orDash } from '../_reference/shared'
import { driverStatusKey } from './fields'
import type { StatusTone } from '@/lib/status'
import type { DriverStatus } from '@/generated/prisma/client'

const DRIVER_TONE: Record<DriverStatus, StatusTone> = {
  AVAILABLE: 'neutral',
  DISPATCHED: 'progress',
  ON_ROUTE: 'progress',
  OFF_DUTY: 'neutral',
  VACATION: 'warning',
  INACTIVE: 'muted',
}

interface Row {
  id: string
  name: string
  companyName: string
  phone: string | null
  cdlNumber: string | null
  cdlState: string | null
  truck: string | null
  status: DriverStatus
  isRetired: boolean
}

export default async function DriversPage({
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
    'driver',
    async (tx, session) => {
      const companyCount = await tx.company.count()
      const drivers = await tx.driver.findMany({
        where: {
          ...companyScopeFilter(session.companyScopes),
          ...(companyParam ? { companyId: companyParam } : {}),
          ...(showRetired ? {} : { deletedAt: null }),
        },
        orderBy: [{ company: { name: 'asc' } }, { lastName: 'asc' }],
        take: 200,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          cdlNumber: true,
          cdlState: true,
          status: true,
          deletedAt: true,
          company: { select: { name: true } },
          assignedTruck: { select: { unitNumber: true } },
          // NOT selected: payRules. Driver pay is its own resource (§7) and
          // this screen never asks for it, so it cannot leak from here.
        },
      })

      const rows: Row[] = drivers.map((driver) => ({
        id: driver.id,
        name: `${driver.lastName}, ${driver.firstName}`,
        companyName: driver.company.name,
        phone: driver.phone,
        cdlNumber: driver.cdlNumber,
        cdlState: driver.cdlState,
        truck: driver.assignedTruck?.unitNumber ?? null,
        status: driver.status,
        isRetired: driver.deletedAt !== null,
      }))

      return { rows, companyCount }
    },
  )

  const mayCreate = await currentUserCan('create', 'driver')
  const showCompany = companyCount > 1

  const columns: Column<Row>[] = [
    {
      key: 'name',
      header: t('drivers.name'),
      render: (row) => (
        <Link
          href={`/drivers/${row.id}`}
          className="font-medium text-ink hover:text-accent"
        >
          {row.name}
        </Link>
      ),
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
      key: 'phone',
      header: t('drivers.phone'),
      render: (row) =>
        row.phone ? (
          // §8 — tap-to-call on every surface, desktop included.
          <a href={`tel:${row.phone}`} className="font-mono hover:text-accent">
            {row.phone}
          </a>
        ) : (
          '—'
        ),
    },
    {
      key: 'cdl',
      header: t('drivers.cdlNumber'),
      render: (row) => (
        <span className="font-mono">
          {orDash(
            row.cdlNumber
              ? [row.cdlNumber, row.cdlState].filter(Boolean).join(' · ')
              : null,
          )}
        </span>
      ),
    },
    {
      key: 'truck',
      header: t('loads.column.truck'),
      render: (row) => <span className="font-mono">{orDash(row.truck)}</span>,
    },
    {
      key: 'status',
      header: t('ref.status'),
      render: (row) =>
        row.isRetired ? (
          <span className="text-ink-3">{t('ref.retired')}</span>
        ) : (
          <StatusBadge
            tone={DRIVER_TONE[row.status]}
            label={t(driverStatusKey(row.status))}
          />
        ),
    },
  ]

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="text-lg font-medium text-ink">{t('drivers.title')}</h1>
        <div className="flex items-center gap-z3">
          <p className="text-xs text-ink-3">{t('drivers.stripeMeaning')}</p>
          {mayCreate ? (
            <Link href="/drivers/new">
              <Button variant="primary" size="compact">
                {t('drivers.add')}
              </Button>
            </Link>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-z3 border-b border-border bg-surface-2 px-gutter py-z2">
        <Link
          href={showRetired ? '/drivers' : '/drivers?removed=1'}
          className="text-sm font-medium text-ink-2 hover:text-accent"
        >
          {showRetired ? t('ref.hideRetired') : t('ref.showRetired')}
        </Link>
      </div>

      <Table
        caption={t('drivers.title')}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        stripeTone={(row) => DRIVER_TONE[row.status]}
        isCancelled={(row) => row.isRetired}
        empty={
          <EmptyState
            title={t('drivers.empty.title')}
            body={t('drivers.empty.body')}
            action={
              mayCreate ? (
                <Link href="/drivers/new">
                  <Button variant="primary">{t('drivers.add')}</Button>
                </Link>
              ) : null
            }
          />
        }
      />
    </>
  )
}
