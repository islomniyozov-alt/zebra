import Link from 'next/link'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyScopeFilter } from '@/lib/tenancy'
import { Table, type Column } from '@/components/ui/Table'
import { Tabs } from '@/components/ui/Tabs'
import { WarningCell, warningLabels } from '@/components/WarningCell'
import {
  dispatchFactsForDrivers,
  dispatchStatusFrom,
  lastActivityForDrivers,
  type DispatchStatus,
} from '@/lib/dispatch-fields'
import {
  dqfFactsOf,
  driverWarningFacts,
  driverWarnings,
  NO_DRIVER_FACTS,
  truckWarningFacts,
  truckWarnings,
  type Warning,
} from '@/lib/warnings'
import { dqfChecklist, dqfIncompleteCount } from '@/lib/dqf'
import {
  countDriverTabs,
  DRIVER_TABS,
  driverTabWhere,
  isDriverTab,
  readinessFor,
  type DriverTab,
  type Readiness,
} from '@/lib/driver-list'
import { readGridColumns } from '@/lib/grid-columns'
import {
  columnKeysFor,
  DRIVER_COLUMN_KEYS,
  DRIVER_COLUMNS_HIDDEN,
} from '@/lib/list-columns'
import {
  applyList,
  columnFilterParam,
  type ListShape,
  type RawParams,
} from '@/lib/list-view'
import { DENSITIES, readDensity, readSavedViews } from '@/lib/preferences'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import { ColumnFunnel } from '../_grid/ColumnFunnel'
import { ColumnsChooser } from '../_grid/ColumnsChooser'
import { GridFooterNav } from '../_grid/GridFooterNav'
import { DataHealthRow } from '../_grid/DataHealthRow'
import {
  countDriverHealth,
  DRIVER_HEALTH_CHECKS,
  driverHealthBase,
  driverHealthCheckFor,
  driverHealthWhere,
  type DriverHealthCheck,
} from '@/lib/data-health'
import { gridView, keepColumns, pagedFooterLabel } from '../_grid/grid-page'
import { SavedViews } from '../loads/SavedViews'
import { BulkRoster } from './BulkRoster'
import { orDash } from '../_reference/shared'
import { driverStatusKey } from './fields'
import type { StatusTone } from '@/lib/status'
import { rosterBadge, type RosterStatus } from '@/lib/driver-roster'
import type { MessageKey } from '@/lib/i18n'
import type { DriverStatus, DriverType } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE DRIVERS LIST TAKES DATATRUCK'S SHAPE (§6.4 part 1, queue item 16).
//
// Five tabs over one grid, ten named columns inside §7.1's cap, an assign
// status derived on read, roster bulk actions, saved views — on the grid
// machinery every Accounting list already runs on. What this page does NOT do
// is in §6.4 too: no export (§7.1.7's three operational lists get theirs
// together), no import screen (the loads-import precedent), and no second
// status column (owner's ruling, 2026-09-21 — the tab IS the employee status).
// ---------------------------------------------------------------------------

const DRIVER_TONE: Record<DriverStatus, StatusTone> = {
  AVAILABLE: 'neutral',
  DISPATCHED: 'progress',
  ON_ROUTE: 'progress',
  OFF_DUTY: 'neutral',
  VACATION: 'warning',
  INACTIVE: 'muted',
}

// ── THE DERIVED AXIS, WHICH IS NOT `Driver.status` ─────────────────────
//
// `Driver.status` is a ROSTER fact somebody types on the form — hired, on
// vacation, no longer with us. Nothing in the freight engine writes it.
// Dispatch status is a FREIGHT fact and is derived on every read, so the two
// never disagree the way a stored copy would.
const DISPATCH_TONE: Record<DispatchStatus, StatusTone> = {
  available: 'neutral',
  assigned: 'progress',
  in_transit: 'progress',
  off_duty: 'muted',
}

const DISPATCH_FILTERS = [
  'available',
  'assigned',
  'in_transit',
  'off_duty',
] as const

/**
 * THE PAGE READS 500 ROWS, NOT 200, AND SAYS SO (§6.4). Warnings and readiness
 * are computed, so there is nothing to page in the database; a tab that
 * selected more than this shows the first 500 and a sentence, never a silent
 * cut.
 */
