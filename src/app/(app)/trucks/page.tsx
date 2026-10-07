import Link from 'next/link'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyScopeFilter } from '@/lib/tenancy'
import { Table, type Column } from '@/components/ui/Table'
import { WarningCell, warningLabels } from '@/components/WarningCell'
import { headingToForTrucks } from '@/lib/dispatch-fields'
import { agingDaysFrom, fleetStatusChangedForTrucks } from '@/lib/fleet-codes'
import { truckWarningFacts, truckWarnings, type Warning } from '@/lib/warnings'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import { orDash } from '../_reference/shared'
import { truckStatusKey } from './fields'
import { ColumnsChooser } from '../_grid/ColumnsChooser'
import { keepColumns } from '../_grid/grid-page'
import { readGridColumns } from '@/lib/grid-columns'
import {
  countTruckHealth,
  TRUCK_HEALTH_CHECKS,
  truckHealthCheckFor,
  truckHealthWhere,
  type TruckHealthCheck,
} from '@/lib/data-health'
import { DataHealthRow } from '../_grid/DataHealthRow'
import type { MessageKey } from '@/lib/i18n'
import {
  columnKeysFor,
  TRUCK_COLUMN_KEYS,
  TRUCK_COLUMNS_HIDDEN,
} from '@/lib/list-columns'
import type { StatusTone } from '@/lib/status'
import type { TruckStatus } from '@/generated/prisma/client'

// §7.1.7 — ELEVEN COLUMNS DECLARED, TWELVE WITH THE AUTHORITY ONE (§6.3), AND
// NINE SHOWN. §7.1 caps a table at nine and `Table` throws above it, so this
// page returned 500 for every organization from 2026-09-20 — when the warnings
// column landed — until the chooser arrived. The comment here used to say "eight
// columns at most", which was true when it was written and is how a count stops
// being checked.
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
  /** Derived: the last stop of the load this truck is on. Null when idle. */
  headingTo: string | null
  /** Item 12. Null until somebody classifies the unit. */
  fleetStatus: string | null
  /** Derived from the audit log. Null when nothing has ever changed it. */
  agingDays: number | null
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
  // THE DATA-HEALTH FILTER (§6.5 part 0): the same definition the footer's
  // count used, applied as a query filter. An unrecognised value filters
  // nothing rather than failing the page.
  const missing: TruckHealthCheck | null = truckHealthCheckFor(
    params['missing'],
  )

  const { rows, companyCount, visible, health } = await withCurrentOrg(
    'read',
    'truck',
    async (tx, session) => {
      const scope = companyScopeFilter(session.companyScopes)
      const companyCount = await tx.company.count()

      // THE FIVE COUNTS, ONE STATEMENT, IN THIS TRANSACTION (§6.5 part 0).
      // Over the fleet the user may see — scope and the authority filter —
      // and not over this view: attention, tag and the health filter itself
      // narrow the rows, not the row that says how much of the fleet is
      // incomplete.
      const health = await countTruckHealth(tx, {
        companyIds: companyParam ? [companyParam] : session.companyScopes,
      })

      const trucks = await tx.truck.findMany({
        where: {
          ...(tagParam ? { tags: { has: tagParam } } : {}),
          ...scope,
          ...(companyParam ? { companyId: companyParam } : {}),
          ...(showRetired ? {} : { deletedAt: null }),
          ...(missing ? truckHealthWhere(missing) : {}),
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
          fleetStatus: true,
          deletedAt: true,
          tags: true,
          company: { select: { name: true } },
          // NOT selected: purchasePriceCents. It is money, and no role in this
          // phase has a resource that grants it — see the Step 2 report.
        },
      })

      const miles = new Intl.NumberFormat(locale)

      // ONE QUERY EACH FOR THE PAGE, not one per row.
      const ids = trucks.map((truck) => truck.id)
      const [facts, headingTo, statusChanged] = await Promise.all([
        truckWarningFacts(tx, ids),
        headingToForTrucks(tx, ids),
        fleetStatusChangedForTrucks(tx, ids),
      ])
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
        headingTo: headingTo.get(truck.id) ?? null,
        fleetStatus: truck.fleetStatus,
        agingDays: agingDaysFrom(statusChanged.get(truck.id) ?? null, now),
      }))

      // IN THE SAME TRANSACTION as the rows, not a second one. This is one
      // `UserPreference` read; a round trip of its own for it would be a second
      // RLS session variable set and a second socket turn for a list of strings.
      const visible = await readGridColumns(
        tx,
        session.userId,
        'trucks.trucks',
        columnKeysFor(TRUCK_COLUMN_KEYS, companyCount > 1),
        TRUCK_COLUMNS_HIDDEN,
      )

      return { rows, companyCount, visible, health }
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
            label={t(truckStatusKey(row.status))}
          />
        ),
    },
    {
      key: 'fleetStatus',
      header: t('trucks.fleetStatus'),
      // A SECOND AXIS, BESIDE the status column and not instead of it. One
      // says where the freight has the unit, the other whether it can run —
      // and the pair that disagrees is the row worth finding.
      render: (row) => row.fleetStatus ?? '—',
    },
    {
      key: 'aging',
      header: t('trucks.aging'),
      // DERIVED FROM THE AUDIT LOG, never stored. Datatruck ships an
      // `Aging days` column that was true the day it was written.
      //
      // A BLANK IS NOT ZERO DAYS. Nothing has ever changed this unit's
      // fleet status, so there is no date to count from — and "0 d" would
      // read as "changed today", which is the one thing it cannot mean.
      render: (row) =>
        row.agingDays === null
          ? '—'
          : t('trucks.aging.days').replace('{days}', String(row.agingDays)),
    },
    {
      key: 'headingTo',
      header: t('dispatch.headingTo'),
      truncate: true,
      // DERIVED, NEVER STORED. A blank cell is a truck on nothing, which
      // is a fact rather than a gap — see dispatch-fields.ts.
      render: (row) => row.headingTo ?? '—',
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
      missing: missing ?? undefined,
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
        {/* THE CHOOSER IS WHY THIS TABLE IS LEGAL (§7.1.7). Eleven columns,
         * nine shown, and the specifications are a tick away rather than gone.
         * `ms-auto` puts it at the end of the row the two filters start. */}
        <div className="ms-auto">
          <ColumnsChooser
            grid="trucks.trucks"
            columns={columns.map((column) => ({
              key: column.key,
              header: String(column.header),
            }))}
            visible={visible}
            labels={{
              open: t('grid.columns'),
              apply: t('grid.columns.apply'),
              cancel: t('grid.columns.cancel'),
              firstLocked: t('grid.columns.firstLocked'),
            }}
            errors={{
              'grid.columns.errorEmpty': t('grid.columns.errorEmpty'),
              'grid.columns.errorGrid': t('grid.columns.errorGrid'),
            }}
          />
        </div>
      </div>

      <Table
        caption={t('trucks.title')}
        columns={keepColumns(columns, visible)}
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

      {/* THE DATA-HEALTH ROW (§6.5 part 0): five counts under the grid, each a
       * link to this list filtered by the same definition. Zero is shown. */}
      <DataHealthRow
        checks={TRUCK_HEALTH_CHECKS}
        counts={health}
        active={missing}
        hrefFor={(check) => withParams({ missing: check ?? undefined })}
        labels={{
          title: t('trucks.health.title'),
          all: t('trucks.health.all'),
          check: (check) => t(`trucks.health.${check}` as MessageKey),
        }}
      />
    </>
  )
}
