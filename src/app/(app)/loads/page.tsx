import Link from 'next/link'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { Button } from '@/components/ui/Button'
import { getLocaleContext } from '@/lib/locale'
import { companyScopeFilter } from '@/lib/tenancy'
import { FilterBar } from '@/components/ui/FilterBar'
import { LoadsTable, type LoadRow } from './LoadsTable'
import { billingLabelKey, operationalLabelKey } from '@/lib/status'
import { loadSearchWhere } from '@/lib/loads'
import { readyToInvoiceWhere } from '@/lib/invoices'
import { DENSITIES, readDensity, readSavedViews } from '@/lib/preferences'
import { SavedViews } from './SavedViews'
import type {
  LoadBillingStatus,
  LoadOperationalStatus,
  Prisma,
} from '@/generated/prisma/client'

/**
 * The billing chip whose filter is a predicate rather than an enum value.
 *
 * Not a `LoadBillingStatus`: it is the same string the column happens to use,
 * but it selects through `readyToInvoiceWhere()`. Named once so the three
 * places that special-case it cannot drift.
 */
const READY = 'READY_TO_INVOICE'

// §11.7 — the screen that proves the rest of it works. Real shell, real table,
// real filter bar, real empty state. No data, no create action.
//
// It reads through `withCurrentOrg`, so the query is scoped by row-level
// security and the permission check happened before the query did. ESLint
// refuses `withOrg` and `prisma` under src/app, so there is no shorter path.

