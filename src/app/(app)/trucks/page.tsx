import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { TruckStatus } from '@/generated/prisma/client'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import type { MessageKey } from '@/lib/i18n'
import { Table, type Column } from '@/components/ui/Table'
import { FilterBar } from '@/components/ui/FilterBar'
import { WarningCell, warningLabels } from '@/components/WarningCell'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import { orDash } from '../_reference/shared'
import { truckStatusKey } from './fields'
import { AuthorityFilter } from '../_grid/AuthorityFilter'
import { ColumnsChooser } from '../_grid/ColumnsChooser'
import { DataHealthRow } from '../_grid/DataHealthRow'
import { keepColumns } from '../_grid/grid-page'
import { CopyLoadNumber } from '../loads/CopyLoadNumber'
import { TruckFilters } from './TruckFilters'
import { readGridColumns } from '@/lib/grid-columns'
import { countTruckHealth, TRUCK_HEALTH_CHECKS } from '@/lib/data-health'
import { FLEET_STATUSES } from '@/lib/fleet-codes'
import {
  columnKeysFor,
  TRUCK_COLUMN_KEYS,
  TRUCK_COLUMNS_HIDDEN,
} from '@/lib/list-columns'
import type { StatusTone } from '@/lib/status'
import {
  readTruckListParams,
  TRUCK_FILTER_PARAMS,
  TRUCK_STATUS_ORDER,
  TRUCK_VIEWS,
  viewHoldsInactive,
} from '@/lib/truck-list'
import { readTruckListData } from '@/lib/truck-list-page'
import type { TruckListRow } from '@/lib/truck-list-rows'

// §6.5 part 1 — THE TRUCKS LIST TAKES DATATRUCK'S SHAPE (the owner's brief of
// 2026-11-10). Four views as chips with counts, Datatruck's columns, a search,
// the authority dropdown, a Filters popover, the chooser, an export, and the
// status counts in the footer above the data-health row.
//
// WHAT IT READS IS `readTruckListData` in `src/lib/truck-list-page.ts`: the
// rows, every number on the bar and in the footer from ONE grouped statement,
// the authorities and the fleet's makes. The page renders. Sixteen columns
// declared (§7.1.7), nine shown; `Table` throws above the cap, and the chooser
// is what keeps this page legal.
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

/** The page reads this many and says so past it (§6.5 part 1). */
const PAGE_CAP = 500

/**
 * The chooser's labels, keyed by column (§7.1.7). TYPED AGAINST
 * `TRUCK_COLUMN_KEYS`, so a column added to the list and not to this map is a
 * type error rather than a checkbox labelled `undefined`.
 */
const truckColumnHeaders = (
  t: (key: MessageKey) => string,
): Record<(typeof TRUCK_COLUMN_KEYS)[number], string> => ({
  unitNumber: t('fleet.unitNumber'),
  make: t('trucks.make'),
  model: t('trucks.model'),
  plate: t('fleet.plate'),
  vin: t('fleet.vin'),
  year: t('fleet.year'),
  plateState: t('trucks.column.state'),
  company: t('ref.authority'),
  driver: t('trucks.column.driver'),
  ownerName: t('trucks.column.ownerName'),
  odometer: t('trucks.odometer'),
  status: t('ref.status'),
  fleetStatus: t('trucks.fleetStatus'),
  aging: t('trucks.aging'),
  headingTo: t('dispatch.headingTo'),
  warnings: t('warning.column'),
})

