import Link from 'next/link'
import { notFound } from 'next/navigation'
import { warningLabels } from '@/components/WarningCell'
import {
  currentUserCan,
  readCurrentOrg,
  withCurrentOrg,
} from '@/lib/auth-context'
import { Button } from '@/components/ui/Button'
import { getLocaleContext } from '@/lib/locale'
import type { MessageKey } from '@/lib/i18n'
import { Tabs } from '@/components/ui/Tabs'
import { LoadsTable, type LoadRow } from './LoadsTable'
import { billingLabelKey, loadStatusWordKey } from '@/lib/status'
import { readLoadListParams } from '@/lib/load-list'
import { LOADS_GRID, readLoadListData } from '@/lib/load-list-page'
import { documentsLabel } from '@/lib/load-list-rows'
import { isLoadTab, LOAD_TABS } from '@/lib/load-tabs'
import { renderDateOnly } from '@/lib/stop-time'
import { DENSITIES } from '@/lib/preferences'
import {
  gridColumnCap,
  gridColumnsFromRow,
  readGridColumns,
} from '@/lib/grid-columns'
import {
  columnKeysFor,
  LOAD_COLUMN_KEYS,
  LOAD_COLUMNS_HIDDEN,
} from '@/lib/list-columns'
import { ColumnsChooser } from '../_grid/ColumnsChooser'
import { DensityControl } from './DensityControl'
import { LoadFilters } from './LoadFilters'
import { DateRangeFilter } from './ToolbarControls'
import { SearchBox } from '@/components/ui/SearchBox'
import { AuthorityFilter } from '../_grid/AuthorityFilter'
import type {
  LoadBillingStatus,
  LoadOperationalStatus,
} from '@/generated/prisma/client'

// §11.7 — the screen that proves the rest of it works. Real shell, real table,
// real filter bar, real empty state.
//
// It reads through `withCurrentOrg`, so the query is scoped by row-level
// security and the permission check happened before the query did. ESLint
// refuses `withOrg` and `prisma` under src/app, so there is no shorter path.
//
// §6.7 gave it Datatruck's shape, and the second pass (owner's brief
// 2026-11-16) the rest of it: six tabs with counts, one toolbar row, nothing
// else above the table. WHAT IT READS IS `readLoadListData` in
// `src/lib/load-list-page.ts`: the rows, and every count from ONE grouped
// statement (chain two, 2026-10-09). The page renders.

/**
 * The chooser's labels, keyed by column (§7.1.7).
 *
 * TYPED AGAINST `LOAD_COLUMN_KEYS`, so a column added to the list and not to this
 * map is a type error rather than a checkbox labelled `undefined`.
 */
