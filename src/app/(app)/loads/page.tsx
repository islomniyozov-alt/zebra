import Link from 'next/link'
import { loadWarningFacts, loadWarnings } from '@/lib/warnings'
import { warningLabels } from '@/components/WarningCell'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { Button } from '@/components/ui/Button'
import { getLocaleContext } from '@/lib/locale'
import type { MessageKey } from '@/lib/i18n'
import { companyScopeFilter } from '@/lib/tenancy'
import { listedAuthorities } from '@/lib/companies'
import { FilterBar } from '@/components/ui/FilterBar'
import { LoadsTable, type LoadRow } from './LoadsTable'
import { billingLabelKey, operationalLabelKey } from '@/lib/status'
import { viewContext } from '@/lib/load-views'
import {
  billingCountWhere,
  listWhere,
  loadListWhere,
  readLoadListParams,
  READY,
  readyCountWhere,
  statusCountWhere,
  viewCountWhere,
} from '@/lib/load-list'
import { loadFilterLabels } from '@/lib/load-filter-options'
import { renderDateOnly, stopLocalDate } from '@/lib/stop-time'
import { DENSITIES, readDensity, readSavedViews } from '@/lib/preferences'
import { readGridColumns } from '@/lib/grid-columns'
import {
  columnKeysFor,
  LOAD_COLUMN_KEYS,
  LOAD_COLUMNS_HIDDEN,
} from '@/lib/list-columns'
import { SavedViews } from './SavedViews'
import { ColumnsChooser } from '../_grid/ColumnsChooser'
import { DateRangeView } from './DateRangeView'
import { TypeaheadFilter } from './TypeaheadFilter'
import type {
  LoadBillingStatus,
  LoadOperationalStatus,
} from '@/generated/prisma/client'

// §11.7 — the screen that proves the rest of it works. Real shell, real table,
// real filter bar, real empty state. No data, no create action.
//
// It reads through `withCurrentOrg`, so the query is scoped by row-level
// security and the permission check happened before the query did. ESLint
// refuses `withOrg` and `prisma` under src/app, so there is no shorter path.
//
// §6.7 (2026-10-08) gave it Datatruck's shape: date views, broker and driver
// filters, linked cells, a copy button, a DEL date column, and Upcoming and
// Unpaid. EVERY FILTER IS BUILT IN `src/lib/load-list.ts`, as one `AND`, so
// the rows, the footer and every chip count read one definition.

/**
 * The chooser's labels, keyed by column (§7.1.7).
 *
 * TYPED AGAINST `LOAD_COLUMN_KEYS`, so a column added to the list and not to this
 * map is a type error rather than a checkbox labelled `undefined`. The headers
 * themselves are the same message keys `LoadsTable` uses for the `<th>`, because
 * a chooser that named a column differently from the table would be a puzzle.
 */
const loadColumnHeaders = (
  t: (key: MessageKey) => string,
): Record<(typeof LOAD_COLUMN_KEYS)[number], string> => ({
  loadNumber: t('loads.column.load'),
  company: t('loads.column.company'),
  customer: t('loads.column.customer'),
  driver: t('loads.column.driver'),
  pickup: t('loads.column.pickup'),
  delivery: t('loads.column.delivery'),
  deliveryDate: t('loads.column.deliveryDate'),
  truck: t('loads.column.truck'),
  status: t('loads.column.status'),
  billing: t('loads.column.billing'),
  rate: t('loads.column.rate'),
  warnings: t('warning.column'),
})

