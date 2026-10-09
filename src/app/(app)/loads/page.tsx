import Link from 'next/link'
import { warningLabels } from '@/components/WarningCell'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { Button } from '@/components/ui/Button'
import { getLocaleContext } from '@/lib/locale'
import type { MessageKey } from '@/lib/i18n'
import { FilterBar } from '@/components/ui/FilterBar'
import { LoadsTable, type LoadRow } from './LoadsTable'
import { billingLabelKey, operationalLabelKey } from '@/lib/status'
import { readLoadListParams, READY } from '@/lib/load-list'
import { readLoadListData } from '@/lib/load-list-page'
import { renderDateOnly } from '@/lib/stop-time'
import { DENSITIES, readDensity, readSavedViews } from '@/lib/preferences'
import { gridColumnCap, readGridColumns } from '@/lib/grid-columns'
import {
  columnKeysFor,
  LOAD_COLUMN_KEYS,
  LOAD_COLUMNS_HIDDEN,
} from '@/lib/list-columns'
import { SavedViews } from './SavedViews'
import { ColumnsChooser } from '../_grid/ColumnsChooser'
import { DensityControl } from './DensityControl'
import { LoadFilters } from './LoadFilters'
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
// §6.7 gave it Datatruck's shape. WHAT IT READS IS `readLoadListData` in
// `src/lib/load-list-page.ts`: the rows, and every number on the bar from ONE
// grouped statement (chain two, 2026-10-09). The page renders.

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

  /** The same query string, for the export: the file is this view. */
  const exportQuery = pageHref(1)

  const [mayCreate, mayOpenCustomer, mayOpenDriver, mayOpenTruck, mayUpload] =
    await Promise.all([
      currentUserCan('create', 'load'),
      currentUserCan('read', 'customer'),
      currentUserCan('read', 'driver'),
      currentUserCan('read', 'truck'),
      currentUserCan('create', 'document'),
    ])

  const {
    data: { rows: listRows, counts, authorities, filterLabels },
    savedViews,
    density,
    visibleLoadColumns,
  } = await withCurrentOrg('read', 'load', async (tx, session) => {
    const data = await readLoadListData(tx, session.companyScopes, listParams, {
      page,
      pageSize: PAGE_SIZE,
      now: new Date(),
      locale,
    })
    const savedViews = await readSavedViews(tx, session.userId, 'loads')
    const density = await readDensity(tx, session.userId)
    // §7.1.7, in the same transaction as the two preference reads above it.
    const visibleLoadColumns = await readGridColumns(
      tx,
      session.userId,
      'loads.loads',
      columnKeysFor(LOAD_COLUMN_KEYS, data.authorities.length > 1),
      LOAD_COLUMNS_HIDDEN,
    )
    return { data, savedViews, density, visibleLoadColumns }
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
    deliveryDate:
      row.deliveryDay === null
        ? '—'
        : (renderDateOnly(new Date(`${row.deliveryDay}T00:00:00Z`), locale) ??
          '—'),
    truckId: row.truckId,
    truck: row.truck ?? '—',
    operationalStatus: row.operationalStatus,
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

  const statuses: LoadOperationalStatus[] = [
    'BOOKED',
    'IN_TRANSIT',
    'DELIVERED',
    'POD_RECEIVED',
  ]
  // READY_TO_INVOICE first: it is the biggest bucket on a working board.
  const billing: string[] = [
    READY,
    'UNINVOICED',
    'INVOICED',
    'PARTIALLY_PAID',
    'PAID',
  ]

  const headers = loadColumnHeaders(t)
  const typeahead = (which: 'broker' | 'driver') => ({
    label: t(`loads.filter.${which}`),
    placeholder: t(`loads.filter.${which}Placeholder`),
    loading: t('loads.filter.optionsLoading'),
    noMatch: t('loads.filter.optionsNone'),
    failed: t('loads.filter.optionsFailed'),
    clear: t('loads.filter.clearOne'),
  })

  return (
    <>
      {/* Page title, then the filter bar directly under it — never in a
       * drawer (§7.4). The page's actions sit top-right and belong to the
       * page (§7.1.6). */}
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="text-lg font-medium text-ink">{t('loads.title')}</h1>
        <div className="flex items-center gap-z3">
          {/* §2 — one meaning per screen, stated in the screen's header. */}
          <p className="text-xs text-ink-3">{t('loads.stripeMeaning')}</p>
          {/* §6.7 item 7: this view, every page of it, as CSV. A plain link:
           * the browser downloads, middle-click works, nothing is posted. */}
          <a
            href={`/loads/export${exportQuery ? `?${exportQuery}` : ''}`}
            className="inline-flex h-control-compact items-center rounded-control border border-border-strong bg-surface px-z2 text-xs font-medium text-ink-2 hover:bg-surface-3"
          >
            {t('loads.export')}
          </a>
          {mayCreate ? (
            <Link href="/loads/new">
              <Button variant="primary" size="compact">
                {t('loads.add')}
              </Button>
            </Link>
          ) : null}
        </div>
      </div>

      {/* §7.4 — pinned above the table, not behind a menu. One click. Density
       * moved to the filter bar's second row (§6.7 chain two). */}
      <SavedViews
        grid="loads"
        views={savedViews}
        labels={{
          save: t('views.save'),
          name: t('views.name'),
          saveHint: t('views.saveHint'),
          remove: t('views.remove'),
          all: t('views.all'),
          cancel: t('ref.cancel'),
          density: t('density.label'),
          densities: [],
        }}
      />

      {/* §6.7 chain two: TWO ROWS AT 1920. Row one, every chip; row two, the
       * search, the Filters popover, the chooser, density, Clear filters. */}
      <FilterBar
        layout="twoRows"
        clearLabel={t('loads.filter.clear')}
        moreLabel={t('loads.filter.more')}
        extraParams={['view', 'from', 'to', 'customer', 'driver']}
        groups={[
          {
            param: 'status',
            label: t('loads.filter.status'),
            choices: statuses.map((status) => ({
              value: status,
              label: t(operationalLabelKey(status)),
              // Zero is a real answer and is shown: "Delivered 0" says the day
              // is clear, where a missing chip would look like a broken filter.
              count: counts.status[status] ?? 0,
            })),
          },
          // Two VIEWS beside the status chips. They share `?view=` with the
          // date presets in the popover, so choosing one clears the other.
          {
            id: 'queue',
            param: 'view',
            label: t('loads.filter.queue'),
            choices: (['upcoming', 'unpaid'] as const).map((name) => ({
              value: name,
              label: t(`loads.view.${name}`),
              count: counts[name],
            })),
          },
          {
            param: 'billing',
            label: t('loads.filter.billing'),
            choices: billing.map((status) => ({
              value: status,
              label: t(billingLabelKey(status as LoadBillingStatus)),
              count: counts.billing[status] ?? 0,
            })),
          },
          // AUTHORITY, only when there is a choice to make (§6.3). No counts:
          // a narrowing, not a report.
          ...(authorities.length > 1
            ? [
                {
                  param: 'company',
                  label: t('loads.filter.authority'),
                  // Legal names run long; the full name is the chip's title.
                  truncate: true,
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
        <LoadFilters
          selected={filterLabels}
          labels={{
            open: t('loads.filters'),
            dates: t('loads.filter.dates'),
            picksUpToday: t('loads.view.picksUpToday'),
            deliversThisWeek: t('loads.view.deliversThisWeek'),
            pickupRange: t('loads.filter.range.pickup'),
            deliveryRange: t('loads.filter.range.delivery'),
            from: t('loads.filter.range.from'),
            to: t('loads.filter.range.to'),
            broker: typeahead('broker'),
            driver: typeahead('driver'),
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
      </FilterBar>

      <LoadsTable
        rows={rows}
        // §6.3 as amended: the company column exists only where there is more
        // than one authority to tell apart.
        showCompanyColumn={companyCount > 1}
        // §7.1.7 as amended 2026-10-09: ten on this list.
        columnCap={gridColumnCap('loads.loads')}
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
