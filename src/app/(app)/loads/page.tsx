import Link from 'next/link'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { Button } from '@/components/ui/Button'
import { getLocaleContext } from '@/lib/locale'
import { companyScopeFilter } from '@/lib/tenancy'
import { FilterBar } from '@/components/ui/FilterBar'
import { LoadsTable, type LoadRow } from './LoadsTable'
import { billingLabelKey, operationalLabelKey } from '@/lib/status'
import { DENSITIES, readDensity, readSavedViews } from '@/lib/preferences'
import { SavedViews } from './SavedViews'
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

  const { rows, companyCount, savedViews, density } = await withCurrentOrg(
    'read',
    'load',
    async (tx, session) => {
      // Company scoping is a business filter in the app layer, not a security
      // boundary — the tenant wall is already in Postgres. An empty scope list
      // means every authority in the organization.
      const scope = companyScopeFilter(session.companyScopes)

      const companyCount = await tx.company.count()

      const loads = await tx.load.findMany({
        where: {
          deletedAt: null,
          ...scope,
          ...(companyParam ? { companyId: companyParam } : {}),
          ...(statusParam
            ? { operationalStatus: statusParam as LoadOperationalStatus }
            : {}),
        },
        orderBy: { bookedAt: 'desc' },
        take: 100,
        select: {
          id: true,
          loadNumber: true,
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
            select: { city: true, state: true, type: true },
          },
        },
      })

      const money = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })

      const place = (
        stop: { city: string | null; state: string | null } | undefined,
      ) => (stop ? [stop.city, stop.state].filter(Boolean).join(', ') : '—')

      const rows: LoadRow[] = loads.map((load) => ({
        id: load.id,
        loadNumber: load.loadNumber,
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

      const savedViews = await readSavedViews(tx, session.userId)
      const density = await readDensity(tx, session.userId)

      return { rows, companyCount, savedViews, density }
    },
  )

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
  ]

  const mayCreate = await currentUserCan('create', 'load')

  const statuses: LoadOperationalStatus[] = [
    'BOOKED',
    'IN_TRANSIT',
    'DELIVERED',
    'POD_RECEIVED',
  ]
  const billing: LoadBillingStatus[] = ['UNINVOICED', 'INVOICED', 'PAID']

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
            })),
          },
          {
            param: 'billing',
            label: t('loads.filter.billing'),
            choices: billing.map((status) => ({
              value: status,
              label: t(billingLabelKey(status)),
            })),
          },
        ]}
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