export default async function TrucksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const { t, locale } = await getLocaleContext()

  // THE URL, READ ONCE, in the lib: the view (`?view=`, Active by default and
  // for any unknown name), the search, the popover's filters, the tag and the
  // data-health check. The page never parses a parameter itself.
  const listParams = readTruckListParams(params)

  // §6.8: a role without the read is REFUSED as a 404, never a 500 (sweep).
  if (!(await currentUserCan('read', 'truck'))) notFound()

  const [mayCreate, mayOpenDriver] = await Promise.all([
    currentUserCan('create', 'truck'),
    currentUserCan('read', 'driver'),
  ])

  const {
    data: { rows, counts, authorities, makes },
    health,
    visible,
  } = await withCurrentOrg('read', 'truck', async (tx, session) => {
    const data = await readTruckListData(
      tx,
      session.companyScopes,
      listParams,
      {
        now: new Date(),
        take: PAGE_CAP,
      },
    )
    // THE FIVE DATA-HEALTH COUNTS, ONE STATEMENT, IN THIS TRANSACTION (§6.5
    // part 0). Over the fleet the user may see — scope and the authority
    // filter — and never over this view: the row says how much of the fleet
    // is incomplete, not how much of this view.
    const health = await countTruckHealth(tx, {
      companyIds: listParams.company
        ? [listParams.company]
        : session.companyScopes,
    })
    // §7.1.7, in the same transaction. One `UserPreference` read.
    const visible = await readGridColumns(
      tx,
      session.userId,
      'trucks.trucks',
      columnKeysFor(TRUCK_COLUMN_KEYS, data.authorities.length > 1),
      TRUCK_COLUMNS_HIDDEN,
    )
    return { data, health, visible }
  })

  const showCompany = authorities.length > 1
  const headers = truckColumnHeaders(t)
  const warningNames = warningLabels(t)
  const miles = new Intl.NumberFormat(locale)

  /**
   * Every current parameter, with `over` applied — a key set to `undefined`
   * is dropped. The data-health links and the export carry the view and every
   * filter forward, because a link that silently drops the view is worse than
   * no link.
   */
  const withParams = (over: Record<string, string | undefined>) => {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string' && value !== '') query.set(key, value)
    }
    for (const [key, value] of Object.entries(over)) {
      if (value === undefined) query.delete(key)
      else query.set(key, value)
    }
    const text = query.toString()
    return text ? `/trucks?${text}` : '/trucks'
  }

  /** The same query string, for the export: the file is this view. */
  const exportHref = `/trucks/export${withParams({}).slice('/trucks'.length)}`

  /** A name that opens its record, above the row's overlay (§7.1). */
  const recordLink = (href: string, text: string) => (
    <Link
      href={href}
      className="relative z-10 text-ink underline-offset-2 hover:text-accent hover:underline"
    >
      {text}
    </Link>
  )

  // DECLARED IN `TRUCK_COLUMN_KEYS`' ORDER — Datatruck's — and the test reads
  // the keys off this file to prove it. Widths per §7.1: the identifiers, the
  // year, the state, the odometer, the badge, the aging and the warnings are
  // fitted; the names share what is left, driver at two for its two seats.
  const columns: Column<TruckListRow>[] = [
    {
      key: 'unitNumber',
      header: headers.unitNumber,
      fit: 'content',
      // Never truncated — it is the field people copy and read aloud (§7.1).
      render: (row) => <span className="font-mono">{row.unitNumber}</span>,
      // §6.7 item 4, here: the copy icon sits OUTSIDE the row's named anchor.
      trailing: (row) => (
        <CopyLoadNumber
          value={row.unitNumber}
          labels={{
            copy: t('trucks.copyUnit'),
            copied: t('trucks.copiedUnit'),
            failed: t('trucks.copyFailed'),
          }}
        />
      ),
    },
    {
      key: 'make',
      header: headers.make,
      truncate: true,
      render: (row) => orDash(row.make),
    },
    {
      key: 'model',
      header: headers.model,
      truncate: true,
      render: (row) => orDash(row.model),
    },
    {
      key: 'plate',
      header: headers.plate,
      fit: 'content',
      render: (row) => <span className="font-mono">{orDash(row.plate)}</span>,
    },
    {
      key: 'vin',
      header: headers.vin,
      fit: 'content',
      render: (row) => <span className="font-mono">{orDash(row.vin)}</span>,
    },
    {
      key: 'year',
      header: headers.year,
      fit: 'content',
      align: 'end',
      render: (row) => orDash(row.year),
    },
    {
      key: 'plateState',
      header: headers.plateState,
      fit: 'content',
      render: (row) => orDash(row.plateState),
    },
    ...(showCompany
      ? [
          {
            key: 'company',
            header: headers.company,
            truncate: true,
            render: (row: TruckListRow) => row.companyName,
          },
        ]
      : []),
    {
      key: 'driver',
      header: headers.driver,
      truncate: true,
      share: 2,
      // BOTH SEATS of a team truck, each its own link where the role may open
      // a driver (§6.7 item 3). An empty seat is an em dash, never blank.
      render: (row) =>
        row.crew.length === 0
          ? '—'
          : row.crew.map((seat, index) => (
              <span key={seat.id}>
                {index > 0 ? ' · ' : null}
                {mayOpenDriver
                  ? recordLink(`/drivers/${seat.id}`, seat.name)
                  : seat.name}
              </span>
            )),
    },
    {
      key: 'ownerName',
      header: headers.ownerName,
      truncate: true,
      // Null means the carrier owns it (the schema's own rule): the dash is
      // the honest cell, not the authority's name repeated.
      render: (row) => orDash(row.ownerName),
    },
    {
      key: 'odometer',
      header: headers.odometer,
      fit: 'content',
      align: 'end',
      render: (row) => (
        <span className="font-mono">
          {row.odometer === null ? '—' : miles.format(row.odometer)}
        </span>
      ),
    },
    {
      key: 'status',
      header: headers.status,
      fit: 'content',
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
      header: headers.fleetStatus,
      fit: 'content',
      // A SECOND AXIS, BESIDE the status column and not instead of it. One
      // says where the freight has the unit, the other whether it can run —
      // and the pair that disagrees is the row worth finding.
      render: (row) => row.fleetStatus ?? '—',
    },
    {
      key: 'aging',
      header: headers.aging,
      fit: 'content',
      // DERIVED FROM THE AUDIT LOG, never stored. A BLANK IS NOT ZERO DAYS:
      // nothing has ever changed this unit's fleet status, so there is no
      // date to count from, and "0 d" would read as "changed today".
      render: (row) =>
        row.agingDays === null
          ? '—'
          : t('trucks.aging.days').replace('{days}', String(row.agingDays)),
    },
    {
      key: 'headingTo',
      header: headers.headingTo,
      truncate: true,
      // DERIVED, NEVER STORED. A blank cell is a truck on nothing.
      render: (row) => row.headingTo ?? '—',
    },
    {
      key: 'warnings',
      header: headers.warnings,
      fit: 'content',
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

  // Whether anything narrows the list beyond the default view, for the empty
  // state's wording: "no trucks yet" and "none match" are different sentences.
  const filtered =
    listParams.view !== 'active' ||
    Boolean(
      listParams.company ||
        listParams.q ||
        listParams.status ||
        listParams.fleet ||
        listParams.make ||
        listParams.yearFrom !== undefined ||
        listParams.yearTo !== undefined ||
        listParams.attention ||
        listParams.tag ||
        listParams.missing,
    )

  // THE FOOTER'S STATUS CHIPS (§6.5 part 1): the brief's five, then Sold and
  // Removed only on the views that can hold them. Read-only — the status
  // FILTER is in the popover, and a chip that both reported and narrowed would
  // be two controls in one. Zero is shown.
  const statusChips: (TruckStatus | 'REMOVED')[] = [
    ...TRUCK_STATUS_ORDER.filter(
      (status) => status !== 'SOLD' || viewHoldsInactive(listParams.view),
    ),
    ...(viewHoldsInactive(listParams.view) ? (['REMOVED'] as const) : []),
  ]

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="text-lg font-medium text-ink">{t('trucks.title')}</h1>
        <div className="flex items-center gap-z3">
          <p className="text-xs text-ink-3">{t('trucks.stripeMeaning')}</p>
          {/* §6.5 part 1: this view, every row of it, as CSV. A plain link:
           * the browser downloads, middle-click works, nothing is posted. */}
          <a
            href={exportHref}
            className="inline-flex h-control-compact items-center rounded-control border border-border-strong bg-surface px-z2 text-xs font-medium text-ink-2 hover:bg-surface-3"
          >
            {t('trucks.export')}
          </a>
          {mayCreate ? (
            <Link href="/trucks/new">
              <Button variant="primary" size="compact">
                {t('trucks.add')}
              </Button>
            </Link>
          ) : null}
        </div>
      </div>

      {/* §7.4, two rows as on /loads: row one the four view chips with their
       * counts; row two the search, the authority dropdown, Filters, the
       * chooser and Clear filters. */}
      <FilterBar
        layout="twoRows"
        clearLabel={t('trucks.filter.clear')}
        moreLabel={t('trucks.filter.more')}
        extraParams={['company', 'tag', 'missing', ...TRUCK_FILTER_PARAMS]}
        groups={[
          {
            param: 'view',
            label: t('trucks.filter.view'),
            // ACTIVE IS THE DEFAULT CHIP: lit with no `?view=`, and pressing
            // it deletes the key (§6.5 part 1).
            defaultValue: 'active',
            choices: TRUCK_VIEWS.map((name) => ({
              value: name,
              label: t(`trucks.view.${name}` as MessageKey),
              count: counts.views[name],
            })),
          },
        ]}
        search={{
          param: 'q',
          label: t('trucks.filter.search'),
          placeholder: t('trucks.filter.searchPlaceholder'),
        }}
      >
        <AuthorityFilter
          companies={authorities}
          label={t('ref.authority')}
          allLabel={t('accounting.allCompanies')}
        />
        <TruckFilters
          statuses={TRUCK_STATUS_ORDER.map((status) => ({
            value: status,
            label: t(truckStatusKey(status)),
          }))}
          fleetStatuses={FLEET_STATUSES}
          makes={makes}
          labels={{
            open: t('trucks.filters'),
            status: t('trucks.filter.status'),
            fleetStatus: t('trucks.filter.fleetStatus'),
            make: t('trucks.filter.make'),
            anyMake: t('trucks.filter.anyMake'),
            year: t('trucks.filter.year'),
            yearFrom: t('trucks.filter.yearFrom'),
            yearTo: t('trucks.filter.yearTo'),
            warnings: t('trucks.filter.warnings'),
            needsAttention: t('warning.attention'),
          }}
        />
        <ColumnsChooser
          grid="trucks.trucks"
          columns={columnKeysFor(TRUCK_COLUMN_KEYS, showCompany).map((key) => ({
            key,
            header: headers[key],
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
      </FilterBar>

      <Table
        caption={t('trucks.title')}
        columns={keepColumns(columns, visible)}
        rows={rows}
        rowKey={(row) => row.id}
        rowHref={(row) => `/trucks/${row.id}`}
        stripeTone={(row) => TRUCK_TONE[row.status]}
        isCancelled={(row) => row.isRetired}
        empty={
          filtered ? (
            <EmptyState
              title={t('trucks.emptyFiltered.title')}
              body={t('trucks.emptyFiltered.body')}
              action={
                <Link href="/trucks">
                  <Button variant="secondary">
                    {t('trucks.filter.clear')}
                  </Button>
                </Link>
              }
            />
          ) : (
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
          )
        }
      />

      {/* THE STATUS COUNTS (§6.5 part 1): read-only chips in the footer's
       * register, over the rows this view selects, by the Status column's own
       * predicate. */}
      <div
        role="status"
        aria-label={t('trucks.statusCounts')}
        className="flex flex-wrap items-center gap-x-z4 gap-y-z1 border-t border-border bg-surface px-gutter py-z2 text-xs"
      >
        <span className="uppercase tracking-[0.04em] text-ink-3">
          {t('trucks.statusCounts')}
        </span>
        {statusChips.map((chip) => (
          <span
            key={chip}
            data-status-chip={chip}
            className="inline-flex items-baseline gap-z1 text-ink-2"
          >
            <span>
              {chip === 'REMOVED' ? t('ref.retired') : t(truckStatusKey(chip))}
            </span>
            <span className="font-mono tabular-nums">
              {counts.status[chip] ?? 0}
            </span>
          </span>
        ))}
      </div>

      {/* THE DATA-HEALTH ROW (§6.5 part 0): five counts under the grid, each a
       * link to this list filtered by the same definition, with the view and
       * the other filters kept. Zero is shown. */}
      <DataHealthRow
        checks={TRUCK_HEALTH_CHECKS}
        counts={health}
        active={listParams.missing}
        hrefFor={(check) => withParams({ missing: check ?? undefined })}
        labels={{
          title: t('trucks.health.title'),
          all: t('trucks.health.all'),
          check: (check) => t(`trucks.health.${check}` as MessageKey),
        }}
      />

      {/* THE CAP, SAID IN WORDS (§6.5 part 1): the view selected more than the
       * page read, and the rest exist. */}
      {rows.length >= PAGE_CAP ? (
        <p className="border-t border-border bg-warning-soft px-gutter py-z2 text-xs text-ink-2">
          {t('trucks.capped').replace('{n}', String(PAGE_CAP))}
        </p>
      ) : null}
    </>
  )
}
