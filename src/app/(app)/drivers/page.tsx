import Link from 'next/link'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyScopeFilter } from '@/lib/tenancy'
import { Table, type Column } from '@/components/ui/Table'
import { WarningCell, warningLabels } from '@/components/WarningCell'
import {
  dispatchFactsForDrivers,
  dispatchStatusFrom,
  lastActivityForDrivers,
  type DispatchStatus,
} from '@/lib/dispatch-fields'
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
import { rosterBadge, type RosterStatus } from '@/lib/driver-roster'
import type { MessageKey } from '@/lib/i18n'
import type { DriverStatus } from '@/generated/prisma/client'

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
// `Driver.status` is a ROSTER fact somebody types on the form — hired,
// on vacation, no longer with us. Nothing in the freight engine writes it,
// which is checked: grep for a write and the only one is the edit action.
//
// Dispatch status is a FREIGHT fact and is derived on every read, so the
// two never disagree the way a stored copy would. Both columns are here
// because they answer different questions, and the column headers say so.
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

interface Row {
  id: string
  name: string
  companyName: string
  phone: string | null
  cdlNumber: string | null
  cdlState: string | null
  truck: string | null
  status: DriverStatus
  /** The roster exception worth showing, or null when they simply work here. */
  roster: RosterStatus | null
  isRetired: boolean
  warnings: readonly Warning[]
  /** Derived from the freight and the off-duty flag. Never stored. */
  dispatch: DispatchStatus
  /** Already formatted: the server holds the locale, the row holds text. */
  lastActivity: string | null
}

export default async function DriversPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const { t, locale } = await getLocaleContext()

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

  // ── AND THE DISPATCH FILTER, WHICH IS ALSO POST-QUERY ────────────────
  //
  // For the same reason as the attention one: the status is computed, so
  // there is no column to put in a WHERE. An unrecognised value narrows to
  // nothing rather than being ignored — a filter that silently does not
  // apply is a screen lying about what it is showing.
  const dispatchParam =
    typeof params['dispatch'] === 'string' ? params['dispatch'] : undefined

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

      // ONE QUERY EACH FOR THE WHOLE PAGE, not one per row. Each loader
      // takes every id at once; `tests/integration/warnings.test.ts` and
      // `tests/integration/dispatch-fields.test.ts` count the statements and
      // fail if the number moves with the length of the list.
      const ids = drivers.map((driver) => driver.id)
      const [facts, dispatchFacts, lastActivity] = await Promise.all([
        driverWarningFacts(tx, ids),
        dispatchFactsForDrivers(tx, ids),
        lastActivityForDrivers(tx, ids),
      ])
      const now = new Date()
      const day = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })
      const activityOf = (at: Date | null) => (at ? day.format(at) : null)

      const rows: Row[] = drivers.map((driver) => ({
        id: driver.id,
        name: `${driver.lastName}, ${driver.firstName}`,
        companyName: driver.company.name,
        phone: driver.phone,
        cdlNumber: driver.cdlNumber,
        cdlState: driver.cdlState,
        truck: driver.assignedTruck?.unitNumber ?? null,
        status: driver.status,
        roster: rosterBadge(driver.status),
        isRetired: driver.deletedAt !== null,
        warnings: driverWarnings(
          facts.get(driver.id) ?? { compliance: [], negativeNetCount: 0 },
          now,
        ),
        dispatch: dispatchStatusFrom(
          dispatchFacts.get(driver.id) ?? {
            rosterStatus: driver.status,
            isOffDuty: false,
            offDutyUntil: null,
            activeStatuses: [],
          },
          now,
        ),
        lastActivity: activityOf(lastActivity.get(driver.id) ?? null),
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
      // ── ONE STATUS PER ROW (owner's ruling, 2026-09-21) ───────────────
      //
      // Two columns here meant two answers to one question, and the stored
      // one was free to contradict the freight. What shows is the DERIVED
      // dispatch status — except where the roster says something the
      // freight cannot know: this person is on holiday, or gone. Those are
      // strictly more specific than "Off duty", which is what the derived
      // status reports for both of them.
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
      // NEVER IS A FACT, not a gap: a driver nobody has moved, filed a
      // document for, or assigned anything to. An em dash would read as
      // "not loaded".
      render: (row) => row.lastActivity ?? t('dispatch.lastActivity.never'),
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
  const attended = needsAttention
    ? rows.filter((row) => row.warnings.length > 0)
    : rows
  const shown = dispatchParam
    ? attended.filter((row) => row.dispatch === dispatchParam)
    : attended

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

        {/* THE DERIVED FILTER. Every link keeps every other toggle, like
         * the pair below — narrowing to the available drivers should not
         * silently widen the company or resurrect the inactive ones. */}
        <span className="flex items-center gap-z2">
          <Link
            href={`/drivers?${new URLSearchParams({
              ...(companyParam ? { company: companyParam } : {}),
              ...(showInactive ? { inactive: '1' } : {}),
              ...(showRetired ? { removed: '1' } : {}),
              ...(tagParam ? { tag: tagParam } : {}),
              ...(needsAttention ? { attention: '1' } : {}),
            }).toString()}`}
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
              href={`/drivers?${new URLSearchParams({
                ...(companyParam ? { company: companyParam } : {}),
                ...(showInactive ? { inactive: '1' } : {}),
                ...(showRetired ? { removed: '1' } : {}),
                ...(tagParam ? { tag: tagParam } : {}),
                ...(needsAttention ? { attention: '1' } : {}),
                dispatch: name,
              }).toString()}`}
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
        // THE STRIPE FOLLOWS THE BADGE. A row reading "On vacation" beside
        // a stripe coloured from a status nothing renders is the two-answer
        // problem again, one pixel wide.
        stripeTone={(row) =>
          row.roster !== null
            ? DRIVER_TONE[row.roster]
            : DISPATCH_TONE[row.dispatch]
        }
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