export default async function LoadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams

  // ── PAGINATION, BECAUSE THE HISTORY IS 14,451 ROWS ──────────────────────
  //
  // The list has always taken 100. That was a sensible cap on a screen holding
  // a few weeks of freight and it became a ceiling the moment a year of
  // Datatruck history landed: the newest hundred, and no way to reach load
  // 101. A cap without a next page is not a cap, it is a truncation nobody is
  // told about.
  //
  // OFFSET, NOT A CURSOR. `orderBy bookedAt desc` over a stable historical set
  // is exactly where offset paging is honest — the rows do not shift under the
  // reader, because the freight that would shift them stopped moving a year
  // ago. A cursor would be the right answer for an infinite live feed and is
  // more machinery than this screen has a reason for.
  const PAGE_SIZE = 100
  const pageParam = Number(
    typeof params['page'] === 'string' ? params['page'] : '1',
  )
  const page =
    Number.isFinite(pageParam) && pageParam >= 1 ? Math.floor(pageParam) : 1

  /** Every current parameter, with `page` replaced. Filters must survive. */
  const pageHref = (to: number) => {
    const next = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (key === 'page') continue
      if (typeof value === 'string' && value !== '') next.set(key, value)
    }
    if (to > 1) next.set('page', String(to))
    return next.toString()
  }
  const { t, locale } = await getLocaleContext()

  // ── THE URL, READ ONCE ──────────────────────────────────────────────────
  //
  // `?view=` is a NAME resolved through `load-views.ts` (owner's ruling,
  // 2026-10-01): the dashboard's Needs-you rows link here by name, and the
  // number on the row and the rows on this page come from one predicate. NO
  // VIEW MEANS TODAY'S BEHAVIOUR, archive included (ruling 3).
  //
  // THE BILLING CHIPS NEVER FILTERED ANYTHING until the counts went in, because
  // the query only read `status` and `company`. A count has to come from the
  // query the chip runs, which is why every chip now reads `load-list.ts`.
  const listParams = readLoadListParams(params)

  const {
    rows,
    matching,
    authorities,
    companyCount,
    savedViews,
    density,
    visibleLoadColumns,
    statusCounts,
    billingCounts,
    viewCounts,
    filterLabels,
  } = await withCurrentOrg('read', 'load', async (tx, session) => {
    // Company scoping is a business filter in the app layer, not a security
    // boundary — the tenant wall is already in Postgres. An empty scope list
    // means every authority in the organization.
    const scope = companyScopeFilter(session.companyScopes)

    // THE AUTHORITIES THIS VIEWER MAY NARROW TO — fetched here since
    // 2026-09-06, where the narrowing lives, rather than in the app layout on
    // every page of the shell. Active companies, restricted to the viewer's own
    // scope when they have one — the rule every authority list reads. Their
    // zones also decide "today" for the date views (§6.7).
    const authorities = await listedAuthorities(tx, session.companyScopes)
    const companyCount = authorities.length
    const ctx = viewContext(authorities, new Date())

    const where = loadListWhere(listParams, scope, ctx)

    // The total under the CURRENT filter, so the footer can say "101–200 of
    // 2,156" rather than leaving somebody to guess whether there is more.
    // THE SAME WHERE THE ROWS USE, named view included: "1-50 of 13,500" over a
    // list of 101 rows is the disagreement the named views exist to stop.
    const matching = await tx.load.count({ where: listWhere(where) })

    const loads = await tx.load.findMany({
      where: listWhere(where),
      orderBy: { bookedAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        loadNumber: true,
        // The number dispatch quotes to Amazon. Shown under the load number
        // rather than in a column of its own — see LoadsTable.
        referenceNumber: true,
        isCancelled: true,
        operationalStatus: true,
        billingStatus: true,
        // §7 — a field a role cannot see is absent from the payload, never
        // hidden in CSS. Rate is here because `read load` implies the board;
        // margin and driver pay are separate resources and are not selected.
        linehaulCents: true,
        // The zone dates a stop that has no state (§6.7, `renderStopTime`).
        company: { select: { name: true, timezone: true } },
        customer: { select: { id: true, name: true } },
        driver: { select: { id: true, firstName: true, lastName: true } },
        coDriver: { select: { id: true, firstName: true, lastName: true } },
        truck: { select: { id: true, unitNumber: true } },
        stops: {
          orderBy: { sequence: 'asc' },
          // `name` IS SELECTED BECAUSE SOME STOPS HAVE NOTHING ELSE. See
          // `place` below.
          select: {
            name: true,
            city: true,
            state: true,
            type: true,
            scheduledAt: true,
            windowStart: true,
          },
        },
      },
    })

    const money = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })

    // CITY AND STATE FIRST, THE STOP'S OWN NAME WHEN IT HAS NEITHER.
    //
    // The Relay board export carries no addresses at all — it names facilities
    // and clocks — so its stops land with `name` set to the facility code and
    // `city`/`state` null. This column read only the two null fields, joined
    // them to the empty string, and rendered BLANK on every imported load. The
    // first real production import was reported as "did the stops write?", and
    // they had: the load detail screen has always fallen back to `stop.name`
    // and showed the codes the whole time.
    //
    // TWO SCREENS DISAGREEING ABOUT ONE ROW is the actual defect, so this is
    // now the same expression the detail uses. Read-side on purpose: the
    // `Location` a stop links to already owns city and state, and copying them
    // onto the stop at write time would be a duplicate free to drift.
    //
    // AN ABSENT STOP IS STILL AN EM-DASH, and that distinction is what
    // diagnosed this: blank meant a stop existed with nothing to print, while
    // a missing pickup would have printed '—'.
    const place = (
      stop:
        | { name: string | null; city: string | null; state: string | null }
        | undefined,
    ) => {
      if (!stop) return '—'
      const address = [stop.city, stop.state].filter(Boolean).join(', ')
      return address || stop.name || '—'
    }

    // ONE QUERY FOR THE PAGE. The loads list is the one that matters: a
    // fan-out here would be PAGE_SIZE round trips on the screen a
    // dispatcher reloads all morning.
    const warningFacts = await loadWarningFacts(
      tx,
      loads.map((load) => load.id),
    )
    const now = new Date()

    const rows: LoadRow[] = loads.map((load) => {
      const finalDelivery = [...load.stops]
        .reverse()
        .find((stop) => stop.type === 'DELIVERY')
      // THE DAY THE DATE VIEWS READ (§6.7 item 5): the stop's own local date,
      // in the zone `renderStopTime` would use, so a row never sits in a view
      // its own DEL date contradicts.
      const deliveryDay = finalDelivery
        ? stopLocalDate(
            finalDelivery.scheduledAt ?? finalDelivery.windowStart,
            finalDelivery.state,
            load.company.timezone,
          )
        : null
      return {
        id: load.id,
        loadNumber: load.loadNumber,
        reference: load.referenceNumber,
        companyName: load.company.name,
        customerId: load.customer.id,
        customerName: load.customer.name,
        drivers: [load.driver, load.coDriver]
          .filter((seat) => seat !== null)
          .map((seat) => ({
            id: seat.id,
            name: `${seat.firstName} ${seat.lastName}`.trim(),
          })),
        pickup: place(load.stops.find((stop) => stop.type === 'PICKUP')),
        delivery: place(finalDelivery),
        deliveryDate:
          deliveryDay === null
            ? '—'
            : (renderDateOnly(new Date(`${deliveryDay}T00:00:00Z`), locale) ??
              '—'),
        truckId: load.truck?.id ?? null,
        truck: load.truck?.unitNumber ?? '—',
        operationalStatus: load.operationalStatus,
        billingStatus: load.billingStatus,
        // Money is an integer of cents everywhere until the moment it is read.
        rate: money.format(load.linehaulCents / 100),
        isCancelled: load.isCancelled,
        warnings: warningFacts.has(load.id)
          ? loadWarnings(warningFacts.get(load.id)!, now)
          : [],
      }
    })

    // THE COUNTS, from the same `where` the chips filter by. Each group
    // ignores its OWN filter and honours every other, the view included —
    // so clicking a chip lands on exactly the number it promised.
    //
    // Upcoming and Unpaid are the only views counted (§6.7): a count on every
    // date preset would be three more statements on the screen a dispatcher
    // reloads all morning, and the 200ms-per-statement link to Neon is what
    // makes that expensive.
    const [
      statusCounts,
      billingCounts,
      readyCount,
      upcomingCount,
      unpaidCount,
      filterLabels,
    ] = await Promise.all([
      tx.load.groupBy({
        by: ['operationalStatus'],
        where: statusCountWhere(where),
        _count: { _all: true },
      }),
      tx.load.groupBy({
        by: ['billingStatus'],
        where: billingCountWhere(where),
        _count: { _all: true },
      }),
      // This chip's predicate is not a column, so `groupBy` cannot produce it.
      tx.load.count({ where: readyCountWhere(where) }),
      tx.load.count({ where: viewCountWhere(where, 'upcoming', ctx) }),
      tx.load.count({ where: viewCountWhere(where, 'unpaid', ctx) }),
      // Only what is set is read: nothing at all when neither filter is on.
      listParams.customer || listParams.driver
        ? loadFilterLabels(tx, {
            customer: listParams.customer,
            driver: listParams.driver,
          })
        : Promise.resolve({ customer: null, driver: null }),
    ])

    const savedViews = await readSavedViews(tx, session.userId, 'loads')
    const density = await readDensity(tx, session.userId)
    // §7.1.7, in the same transaction as the two preference reads above it.
    const visibleLoadColumns = await readGridColumns(
      tx,
      session.userId,
      'loads.loads',
      columnKeysFor(LOAD_COLUMN_KEYS, companyCount > 1),
      LOAD_COLUMNS_HIDDEN,
    )

    return {
      rows,
      matching,
      authorities,
      companyCount,
      savedViews,
      density,
      visibleLoadColumns,
      statusCounts: Object.fromEntries(
        statusCounts.map((row) => [row.operationalStatus, row._count._all]),
      ) as Record<string, number>,
      billingCounts: {
        ...Object.fromEntries(
          billingCounts.map((row) => [row.billingStatus, row._count._all]),
        ),
        [READY]: readyCount,
      } as Record<string, number>,
      viewCounts: { upcoming: upcomingCount, unpaid: unpaidCount },
      filterLabels,
    }
  })

  // Every value, so a row in any state has a word next to its colour —
  // never colour alone (standing rule 5).
  const ALL_OPERATIONAL: LoadOperationalStatus[] = [
    'AVAILABLE',
    'BOOKED',
    'DISPATCHED',
    'AT_PICKUP',
    'LOADED',
    'IN_TRANSIT',
    'AT_DELIVERY',
    'DELIVERED',
    'POD_RECEIVED',
  ]
  const ALL_BILLING: LoadBillingStatus[] = [
    'UNINVOICED',
    'READY_TO_INVOICE',
    'INVOICED',
    'PARTIALLY_PAID',
    'PAID',
    'DISPUTED',
    'WRITTEN_OFF',
    // Imported history. It appears in the filter because a year of Datatruck
    // freight is the largest thing on this screen and has to be narrowable to.
    'CLOSED_IN_DATATRUCK',
  ]

  const [mayCreate, mayOpenCustomer, mayOpenDriver, mayOpenTruck] =
    await Promise.all([
      currentUserCan('create', 'load'),
      currentUserCan('read', 'customer'),
      currentUserCan('read', 'driver'),
      currentUserCan('read', 'truck'),
    ])

  const statuses: LoadOperationalStatus[] = [
    'BOOKED',
    'IN_TRANSIT',
    'DELIVERED',
    'POD_RECEIVED',
  ]
  // READY_TO_INVOICE first: it is the biggest bucket on a working board —
  // eight of thirteen rows the day the counts went in — and a filter bar that
  // cannot reach its own largest group is a bar nobody uses. PARTIALLY_PAID
  // was the other one the counts exposed as missing.
  const billing: string[] = [
    READY,
    'UNINVOICED',
    'INVOICED',
    'PARTIALLY_PAID',
    'PAID',
  ]

  const headers = loadColumnHeaders(t)

  return (
    <>
      {/* Page title, then the filter bar directly under it — never in a
       * drawer (§7.4). */}
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="text-lg font-medium text-ink">{t('loads.title')}</h1>
        <div className="flex items-center gap-z3">
          {/* §2 — one meaning per screen, stated in the screen's header. */}
          <p className="text-xs text-ink-3">{t('loads.stripeMeaning')}</p>
          {mayCreate ? (
            <Link href="/loads/new">
              <Button variant="primary" size="compact">
                {t('loads.add')}
              </Button>
            </Link>
          ) : null}
          {/* §7.1.7's chooser, IN THE HEADER THAT IS ALREADY THERE. A bar of
           * its own would cost a row of freight on a 1080p screen, which
           * standing rule 1 forbids — and this page already carries two bars.
           * /trucks puts it in its filter row for the same reason. */}
          <ColumnsChooser
            grid="loads.loads"
            columns={columnKeysFor(LOAD_COLUMN_KEYS, companyCount > 1).map(
              (key) => ({ key, header: headers[key] }),
            )}
            visible={visibleLoadColumns}
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

      {/* §7.4 — pinned above the table, not behind a menu. One click. */}
      <SavedViews
        grid="loads"
        views={savedViews}
        density={density}
        labels={{
          save: t('views.save'),
          name: t('views.name'),
          saveHint: t('views.saveHint'),
          remove: t('views.remove'),
          all: t('views.all'),
          cancel: t('ref.cancel'),
          density: t('density.label'),
          densities: DENSITIES.map((value) => ({
            value,
            label: t(`density.${value}` as never),
          })),
        }}
      />

      <FilterBar
        clearLabel={t('loads.filter.clear')}
        moreLabel={t('loads.filter.more')}
        // The typeaheads and the range write these keys themselves; naming them
        // here is what offers "Clear filters" when only they are set.
        extraParams={['view', 'from', 'to', 'customer', 'driver']}
        groups={[
          {
            param: 'status',
            label: t('loads.filter.status'),
            choices: statuses.map((status) => ({
              value: status,
              label: t(operationalLabelKey(status)),
              // A chip with a number is information; without one it is
              // furniture. Zero is a real answer and is shown — "Delivered (0)"
              // tells a dispatcher the day is clear, where a missing chip
              // would just look like a filter that vanished.
              count: statusCounts[status] ?? 0,
            })),
          },
          // §6.7 item 6 — two VIEWS beside the status chips, counted from the
          // same `viewWhere` the list resolves `?view=` through. They share
          // `?view=` with the date presets, so choosing one clears the other.
          {
            id: 'queue',
            param: 'view',
            label: t('loads.filter.queue'),
            choices: (['upcoming', 'unpaid'] as const).map((name) => ({
              value: name,
              label: t(`loads.view.${name}`),
              count: viewCounts[name],
            })),
          },
          {
            param: 'billing',
            label: t('loads.filter.billing'),
            choices: billing.map((status) => ({
              value: status,
              label: t(billingLabelKey(status as LoadBillingStatus)),
              count: billingCounts[status] ?? 0,
            })),
          },
          // §6.7 item 1 — the two date presets, OFFERED, not pre-selected:
          // `/loads` with no view still lists everything (ruling 3). No counts,
          // like the authority chips: a narrowing, not a report.
          {
            id: 'dates',
            param: 'view',
            label: t('loads.filter.dates'),
            choices: (['picksUpToday', 'deliversThisWeek'] as const).map(
              (name) => ({ value: name, label: t(`loads.view.${name}`) }),
            ),
          },
          // AUTHORITY, WHICH USED TO LIVE IN THE TOPBAR (2026-09-06). It was a
          // filter there too — it only ever wrote `?company=` — so this is the
          // same narrowing on the screen that has a filter bar, rather than at
          // the top of every screen in the application.
          //
          // ONLY WHEN THERE IS A CHOICE TO MAKE. A single-authority carrier
          // gets no group at all, which is the rule the topbar had and the one
          // worth keeping: a filter offering one option is furniture.
          //
          // NO COUNTS ON THESE CHIPS, deliberately. A chip with no number is
          // honest about being a narrowing rather than a report.
          ...(authorities.length > 1
            ? [
                {
                  param: 'company',
                  label: t('loads.filter.authority'),
                  choices: authorities.map((company) => ({
                    value: company.id,
                    label: company.name,
                  })),
                },
              ]
            : []),
        ]}
        search={{
          param: 'ref',
          label: t('loads.filter.reference'),
          placeholder: t('loads.filter.referencePlaceholder'),
        }}
      >
        <DateRangeView
          labels={{
            label: t('loads.filter.range'),
            pickup: t('loads.filter.range.pickup'),
            delivery: t('loads.filter.range.delivery'),
            from: t('loads.filter.range.from'),
            to: t('loads.filter.range.to'),
          }}
        />
        <TypeaheadFilter
          param="customer"
          selectedLabel={filterLabels.customer}
          labels={{
            label: t('loads.filter.broker'),
            placeholder: t('loads.filter.brokerPlaceholder'),
            loading: t('loads.filter.optionsLoading'),
            noMatch: t('loads.filter.optionsNone'),
            failed: t('loads.filter.optionsFailed'),
            clear: t('loads.filter.clearOne'),
          }}
        />
        <TypeaheadFilter
          param="driver"
          selectedLabel={filterLabels.driver}
          labels={{
            label: t('loads.filter.driver'),
            placeholder: t('loads.filter.driverPlaceholder'),
            loading: t('loads.filter.optionsLoading'),
            noMatch: t('loads.filter.optionsNone'),
            failed: t('loads.filter.optionsFailed'),
            clear: t('loads.filter.clearOne'),
          }}
        />
      </FilterBar>

      <LoadsTable
        rows={rows}
        // §6.3 as amended: the company column exists only where there is more
        // than one authority to tell apart.
        showCompanyColumn={companyCount > 1}
        // §7.1.7. DECIDED HERE, not in the client component: the preference row
        // is here, and so is the cap that keeps the count under §7.1's nine.
        visible={visibleLoadColumns}
        mayOpen={{
          customer: mayOpenCustomer,
          driver: mayOpenDriver,
          truck: mayOpenTruck,
        }}
        statusLabels={Object.fromEntries(
          ALL_OPERATIONAL.map((status) => [
            status,
            t(operationalLabelKey(status)),
          ]),
        )}
        billingLabels={Object.fromEntries(
          ALL_BILLING.map((status) => [status, t(billingLabelKey(status))]),
        )}
        labels={{
          caption: t('loads.title'),
          warnings: t('warning.column'),
          warningCount: t('warning.count'),
          warningClear: t('warning.clear'),
          warningNames: warningLabels(t),
          load: t('loads.column.load'),
          reference: t('loads.column.reference'),
          company: t('loads.column.company'),
          customer: t('loads.column.customer'),
          driver: t('loads.column.driver'),
          pickup: t('loads.column.pickup'),
          delivery: t('loads.column.delivery'),
          deliveryDate: t('loads.column.deliveryDate'),
          truck: t('loads.column.truck'),
          status: t('loads.column.status'),
          billing: t('loads.column.billing'),
          rate: t('loads.column.rate'),
          copy: t('loads.copyNumber'),
          copied: t('loads.copiedNumber'),
          copyFailed: t('loads.copyFailed'),
          emptyTitle: t('loads.empty.title'),
          emptyBody: t('loads.empty.body'),
          emptyFilteredTitle: t('loads.emptyFiltered.title'),
          emptyFilteredBody: t('loads.emptyFiltered.body'),
          clearFilters: t('loads.filter.clear'),
        }}
      />

      {/* ── THE PAGER ────────────────────────────────────────────────────
       *
       * Rendered only when there is a second page, so a carrier with forty
       * loads never sees paging furniture. It carries EVERY current parameter
       * forward — filters, search, saved view — because a next button that
       * silently drops the filter is worse than no next button.
       *
       * Real anchors rather than buttons: middle-click opens a tab, the
       * keyboard reaches them in tab order, and the URL is shareable. Same
       * reason `Table` uses `rowHref`. */}
      {matching > PAGE_SIZE ? (
        <nav
          aria-label={t('loads.pager.label')}
          className="flex items-center justify-between gap-z3 border-t border-border px-gutter py-z3"
        >
          <p className="text-sm text-ink-2">
            {t('loads.pager.range')
              .replace('{from}', String((page - 1) * PAGE_SIZE + 1))
              .replace('{to}', String(Math.min(page * PAGE_SIZE, matching)))
              .replace('{total}', matching.toLocaleString())}
          </p>
          <div className="flex items-center gap-z4">
            {page > 1 ? (
              <Link
                href={`/loads?${pageHref(page - 1)}`}
                className="text-sm font-medium text-accent hover:underline"
              >
                {t('loads.pager.previous')}
              </Link>
            ) : (
              <span className="text-sm text-ink-3">
                {t('loads.pager.previous')}
              </span>
            )}
            {page * PAGE_SIZE < matching ? (
              <Link
                href={`/loads?${pageHref(page + 1)}`}
                className="text-sm font-medium text-accent hover:underline"
              >
                {t('loads.pager.next')}
              </Link>
            ) : (
              <span className="text-sm text-ink-3">
                {t('loads.pager.next')}
              </span>
            )}
          </div>
        </nav>
      ) : null}
    </>
  )
}