const PAGE_CAP = 500

interface Row {
  id: string
  name: string
  companyName: string
  phone: string | null
  email: string | null
  cdlNumber: string | null
  cdlState: string | null
  truck: string | null
  driverType: DriverType
  status: DriverStatus
  /** The roster exception worth showing, or null when they simply work here. */
  roster: RosterStatus | null
  isRetired: boolean
  warnings: readonly Warning[]
  /** Derived from the freight and the off-duty flag. Never stored. */
  dispatch: DispatchStatus
  /** Derived from the DQF and the truck's compliance. Never stored (§6.4). */
  ready: Readiness
  lastActivityAt: Date | null
  terminationDate: Date | null
  offDutyUntil: Date | null
}

export default async function DriversPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const { t, locale } = await getLocaleContext()

  const rawTab = typeof params['tab'] === 'string' ? params['tab'] : ''
  // THE TAB IS IN THE URL, first tab default, and an unrecognised value opens
  // the first rather than erroring (§7.1.6) — a stale link should open.
  const tab: DriverTab = isDriverTab(rawTab) ? rawTab : 'active'

  // REMOVED IS A FLAG, NOT A TAB (§6.4): a soft-deleted row is a mistake, not a
  // person, and the toggle widens whichever tab is open.
  const showRetired = params['removed'] === '1'
  const companyParam =
    typeof params['company'] === 'string' ? params['company'] : undefined

  // ── NEEDS ATTENTION, THE DISPATCH FILTER, AND A TAG ──────────────────
  //
  // The first two narrow the rows this page ALREADY fetched rather than the
  // query, because warnings and dispatch status are computed and there is
  // nothing in the database to filter on. The tag filter IS a query filter:
  // tags are stored and indexed with GIN.
  const needsAttention = params['attention'] === '1'
  const tagParam = typeof params['tag'] === 'string' ? params['tag'] : undefined
  const dispatchParam =
    typeof params['dispatch'] === 'string' ? params['dispatch'] : undefined
  // THE DATA-HEALTH FILTER (§6.5 part 0b): the footer's own definition applied
  // as a query filter, over the footer's own base (active people), whichever
  // tab is open. An unrecognised value filters nothing.
  const missing: DriverHealthCheck | null = driverHealthCheckFor(
    params['missing'],
  )

  // ── THE DQF WARNING CARRIES KEYS; THIS TURNS THEM INTO WORDS ─────────
  const namedGaps = (warning: Warning): Warning =>
    warning.name !== 'dqf_incomplete'
      ? warning
      : {
          ...warning,
          detail: warning.detail
            .split(',')
            .map((key) => t(`dqf.key.${key}` as MessageKey))
            .join(', '),
        }

  const now = new Date()

  const { rows, companyCount, counts, visible, savedViews, density, health } =
    await withCurrentOrg('read', 'driver', async (tx, session) => {
      const companyCount = await tx.company.count()
      const base = {
        ...companyScopeFilter(session.companyScopes),
        ...(companyParam ? { companyId: companyParam } : {}),
        ...(tagParam ? { tags: { has: tagParam } } : {}),
      }

      // FIVE COUNTS, ONE PER TAB, BY COUNT(*) — never the length of a capped
      // list (§6.2.8). In the same transaction as the rows they count.
      const counts = await countDriverTabs(tx, base, now, showRetired)

      // THE FIVE DATA-HEALTH COUNTS, ONE STATEMENT, IN THIS TRANSACTION (§6.5
      // part 0b). Over the active people the user may see — scope and the
      // authority filter — never over this view's tab, chip or tag.
      const health = await countDriverHealth(
        tx,
        { companyIds: companyParam ? [companyParam] : session.companyScopes },
        now,
      )

      const drivers = await tx.driver.findMany({
        where: {
          AND: [
            base,
            driverTabWhere(tab, now, showRetired),
            // The health filter brings its own base, so the figure's link
            // lists the same rows from any tab.
            ...(missing
              ? [driverHealthBase(), driverHealthWhere(missing, now)]
              : []),
          ],
        },
        orderBy: [{ company: { name: 'asc' } }, { lastName: 'asc' }],
        take: PAGE_CAP,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          email: true,
          cdlNumber: true,
          cdlState: true,
          status: true,
          driverType: true,
          deletedAt: true,
          terminationDate: true,
          offDutyUntil: true,
          tags: true,
          company: { select: { name: true } },
          assignedTruck: { select: { id: true, unitNumber: true } },
          // NOT selected: payRules. Driver pay is its own resource (§7) and
          // this screen never asks for it, so it cannot leak from here.
        },
      })

      // ONE QUERY EACH FOR THE WHOLE PAGE, not one per row. Each loader takes
      // every id at once; `tests/integration/warnings.test.ts` and
      // `tests/integration/dispatch-fields.test.ts` count the statements and
      // fail if the number moves with the length of the list. The trucks'
      // compliance is read once for the trucks on the page, for the assign
      // status (§6.4).
      const ids = drivers.map((driver) => driver.id)
      const truckIds = [
        ...new Set(
          drivers.flatMap((driver) =>
            driver.assignedTruck ? [driver.assignedTruck.id] : [],
          ),
        ),
      ]
      const [facts, dispatchFacts, lastActivity, truckFacts, visible] =
        await Promise.all([
          driverWarningFacts(tx, ids),
          dispatchFactsForDrivers(tx, ids),
          lastActivityForDrivers(tx, ids),
          truckWarningFacts(tx, truckIds),
          // §7.1.7, in the same transaction as the preference reads below.
          readGridColumns(
            tx,
            session.userId,
            'drivers.drivers',
            columnKeysFor(DRIVER_COLUMN_KEYS, companyCount > 1),
            DRIVER_COLUMNS_HIDDEN,
          ),
        ])
      const savedViews = await readSavedViews(tx, session.userId, 'drivers')
      const density = await readDensity(tx, session.userId)

      const truckExpired = new Map<string, boolean>()
      for (const [truckId, truckFact] of truckFacts) {
        truckExpired.set(
          truckId,
          truckWarnings(truckFact, now).some(
            (warning) => warning.name === 'compliance_expired',
          ),
        )
      }

      const rows: Row[] = drivers.map((driver) => {
        const driverFacts = facts.get(driver.id) ?? NO_DRIVER_FACTS
        return {
          id: driver.id,
          name: `${driver.lastName}, ${driver.firstName}`,
          companyName: driver.company.name,
          phone: driver.phone,
          email: driver.email,
          cdlNumber: driver.cdlNumber,
          cdlState: driver.cdlState,
          truck: driver.assignedTruck?.unitNumber ?? null,
          driverType: driver.driverType,
          status: driver.status,
          roster: rosterBadge(driver.status),
          isRetired: driver.deletedAt !== null,
          warnings: driverWarnings(driverFacts, now).map(namedGaps),
          dispatch: dispatchStatusFrom(
            dispatchFacts.get(driver.id) ?? {
              rosterStatus: driver.status,
              isOffDuty: false,
              offDutyUntil: null,
              activeStatuses: [],
            },
            now,
          ),
          // ASSIGN STATUS, DERIVED (§6.4): qualifiable, DQF complete, a truck,
          // and that truck's compliance in date — the first failing reason
          // named.
          ready: readinessFor({
            qualifiable: driverFacts.qualifiable,
            dqfIncomplete: dqfIncompleteCount(
              dqfChecklist(dqfFactsOf(driverFacts), now),
            ),
            truckAssigned: driver.assignedTruck !== null,
            truckExpired: driver.assignedTruck
              ? (truckExpired.get(driver.assignedTruck.id) ?? false)
              : false,
          }),
          lastActivityAt: lastActivity.get(driver.id) ?? null,
          terminationDate: driver.terminationDate,
          offDutyUntil: driver.offDutyUntil,
        }
      })

      return {
        rows,
        companyCount,
        counts,
        visible,
        savedViews,
        density,
        health,
      }
    })

  const mayCreate = await currentUserCan('create', 'driver')
  const mayEdit = await currentUserCan('update', 'driver')
  const showCompany = companyCount > 1
  const warningNames = warningLabels(t)
  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })
  const dateOrDash = (value: Date | null) => (value ? day.format(value) : '—')

  // APPLIED AFTER THE WARNINGS ARE COMPUTED, because there is nothing in the
  // database to filter on — see the note where the flags are read.
  const attended = needsAttention
    ? rows.filter((row) => row.warnings.length > 0)
    : rows
  const chipped = dispatchParam
    ? attended.filter((row) => row.dispatch === dispatchParam)
    : attended

  // ── THE GRID CONTRACT (§7.1.3): filter → sort → paginate ─────────────
  const shape: ListShape<Row> = {
    searchText: (row) =>
      `${row.name} ${row.phone ?? ''} ${row.email ?? ''} ${row.truck ?? ''}`,
    sorts: {
      name: (row) => row.name,
      ready: (row) => (row.ready.ready ? 0 : 1),
      type: (row) => row.driverType,
      status: (row) => row.roster ?? row.dispatch,
      lastActivity: (row) => row.lastActivityAt?.getTime() ?? 0,
      company: (row) => row.companyName,
      phone: (row) => row.phone ?? '',
      truck: (row) => row.truck ?? '',
      terminated: (row) => row.terminationDate?.getTime() ?? 0,
      returns: (row) => row.offDutyUntil?.getTime() ?? 0,
    },
    // §6.2.1 — funnels that write the same parameter the filter bar renders as
    // a chip, so a narrowed grid stays a link somebody can send.
    columnFilters: {
      type: (row) => row.driverType,
      company: (row) => row.companyName,
      truck: (row) => row.truck,
    },
    defaultSort: 'name',
    defaultDir: 'asc',
  }
  const raw = params as RawParams
  const view = gridView(chipped, raw, shape, applyList)

  const funnelFor = (columnKey: string, header: string) => (
    <ColumnFunnel
      param={columnFilterParam(columnKey)}
      column={header}
      labels={{
        open: t('grid.filterColumn'),
        apply: t('grid.filterApply'),
        clear: t('grid.filterClear'),
      }}
    />
  )

  const columns: Column<Row>[] = [
    {
      key: 'name',
      header: t('drivers.name'),
      sortable: true,
      // No anchor: `Table` wraps the first cell in the row's stretched link.
      render: (row) => row.name,
    },
    {
      key: 'ready',
      header: t('drivers.ready'),
      sortable: true,
      render: (row) =>
        row.ready.ready ? (
          <StatusBadge tone="success" label={t('drivers.ready.yes')} />
        ) : (
          <span className="flex items-baseline gap-z1">
            <StatusBadge tone="warning" label={t('drivers.ready.no')} />
            {/* THE FIRST REASON, IN WORDS (§6.4): a red that does not say
             * why is a red people learn to ignore. */}
            <span className="text-xs text-ink-3">
              {t(`drivers.notReady.${row.ready.reason}` as MessageKey)}
            </span>
          </span>
        ),
    },
    {
      key: 'type',
      header: t('preview.driverType'),
      sortable: true,
      filterable: true,
      render: (row) => t(`drivers.type.${row.driverType}` as MessageKey),
    },
    {
      key: 'status',
      header: t('ref.status'),
      sortable: true,
      // ── ONE STATUS PER ROW (owner's ruling, 2026-09-21; §6.4) ─────────
      //
      // The DERIVED dispatch status — except where the roster says something
      // the freight cannot know: this person is on holiday, or gone. The tab
      // carries the employee status; this badge is the one answer per row.
      render: (row) =>
        row.isRetired ? (
          <span className="text-ink-3">{t('ref.retired')}</span>
        ) : row.roster !== null ? (
          <StatusBadge
            tone={DRIVER_TONE[row.roster]}
            label={t(driverStatusKey(row.roster))}
          />
        ) : (
          <StatusBadge
            tone={DISPATCH_TONE[row.dispatch]}
            variant="outlined"
            label={t(`dispatch.status.${row.dispatch}` as MessageKey)}
          />
        ),
    },
    {
      key: 'lastActivity',
      header: t('dispatch.lastActivity'),
      sortable: true,
      // NEVER IS A FACT, not a gap: a driver nobody has moved, filed a
      // document for, or assigned anything to.
      render: (row) =>
        row.lastActivityAt
          ? day.format(row.lastActivityAt)
          : t('dispatch.lastActivity.never'),
    },
    ...(showCompany
      ? [
          {
            key: 'company',
            header: t('ref.authority'),
            truncate: true,
            sortable: true,
            filterable: true,
            render: (row: Row) => row.companyName,
          } satisfies Column<Row>,
        ]
      : []),
    {
      key: 'phone',
      header: t('drivers.phone'),
      sortable: true,
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
      key: 'email',
      header: t('drivers.email'),
      render: (row) =>
        row.email ? (
          <a
            href={`mailto:${row.email}`}
            className="relative z-10 hover:text-accent"
          >
            {row.email}
          </a>
        ) : (
          '—'
        ),
    },
    {
      key: 'truck',
      header: t('loads.column.truck'),
      sortable: true,
      filterable: true,
      render: (row) => <span className="font-mono">{orDash(row.truck)}</span>,
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
    // THE TAB'S OWN DATE COLUMN (§6.4): Terminated prints when, Vacation board
    // prints the return. Outside the chooser's set, because the tab decides.
    ...(tab === 'terminated'
      ? [
          {
            key: 'terminated',
            header: t('drivers.terminatedOn'),
            sortable: true,
            render: (row: Row) => dateOrDash(row.terminationDate),
          } satisfies Column<Row>,
        ]
      : []),
    ...(tab === 'vacation'
      ? [
          {
            key: 'returns',
            header: t('drivers.returnsOn'),
            sortable: true,
            render: (row: Row) => dateOrDash(row.offDutyUntil),
          } satisfies Column<Row>,
        ]
      : []),
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
  // The tab's date column is always shown with the tab; the chooser governs
  // the declared set.
  const shownColumns = keepColumns(columns, [
    ...visible,
    'terminated',
    'returns',
  ])

  const search = new URLSearchParams(
    Object.entries(params).flatMap(([key, value]) =>
      value === undefined
        ? []
        : [[key, Array.isArray(value) ? (value[0] ?? '') : value]],
    ),
  )
  const keep = (over: Record<string, string | null>) => {
    const next = new URLSearchParams(search)
    for (const [key, value] of Object.entries(over)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    next.delete('page')
    return `/drivers?${next.toString()}`
  }

  const bulkLabels = {
    selected: t('grid.selected'),
    active: t('drivers.bulk.active'),
    vacation: t('drivers.bulk.vacation'),
    terminated: t('drivers.bulk.terminated'),
    clear: t('grid.clearSelection'),
    blocked: t('drivers.bulk.blocked'),
    done: t('drivers.bulk.done'),
  }
  const bulkReasons = {
    'drivers.error.notFound': t('drivers.error.notFound'),
    'drivers.error.removed': t('drivers.error.removed'),
  }

  const table = (
    <Table
      caption={t('drivers.title')}
      columns={shownColumns}
      rows={view.paged.rows}
      footRows={view.filtered}
      rowKey={(row) => row.id}
      rowHref={(row) => `/drivers/${row.id}`}
      funnelFor={funnelFor}
      sort={{
        key: view.sort.key,
        dir: view.sort.dir,
        hrefFor: view.sortFor('/drivers'),
        label: t('accounting.sortBy'),
      }}
      {...(mayEdit
        ? { selection: { name: 'driver', label: t('grid.select') } }
        : {})}
      // THE STRIPE FOLLOWS THE BADGE. A row reading "On vacation" beside a
      // stripe coloured from a status nothing renders is the two-answer
      // problem again, one pixel wide.
      stripeTone={(row) =>
        row.roster !== null
          ? DRIVER_TONE[row.roster]
          : DISPATCH_TONE[row.dispatch]
      }
      isCancelled={(row) => row.isRetired}
      totals={{
        label: pagedFooterLabel(
          t('accounting.total'),
          t('grid.rows'),
          view.paged,
        ),
      }}
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
  )

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

      {/* FIVE TABS, EACH A DIFFERENT QUESTION (§7.1.6, §6.4), counted by
       * COUNT(*). Switching tabs drops the page and the sort — each tab owns
       * its ordering. */}
      <Tabs
        tabs={DRIVER_TABS.map((key) => ({
          key,
          label: t(`drivers.tab.${key}` as MessageKey),
          count: counts[key],
        }))}
        active={tab}
        hrefFor={(key) => keep({ tab: key, sort: null, dir: null })}
        label={t('drivers.title')}
      />

      {/* §7.4 — pinned above the table, not behind a menu. One click. */}
      <SavedViews
        grid="drivers"
        views={savedViews}
        density={density}
        labels={{
          save: t('views.save'),
          name: t('views.name'),
          saveHint: t('views.saveHint'),
          remove: t('views.remove'),
          all: t('views.allDrivers'),
          cancel: t('ref.cancel'),
          density: t('density.label'),
          densities: DENSITIES.map((value) => ({
            value,
            label: t(`density.${value}` as never),
          })),
        }}
      />

      {/* THE CHIPS (§7.4): attention, the derived dispatch status, the removed
       * toggle. Every link keeps every other toggle — narrowing to the
       * available drivers should not silently widen the company or change the
       * tab. */}
      <div className="flex flex-wrap items-center gap-z4 border-b border-border bg-surface-2 px-gutter py-z2">
        <Link
          href={keep({ attention: needsAttention ? null : '1' })}
          className={
            needsAttention
              ? 'text-sm font-medium text-accent'
              : 'text-sm font-medium text-ink-2 hover:text-accent'
          }
        >
          {needsAttention ? t('warning.all') : t('warning.attention')}
        </Link>

        <span className="flex items-center gap-z2">
          <Link
            href={keep({ dispatch: null })}
            className={
              dispatchParam
                ? 'text-sm text-ink-2 hover:text-accent'
                : 'text-sm font-medium text-accent'
            }
          >
            {t('dispatch.status.all')}
          </Link>
          {DISPATCH_FILTERS.map((name) => (
            <Link
              key={name}
              href={keep({ dispatch: name })}
              className={
                dispatchParam === name
                  ? 'text-sm font-medium text-accent'
                  : 'text-sm text-ink-2 hover:text-accent'
              }
            >
              {t(`dispatch.status.${name}` as MessageKey)}
            </Link>
          ))}
        </span>

        <Link
          href={keep({ removed: showRetired ? null : '1' })}
          className="text-sm font-medium text-ink-2 hover:text-accent"
        >
          {showRetired ? t('ref.hideRetired') : t('ref.showRetired')}
        </Link>

        {/* No export (§6.4, §7.1.7): the chooser alone, like /trucks. */}
        <div className="ms-auto">
          <ColumnsChooser
            grid="drivers.drivers"
            columns={columns
              .filter(
                (column) =>
                  column.key !== 'terminated' && column.key !== 'returns',
              )
              .map((column) => ({
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

      {mayEdit ? (
        <BulkRoster labels={bulkLabels} reasons={bulkReasons}>
          {table}
        </BulkRoster>
      ) : (
        table
      )}

      <GridFooterNav
        paged={view.paged}
        per={view.params.per}
        path="/drivers"
        search={search}
        hrefForPage={view.hrefForPage('/drivers')}
        labels={{
          of: t('grid.of'),
          previous: t('grid.previous'),
          next: t('grid.next'),
          perPage: t('grid.perPage'),
        }}
      />

      {/* THE DATA-HEALTH ROW (§6.5 part 0b): five counts over active people,
       * each a link to this list filtered by the same definition, with the
       * tab and the other filters kept. Zero is shown. */}
      <DataHealthRow
        checks={DRIVER_HEALTH_CHECKS}
        counts={health}
        active={missing}
        hrefFor={(check) => keep({ missing: check })}
        labels={{
          title: t('drivers.health.title'),
          all: t('drivers.health.all'),
          check: (check) => t(`drivers.health.${check}` as MessageKey),
        }}
      />

      {/* THE CAP, SAID IN WORDS (§6.4): the tab selected more than the page
       * read, and the rest exist. */}
      {rows.length >= PAGE_CAP ? (
        <p className="border-t border-border bg-warning-soft px-gutter py-z2 text-xs text-ink-2">
          {t('drivers.capped').replace('{n}', String(PAGE_CAP))}
        </p>
      ) : null}
    </>
  )
}