const loadColumnHeaders = (
  t: (key: MessageKey) => string,
): Record<(typeof LOAD_COLUMN_KEYS)[number], string> => ({
  loadNumber: t('loads.column.load'),
  reference: t('loads.column.reference'),
  trailer: t('loads.column.trailer'),
  documents: t('loads.column.documents'),
  company: t('loads.column.company'),
  customer: t('loads.column.customer'),
  pickup: t('loads.column.pickup'),
  delivery: t('loads.column.delivery'),
  deliveryDate: t('loads.column.deliveryDate'),
  driver: t('loads.column.driver'),
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
  // OFFSET, NOT A CURSOR. `orderBy bookedAt desc` over a stable historical set
  // is exactly where offset paging is honest — the rows do not shift under the
  // reader, because the freight that would shift them stopped moving a year
  // ago.
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

  // THE URL, READ ONCE. `?view=` is a NAME resolved through `load-views.ts`
  // (owner's ruling, 2026-10-01); no view means today's behaviour, archive
  // included (ruling 3).
  const listParams = readLoadListParams(params)

  // §6.8: a role without the read is REFUSED as a 404, never a 500 (sweep).
  if (!(await currentUserCan('read', 'load'))) notFound()

  /** The same query string, for the export: the file is this view. */
  const exportQuery = pageHref(1)

  const [
    mayCreate,
    mayOpenCustomer,
    mayOpenDriver,
    mayOpenTruck,
    mayOpenTrailer,
    mayUpload,
  ] = await Promise.all([
    currentUserCan('create', 'load'),
    currentUserCan('read', 'customer'),
    currentUserCan('read', 'driver'),
    currentUserCan('read', 'truck'),
    currentUserCan('read', 'trailer'),
    currentUserCan('create', 'document'),
  ])

  // TWO CALLS THROUGH THE TENANT READER, NO TRANSACTION (§6.7 v11.10): the
  // authorities, preferences and labels, then the rows, warnings and chips
  // bounded by the day the first names.
  const {
    rows: listRows,
    counts,
    authorities,
    filterLabels,
    density,
    visibleLoadColumns,
  } = await readCurrentOrg('read', 'load', async (reader, session) => {
    const data = await readLoadListData(
      reader,
      session.companyScopes,
      listParams,
      {
        page,
        pageSize: PAGE_SIZE,
        now: new Date(),
        locale,
        userId: session.userId,
      },
    )
    // §7.1.7, from the head's stored row. A transaction opens only when that
    // row is the legacy shape and is rewritten once (§6.7).
    const available = columnKeysFor(
      LOAD_COLUMN_KEYS,
      data.authorities.length > 1,
    )
    const plan = gridColumnsFromRow(
      LOADS_GRID,
      available,
      LOAD_COLUMNS_HIDDEN,
      data.columnsRow,
    )
    const visibleLoadColumns = plan.rewrite
      ? await withCurrentOrg('read', 'load', (tx) =>
          readGridColumns(
            tx,
            session.userId,
            LOADS_GRID,
            available,
            LOAD_COLUMNS_HIDDEN,
            { row: data.columnsRow },
          ),
        )
      : plan.visible
    return { ...data, visibleLoadColumns }
  })

  const companyCount = authorities.length
  const matching = counts.matching

  const money = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  // FORMATTED FOR A PERSON HERE; the export writes the same rows as codes.
  const rows: LoadRow[] = listRows.map((row) => ({
    id: row.id,
    loadNumber: row.loadNumber,
    reference: row.reference,
    companyName: row.companyName,
    customerId: row.customerId,
    customerName: row.customerName,
    drivers: row.drivers,
    pickup: row.pickup,
    delivery: row.delivery,
    pickupZip: row.pickupZip,
    deliveryZip: row.deliveryZip,
    deliveryDate:
      row.deliveryDay === null
        ? '—'
        : (renderDateOnly(new Date(`${row.deliveryDay}T00:00:00Z`), locale) ??
          '—'),
    truckId: row.truckId,
    truck: row.truck ?? '—',
    trailerId: row.trailerId,
    trailer: row.trailer ?? '—',
    documents: documentsLabel(row.documents),
    operationalStatus: row.operationalStatus,
    statusWord: row.statusWord,
    billingStatus: row.billingStatus,
    // Money is an integer of cents everywhere until the moment it is read.
    rate: money.format(row.linehaulCents / 100),
    isCancelled: row.isCancelled,
    warnings: row.warnings,
    stops: row.stops,
    // §6.7 item 8: only where a POD can still matter. Nothing here sets POD
    // received — the link opens the upload, and a confirmed POD does the rest.
    attachPod:
      mayUpload &&
      !row.isCancelled &&
      !row.directSettled &&
      row.operationalStatus !== 'POD_RECEIVED',
  }))

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
    'CLOSED_IN_DATATRUCK',
  ]

  // ── THE SIX TABS (§6.7, the second pass) ─────────────────────────────
  //
  // A tab keeps every filter and drops the page; All loads is no `?tab=`.
  const activeTab = isLoadTab(listParams.tab) ? listParams.tab : 'all'
  const tabHref = (key: string) => {
    const next = new URLSearchParams(pageHref(1))
    if (key === 'all') next.delete('tab')
    else next.set('tab', key)
    return next.size > 0 ? `/loads?${next}` : '/loads'
  }

  const headers = loadColumnHeaders(t)
  const typeahead = (which: 'broker' | 'driver') => ({
    label: t(`loads.filter.${which}`),
    placeholder: t(`loads.filter.${which}Placeholder`),
    loading: t('loads.filter.optionsLoading'),
    noMatch: t('loads.filter.optionsNone'),
    failed: t('loads.filter.optionsFailed'),
    clear: t('loads.filter.clearOne'),
  })

  const range = (which: 'pickup' | 'delivery') => ({
    label: t(
      which === 'pickup'
        ? 'loads.filter.pickupDate'
        : 'loads.filter.deliveryDate',
    ),
    from: t('loads.filter.range.from'),
    to: t('loads.filter.range.to'),
    clear: t('loads.filter.range.clear'),
  })

  return (
    <>
      {/* THE TITLE IS THE BREADCRUMB'S (§6.7, the second pass): nothing above
       * the table but the tabs and one toolbar row, so the heading is spoken
       * and not drawn. */}
      <h1 className="sr-only">{t('loads.title')}</h1>

      {/* SIX TABS, EACH WITH ITS COUNT, from the one grouped statement. Zero
       * is shown: "Dispatched 0" says the board is clear. New load sits at
       * the row's end, the page's one action. */}
      <Tabs
        label={t('loads.tabs')}
        active={activeTab}
        hrefFor={tabHref}
        tabs={(['all', ...LOAD_TABS] as const).map((key) => ({
          key,
          label: t(`loads.tab.${key}`),
          count: counts.tabs[key],
        }))}
        trailing={
          mayCreate ? (
            <Link href="/loads/new">
              <Button variant="primary" size="compact">
                {t('loads.add')}
              </Button>
            </Link>
          ) : null
        }
      />

      {/* ONE TOOLBAR ROW, in the brief's order: Filter · Pickup date ·
       * Delivery date · Reference search · Authority · Export · Density ·
       * Columns. Never in a drawer (§7.4); Clear filters is inside Filter. */}
      <div
        data-filter-bar
        className="flex flex-wrap items-center gap-z2 border-b border-border bg-surface px-gutter py-z2"
      >
        <LoadFilters
          selected={filterLabels}
          labels={{
            open: t('loads.filter.filter'),
            dates: t('loads.filter.dates'),
            picksUpToday: t('loads.view.picksUpToday'),
            deliversThisWeek: t('loads.view.deliversThisWeek'),
            clear: t('loads.filter.clear'),
            broker: typeahead('broker'),
            driver: typeahead('driver'),
          }}
        />
        <DateRangeFilter which="pickup" labels={range('pickup')} />
        <DateRangeFilter which="delivery" labels={range('delivery')} />
        {/* THE ONE SEARCH BOX (§7.4, v11.52), on `?ref=` as before. */}
        <SearchBox
          param="ref"
          label={t('loads.filter.reference')}
          placeholder={t('loads.filter.referencePlaceholder')}
          showLabel={false}
          className="flex items-center"
        />
        {/* THE AUTHORITY, AS A DROPDOWN (§6.3, 2026-11-06); nothing when there
         * is one authority, which the component decides. */}
        <AuthorityFilter
          companies={authorities}
          label={t('loads.filter.authority')}
          allLabel={t('accounting.allCompanies')}
        />
        {/* §6.7 item 7: this view, every page of it, as CSV. A plain link:
         * the browser downloads, middle-click works, nothing is posted. */}
        <a
          href={`/loads/export${exportQuery ? `?${exportQuery}` : ''}`}
          className="inline-flex h-control-compact items-center rounded-control border border-border-strong bg-surface px-z2 text-xs font-medium text-ink-2 hover:bg-surface-3"
        >
          {t('loads.export')}
        </a>
        <DensityControl
          density={density}
          labels={{
            density: t('density.label'),
            densities: DENSITIES.map((value) => ({
              value,
              label: t(`density.${value}` as never),
            })),
          }}
        />
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

      <LoadsTable
        rows={rows}
        // §6.3 as amended: the company column exists only where there is more
        // than one authority to tell apart.
        showCompanyColumn={companyCount > 1}
        // §7.1.7 as amended 2026-11-16: twelve on this list.
        columnCap={gridColumnCap('loads.loads')}
        visible={visibleLoadColumns}
        mayOpen={{
          customer: mayOpenCustomer,
          driver: mayOpenDriver,
          truck: mayOpenTruck,
          trailer: mayOpenTrailer,
        }}
        statusLabels={Object.fromEntries(
          [...ALL_OPERATIONAL, 'ASSIGNED' as const].map((word) => [
            word,
            t(loadStatusWordKey(word)),
          ]),
        )}
        billingLabels={Object.fromEntries(
          ALL_BILLING.map((status) => [status, t(billingLabelKey(status))]),
        )}
        expandLabels={{
          expand: t('loads.expand'),
          collapse: t('loads.collapse'),
          stops: t('loads.detail.stops'),
          notes: t('loads.detail.notes'),
          notesNone: t('loads.detail.notesNone'),
          notesLoading: t('loads.detail.notesLoading'),
          notesFailed: t('loads.detail.notesFailed'),
          warnings: t('loads.detail.warnings'),
          warningsNone: t('loads.detail.warningsNone'),
          stopTypes: {
            PICKUP: t('loads.stopType.PICKUP'),
            DELIVERY: t('loads.stopType.DELIVERY'),
            INTERMEDIATE: t('loads.stopType.INTERMEDIATE'),
          },
          warningNames: warningLabels(t),
        }}
        menuLabels={{
          menu: t('loads.menu'),
          open: t('loads.menu.open'),
          copy: t('loads.copyNumber'),
          copied: t('loads.copiedNumber'),
          copyFailed: t('loads.copyFailed'),
          attachPod: t('loads.menu.attachPod'),
        }}
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
          trailer: t('loads.column.trailer'),
          documents: t('loads.column.documents'),
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
       * Rendered only when there is a second page. It carries EVERY current
       * parameter forward, because a next button that silently drops the
       * filter is worse than no next button. Real anchors: middle-click opens
       * a tab and the URL is shareable. */}
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
