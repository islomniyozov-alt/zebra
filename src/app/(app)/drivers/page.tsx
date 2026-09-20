import Link from 'next/link'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyScopeFilter } from '@/lib/tenancy'
import { Table, type Column } from '@/components/ui/Table'
import { WarningCell, warningLabels } from '@/components/WarningCell'
import {
  driverWarningFacts,
  driverWarnings,
  type Warning,
} from '@/lib/warnings'
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
  warnings: readonly Warning[]
}

export default async function DriversPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const { t } = await getLocaleContext()

  const showRetired = params['removed'] === '1'
  // ── ACTIVE BY DEFAULT, SINCE THE DATATRUCK IMPORT ──────────────────────
  //
  // This screen listed every driver row, which was the whole roster while the
  // whole roster was 54 people. The migration brought 69 terminated drivers
  // and 39 applicants who last drove in 2025, so the default view became 162
  // rows of which 108 are nobody a dispatcher can send anywhere.
  //
  // TWO INDEPENDENT TOGGLES, NOT ONE. Removed and inactive are different
  // facts: `deletedAt` means the row was a mistake, `INACTIVE` means a real
  // person who no longer drives here. Folding them together would make
  // "show removed" resurrect 108 former employees, and hide a mistaken row
  // among them.
  const showInactive = params['inactive'] === '1'
  const companyParam =
    typeof params['company'] === 'string' ? params['company'] : undefined

  // ── NEEDS ATTENTION, AND A TAG ───────────────────────────────────────
  //
  // The attention filter narrows the rows this page ALREADY fetched rather
  // than the query, because warnings are computed and there is nothing in
  // the database to filter on. That is honest for a capped list — the page
  // takes 200 — and it is written here rather than discovered later.
  //
  // The tag filter IS a query filter: tags are stored, indexed with GIN, and
  // `has` is an index lookup rather than a scan.
  const needsAttention = params['attention'] === '1'
  const tagParam = typeof params['tag'] === 'string' ? params['tag'] : undefined

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
          ...(showInactive ? {} : { status: { not: 'INACTIVE' } }),
          ...(tagParam ? { tags: { has: tagParam } } : {}),
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
          tags: true,
          company: { select: { name: true } },
          assignedTruck: { select: { unitNumber: true } },
          // NOT selected: payRules. Driver pay is its own resource (§7) and
          // this screen never asks for it, so it cannot leak from here.
        },
      })

      // ONE QUERY FOR THE WHOLE PAGE, not one per row. `driverWarningFacts`
      // takes every id at once; `tests/integration/warnings.test.ts` counts
      // the statements and fails if the number moves with the list.
      const facts = await driverWarningFacts(
        tx,
        drivers.map((driver) => driver.id),
      )
      const now = new Date()

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
        warnings: driverWarnings(
          facts.get(driver.id) ?? { compliance: [], negativeNetCount: 0 },
          now,
        ),
      }))

      return { rows, companyCount }
    },
  )

  const mayCreate = await currentUserCan('create', 'driver')
  const showCompany = companyCount > 1

  const warningNames = warningLabels(t)

  const columns: Column<Row>[] = [
    {
      key: 'name',
      header: t('drivers.name'),
      // No anchor: `Table` wraps the first cell in the row's stretched link,
      // and an anchor inside an anchor is invalid HTML that browsers resolve by
      // closing the outer one — which would kill the rest of the row.
      render: (row) => row.name,
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
    {
      key: 'warnings',
      header: t('warning.column'),
      render: (row) => (
        <WarningCell
          warnings={row.warnings}
          labels={{
            count: t('warning.count'),
            clear: t('warning.clear'),
            names: warningNames,
          }}
        />
      ),
    },
  ]

  // APPLIED AFTER THE WARNINGS ARE COMPUTED, because there is nothing in
  // the database to filter on — see the note where the flag is read.
  const shown = needsAttention
    ? rows.filter((row) => row.warnings.length > 0)
    : rows

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

      {/* EACH TOGGLE KEEPS THE OTHER, so turning one on does not silently
       * turn the other off — they answer different questions and a dispatcher
       * looking for a removed row should not lose the inactive ones to find
       * it. */}
      <div className="flex items-center gap-z4 border-b border-border bg-surface-2 px-gutter py-z2">
        {/* NEEDS ATTENTION KEEPS EVERY OTHER TOGGLE, like the pair below:
         * somebody narrowing to the rows that need work should not lose the
         * company or the inactive view to do it. */}
        <Link
          href={`/drivers?${new URLSearchParams({
            ...(companyParam ? { company: companyParam } : {}),
            ...(showInactive ? { inactive: '1' } : {}),
            ...(showRetired ? { removed: '1' } : {}),
            ...(tagParam ? { tag: tagParam } : {}),
            ...(needsAttention ? {} : { attention: '1' }),
          }).toString()}`}
          className={
            needsAttention
              ? 'text-sm font-medium text-accent'
              : 'text-sm font-medium text-ink-2 hover:text-accent'
          }
        >
          {needsAttention ? t('warning.all') : t('warning.attention')}
        </Link>

        <Link
          href={`/drivers?${new URLSearchParams({
            ...(companyParam ? { company: companyParam } : {}),
            ...(showInactive ? { inactive: '1' } : {}),
            ...(showRetired ? {} : { removed: '1' }),
          }).toString()}`}
          className="text-sm font-medium text-ink-2 hover:text-accent"
        >
          {showRetired ? t('ref.hideRetired') : t('ref.showRetired')}
        </Link>
        <Link
          href={`/drivers?${new URLSearchParams({
            ...(companyParam ? { company: companyParam } : {}),
            ...(showRetired ? { removed: '1' } : {}),
            ...(showInactive ? {} : { inactive: '1' }),
          }).toString()}`}
          className="text-sm font-medium text-ink-2 hover:text-accent"
        >
          {showInactive ? t('drivers.hideInactive') : t('drivers.showInactive')}
        </Link>
      </div>

      <Table
        caption={t('drivers.title')}
        columns={columns}
        rows={shown}
        rowKey={(row) => row.id}
        rowHref={(row) => `/drivers/${row.id}`}
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