export default async function LoadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const { t, locale } = await getLocaleContext()

  const statusParam =
    typeof params['status'] === 'string' ? params['status'] : undefined
  const companyParam =
    typeof params['company'] === 'string' ? params['company'] : undefined
  // THE BILLING CHIPS NEVER FILTERED ANYTHING. The bar has offered them since
  // Phase 2 and the query only ever read `status` and `company`, so clicking
  // one rewrote the URL and returned the same rows. Found while adding the
  // counts, because a count has to come from the query the chip runs and this
  // chip ran none.
  const billingParam =
    typeof params['billing'] === 'string' ? params['billing'] : undefined
  // "IS TRIP X IN THE SYSTEM?" — the reference is the number dispatch quotes
  // to Amazon, and until now the only way to answer was to read the list.
  const referenceParam =
    typeof params['ref'] === 'string' ? params['ref'].trim() : ''

  const {
    rows,
    authorities,
    companyCount,
    savedViews,
    density,
    statusCounts,
    billingCounts,
  } = await withCurrentOrg('read', 'load', async (tx, session) => {
    // Company scoping is a business filter in the app layer, not a security
    // boundary — the tenant wall is already in Postgres. An empty scope list
    // means every authority in the organization.
    const scope = companyScopeFilter(session.companyScopes)

    // THE AUTHORITIES THIS VIEWER MAY NARROW TO — fetched here since
    // 2026-09-06, where the narrowing lives, rather than in the app layout on
    // every page of the shell. Same predicate the topbar filter used: active
    // companies, restricted to the viewer's own scope when they have one.
    const authorities = await tx.company.findMany({
      where: {
        isActive: true,
        ...(session.companyScopes.length > 0
          ? { id: { in: [...session.companyScopes] } }
          : {}),
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    })
    const companyCount = authorities.length

    // The filters other than the one being counted. Each chip's count is
    // "how many rows would I get if I clicked this", so it honours every
    // OTHER active filter and ignores its own group — a Booked count that
    // ignored the company filter would send somebody to a screen with a
    // different number on it.
    // Contains rather than equals, and why, in `loadSearchWhere`. It lives in
    // loads.ts so a test can call it — the searching semantics are the kind of
    // thing that silently does not work.
    const searchWhere = loadSearchWhere(referenceParam)

    const base: Prisma.LoadWhereInput = {
      deletedAt: null,
      ...scope,
      ...(companyParam ? { companyId: companyParam } : {}),
      ...searchWhere,
    }
    const statusWhere = statusParam
      ? { operationalStatus: statusParam as LoadOperationalStatus }
      : {}
    // READY TO INVOICE IS A PREDICATE, NOT A COLUMN VALUE, and the two are
    // not the same set. `billingStatus` says READY_TO_INVOICE for
    // direct-settled freight too — it has a POD and a rate — while
    // `readyToInvoiceWhere()` excludes it, because Relay work never becomes an
    // invoice. Filtering on the column would list loads the invoice queue
    // refuses to show, which is exactly the disagreement the shared-predicate
    // rule exists to prevent.
    const billingWhere: Prisma.LoadWhereInput =
      billingParam === READY
        ? readyToInvoiceWhere()
        : billingParam
          ? { billingStatus: billingParam as LoadBillingStatus }
          : {}

    const loads = await tx.load.findMany({
      where: { ...base, ...statusWhere, ...billingWhere },
      orderBy: { bookedAt: 'desc' },
      take: 100,
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
        company: { select: { name: true } },
        customer: { select: { name: true } },
        truck: { select: { unitNumber: true } },
        stops: {
          orderBy: { sequence: 'asc' },
          // `name` IS SELECTED BECAUSE SOME STOPS HAVE NOTHING ELSE. See
          // `place` below.
          select: { name: true, city: true, state: true, type: true },
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

    const rows: LoadRow[] = loads.map((load) => ({
      id: load.id,
      loadNumber: load.loadNumber,
      reference: load.referenceNumber,
      companyName: load.company.name,
      customerName: load.customer.name,
      pickup: place(load.stops.find((stop) => stop.type === 'PICKUP')),
      delivery: place(
        [...load.stops].reverse().find((stop) => stop.type === 'DELIVERY'),
      ),
      truck: load.truck?.unitNumber ?? '—',
      operationalStatus: load.operationalStatus,
      billingStatus: load.billingStatus,
      // Money is an integer of cents everywhere until the moment it is read.
      rate: money.format(load.linehaulCents / 100),
      isCancelled: load.isCancelled,
    }))

    // THE COUNTS, from the same predicate the chips filter by. Two
    // groupBys rather than one count per chip: seven statuses would be seven
    // round trips on the screen a dispatcher reloads all morning, and the
    // 200ms-per-statement link to Neon is what makes that expensive.
    //
    // Each group ignores its OWN filter and honours the other — so the
    // billing counts narrow when a status is picked, and vice versa, and
    // clicking a chip lands on exactly the number it promised.
    const [statusCounts, billingCounts, readyCount] = await Promise.all([
      tx.load.groupBy({
        by: ['operationalStatus'],
        where: { ...base, ...billingWhere },
        _count: { _all: true },
      }),
      tx.load.groupBy({
        by: ['billingStatus'],
        where: { ...base, ...statusWhere },
        _count: { _all: true },
      }),
      // One extra count: this chip's predicate is not a column, so `groupBy`
      // cannot produce it. Same function the chip filters by.
      tx.load.count({
        where: { ...base, ...statusWhere, ...readyToInvoiceWhere() },
      }),
    ])

    const savedViews = await readSavedViews(tx, session.userId)
    const density = await readDensity(tx, session.userId)

    return {
      rows,
      authorities,
      companyCount,
      savedViews,
      density,
      statusCounts: Object.fromEntries(
        statusCounts.map((row) => [row.operationalStatus, row._count._all]),
      ) as Record<string, number>,
      billingCounts: {
        ...Object.fromEntries(
          billingCounts.map((row) => [row.billingStatus, row._count._all]),
        ),
        [READY]: readyCount,
      } as Record<string, number>,
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

  const mayCreate = await currentUserCan('create', 'load')

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
        </div>
      </div>

      {/* §7.4 — pinned above the table, not behind a menu. One click. */}
      <SavedViews
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
          {
            param: 'billing',
            label: t('loads.filter.billing'),
            choices: billing.map((status) => ({
              value: status,
              label: t(billingLabelKey(status as LoadBillingStatus)),
              count: billingCounts[status] ?? 0,
            })),
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
          // NO COUNTS ON THESE CHIPS, deliberately. Every other group here
          // promises "this many rows if you click me" and honours the other
          // active filters to do it; adding a third counted dimension means a
          // third groupBy on every load-list render for a filter used rarely.
          // A chip with no number is honest about being a narrowing rather
          // than a report.
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
      />

      <LoadsTable
        rows={rows}
        // §6.3 as amended: the company column exists only where there is more
        // than one authority to tell apart.
        showCompanyColumn={companyCount > 1}
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
          load: t('loads.column.load'),
          reference: t('loads.column.reference'),
          company: t('loads.column.company'),
          customer: t('loads.column.customer'),
          pickup: t('loads.column.pickup'),
          delivery: t('loads.column.delivery'),
          truck: t('loads.column.truck'),
          status: t('loads.column.status'),
          billing: t('loads.column.billing'),
          rate: t('loads.column.rate'),
          emptyTitle: t('loads.empty.title'),
          emptyBody: t('loads.empty.body'),
          emptyFilteredTitle: t('loads.emptyFiltered.title'),
          emptyFilteredBody: t('loads.emptyFiltered.body'),
          clearFilters: t('loads.filter.clear'),
        }}
      />
    </>
  )
}
