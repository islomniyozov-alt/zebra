import Link from 'next/link'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyScopeFilter } from '@/lib/tenancy'
import { Table, type Column } from '@/components/ui/Table'
import { WarningCell, warningLabels } from '@/components/WarningCell'
import { truckWarningFacts, truckWarnings, type Warning } from '@/lib/warnings'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import { orDash } from '../_reference/shared'
import { fleetStatusKey } from './fields'
import type { StatusTone } from '@/lib/status'
import type { TruckStatus } from '@/generated/prisma/client'

// §7.1 — eight columns at most here, and the authority column appears only
// where there is more than one authority to tell apart (§6.3).
//
// The stripe means availability on this screen, and the header says so (§2).

const TRUCK_TONE: Record<TruckStatus, StatusTone> = {
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
  make: string | null
  model: string | null
  year: number | null
  plate: string | null
  odometer: string
  status: TruckStatus
  isRetired: boolean
  warnings: readonly Warning[]
}

export default async function TrucksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const { t, locale } = await getLocaleContext()

  const showRetired = params['removed'] === '1'
  const companyParam =
    typeof params['company'] === 'string' ? params['company'] : undefined

  // Attention narrows the rows already fetched — warnings are computed and
  // there is nothing stored to filter on. The tag filter is a real query
  // filter: tags are stored and GIN-indexed.
  const needsAttention = params['attention'] === '1'
  const tagParam = typeof params['tag'] === 'string' ? params['tag'] : undefined

  const { rows, companyCount } = await withCurrentOrg(
    'read',
    'truck',
    async (tx, session) => {
      const scope = companyScopeFilter(session.companyScopes)
      const companyCount = await tx.company.count()

      const trucks = await tx.truck.findMany({
        where: {
          ...(tagParam ? { tags: { has: tagParam } } : {}),
          ...scope,
          ...(companyParam ? { companyId: companyParam } : {}),
          ...(showRetired ? {} : { deletedAt: null }),
        },
        orderBy: [{ company: { name: 'asc' } }, { unitNumber: 'asc' }],
        take: 200,
        select: {
          id: true,
          unitNumber: true,
          make: true,
          model: true,
          year: true,
          plate: true,
          currentOdometer: true,
          status: true,
          deletedAt: true,
          tags: true,
          company: { select: { name: true } },
          // NOT selected: purchasePriceCents. It is money, and no role in this
          // phase has a resource that grants it — see the Step 2 report.
        },
      })

      const miles = new Intl.NumberFormat(locale)

      // ONE QUERY FOR THE PAGE, not one per row.
      const facts = await truckWarningFacts(
        tx,
        trucks.map((truck) => truck.id),
      )
      const now = new Date()

      const rows: Row[] = trucks.map((truck) => ({
        id: truck.id,
        unitNumber: truck.unitNumber,
        companyName: truck.company.name,
        make: truck.make,
        model: truck.model,
        year: truck.year,
        plate: truck.plate,
        odometer:
          truck.currentOdometer === null
            ? '—'
            : miles.format(truck.currentOdometer),
        status: truck.status,
        isRetired: truck.deletedAt !== null,
        warnings: truckWarnings(facts.get(truck.id) ?? { compliance: [] }, now),
      }))

      return { rows, companyCount }
    },
  )

  const mayCreate = await currentUserCan('create', 'truck')
  const showCompany = companyCount > 1

  const warningNames = warningLabels(t)

  const columns: Column<Row>[] = [
    {
      key: 'unitNumber',
      header: t('fleet.unitNumber'),
      // Never truncated — it is the field people copy and read aloud (§7.1).
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
      key: 'make',
      header: t('trucks.make'),
      render: (row) => orDash(row.make),
    },
    {
      key: 'model',
      header: t('trucks.model'),
      render: (row) => orDash(row.model),
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
      key: 'odometer',
      header: t('trucks.odometer'),
      align: 'end',
      render: (row) => <span className="font-mono">{row.odometer}</span>,
    },
    {
      key: 'status',
      header: t('ref.status'),
      render: (row) =>
        row.isRetired ? (
          <span className="text-ink-3">{t('ref.retired')}</span>
        ) : (
          <StatusBadge
            tone={TRUCK_TONE[row.status]}
            label={t(fleetStatusKey(row.status))}
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

  const shown = needsAttention
    ? rows.filter((row) => row.warnings.length > 0)
    : rows

  // ── EVERY TOGGLE KEEPS THE OTHERS ──────────────────────────────────
  //
  // This was `showRetired ? '/trucks' : '/trucks?removed=1'`, which dropped
  // the company filter on every click and would now drop the attention and
  // tag filters too — turning on "needs attention" and then "show retired"
  // would quietly show everything again.
  const withParams = (over: Record<string, string | undefined>) => {
    const query = new URLSearchParams()
    const all = {
      company: companyParam,
      removed: showRetired ? '1' : undefined,
      attention: needsAttention ? '1' : undefined,
      tag: tagParam,
      ...over,
    }
    for (const [key, value] of Object.entries(all)) {
      if (value !== undefined) query.set(key, value)
    }
    const text = query.toString()
    return text ? `/trucks?${text}` : '/trucks'
  }

  const toggleHref = withParams({ removed: showRetired ? undefined : '1' })

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="text-lg font-medium text-ink">{t('trucks.title')}</h1>
        <div className="flex items-center gap-z3">
          <p className="text-xs text-ink-3">{t('trucks.stripeMeaning')}</p>
          {mayCreate ? (
            <Link href="/trucks/new">
              <Button variant="primary" size="compact">
                {t('trucks.add')}
              </Button>
            </Link>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-z3 border-b border-border bg-surface-2 px-gutter py-z2">
        <Link
          href={withParams({ attention: needsAttention ? undefined : '1' })}
          className={
            needsAttention
              ? 'text-sm font-medium text-accent'
              : 'text-sm font-medium text-ink-2 hover:text-accent'
          }
        >
          {needsAttention ? t('warning.all') : t('warning.attention')}
        </Link>
        <Link
          href={toggleHref}
          className="text-sm font-medium text-ink-2 hover:text-accent"
        >
          {showRetired ? t('ref.hideRetired') : t('ref.showRetired')}
        </Link>
      </div>

      <Table
        caption={t('trucks.title')}
        columns={columns}
        rows={shown}
        rowKey={(row) => row.id}
        rowHref={(row) => `/trucks/${row.id}`}
        stripeTone={(row) => TRUCK_TONE[row.status]}
        isCancelled={(row) => row.isRetired}
        empty={
          <EmptyState
            title={t('trucks.empty.title')}
            body={t('trucks.empty.body')}
            action={
              mayCreate ? (
                <Link href="/trucks/new">
                  <Button variant="primary">{t('trucks.add')}</Button>
                </Link>
              ) : null
            }
          />
        }
      />
    </>
  )
}
