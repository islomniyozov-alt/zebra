import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyScopeFilter } from '@/lib/tenancy'
import { listedAuthorities } from '@/lib/companies'
import { formatCents } from '@/lib/money'
import {
  DEDUCTION_TYPES,
  listCharges,
  type ChargeRow,
} from '@/lib/driver-deductions'
import { readGridColumns } from '@/lib/grid-columns'
import { applyList, sumCents, type RawParams } from '@/lib/list-view'
import {
  oneTimeShape,
  readOneTimeCharges,
  scheduledForWeek,
  scheduledShape,
  standingShape,
  type OneTimeGridRow,
} from '@/lib/accounting-grids'
import {
  listStandingCharges,
  STANDING_SCOPES,
  type StandingChargeListRow,
  type StandingScope,
} from '@/lib/standing-charges'
import { payWeekFor } from '@/lib/settlement-week'
import { recentWeeks, weekFromParam } from '@/lib/payroll'
import { WeekPicker } from '../batches/WeekPicker'
import { Table, type Column } from '@/components/ui/Table'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EmptyState } from '@/components/ui/EmptyState'
import { FilterBar } from '@/components/ui/FilterBar'
import { Tabs } from '@/components/ui/Tabs'
import { CompanyChips } from '../../_grid/CompanyChips'
import { PageHeader } from '../../_grid/PageHeader'
import { GridToolbar } from '../../_grid/GridToolbar'
import { GridFooterNav } from '../../_grid/GridFooterNav'
import { gridView, keepColumns, pagedFooterLabel } from '../../_grid/grid-page'
import { AddCharge } from './AddCharge'
import { AddStanding } from './AddStanding'
import { ChargeRowForm } from './ChargeRowForm'
import { StandingRowForm } from './StandingRowForm'
import type { MessageKey } from '@/lib/i18n'

// ACCOUNTING → CHARGES (§6.2, §7.1.6): two tabs over one grid.
//
//   Scheduled  standing rules — what comes off every week, across every driver
//   One-time   single lines somebody added to one week
//
// ── THIS PAGE AND PAYROLL → SCHEDULED PAYMENTS ARE NOT THE SAME SCREEN ────
//
// They read the same table, which is the one place this structure could have
// collapsed into a duplicate, so §6.2 states the difference and so does this:
//
//   HERE       org-wide and every week. "Who is not paying insurance", which is
//              answerable with no batch and no week selected.
//   PAYROLL    scoped to the week that page is showing — what comes off THIS run.
//
// A rule dormant until November is on this screen and not on that one. Owner's
// ruling, 2026-09-28, chosen over dropping one of them.
//
// THE STRIPE MEANS IN FORCE TODAY. A rule scheduled to start next month and one
// that ended in June are both dormant and neither is an error, so the muted bar
// says dormant rather than wrong — and the word is in the row (rule 5).

const ERROR_KEYS: MessageKey[] = [
  'deduction.error.driverNotFound',
  'deduction.error.unknownType',
  'deduction.error.badAmount',
  'deduction.error.badMonthlyTotal',
  'deduction.error.badTarget',
  'deduction.error.badDates',
  'deduction.error.overlaps',
  // ONE OBJECT FOR BOTH TABS' FORMS. A client component cannot call `t`, so
  // every sentence either form can be handed is translated here — and a key
  // missing from this list renders as the key itself, which is how the first
  // version of `AddCharge` was found by photographing a screen.
  'standing.error.badType',
  'standing.error.badScope',
  'standing.error.overlaps',
  'standing.error.noReason',
  'standing.error.alreadyExempt',
]

/**
 * The scope in the office's words (§10).
 *
 * `OWNER_OPERATOR` is a column value and "Owner-operators" is what people say.
 * FOUR ENTRIES, because `Driver.driverType` has three members and `ALL` is
 * not one of them — see `standing-charges.ts` on why §6.2.4's two were one short.
 */
const SCOPE_LABELS: Record<StandingScope, MessageKey> = {
  ALL: 'standing.scope.all',
  COMPANY_DRIVER: 'standing.scope.owned',
  LEASE_OPERATOR: 'standing.scope.leased',
  OWNER_OPERATOR: 'standing.scope.ownerOperator',
}

// FOUR TABS (§6.2). `thisWeek` is the same table as `scheduled`, scoped to the
// run on screen — the distinction that keeps this page from being two pages.
//
// `standing` IS A DIFFERENT TABLE (§6.2.4, migration 61), and it sits second
// rather than last: Scheduled and Standing together answer "what comes off a
// cheque", while One-time and This week are both about a particular week.
const TABS = ['scheduled', 'standing', 'oneTime', 'thisWeek'] as const
type Tab = (typeof TABS)[number]

const SCHEDULED_COLUMNS: readonly string[] = [
  'driver',
  'type',
  'amount',
  'target',
  'from',
  'to',
  'live',
  'edit',
]
const ONE_TIME_COLUMNS: readonly string[] = [
  'driver',
  'type',
  'description',
  'amount',
  'appliesOn',
  'load',
  'settled',
]
const STANDING_COLUMNS: readonly string[] = [
  'type',
  'appliesTo',
  'amount',
  'description',
  'from',
  'to',
  'exempt',
  'live',
  'act',
]

const PATH = '/accounting/charges'

export default async function ChargesPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>
}) {
  // READ TO OPEN, UPDATE TO CHANGE — the driver page's own split (`maySeePay` /
  // `maySetPay`). `driver.pay:read` is MONEY_READ, so ACCOUNTING and MANAGER get
  // the list; `driver.pay:update` is OWNER and ADMIN only, so they alone get the
  // Add button and the row editors.
  if (!(await currentUserCan('read', 'driver.pay'))) notFound()
  const mayEdit = await currentUserCan('update', 'driver.pay')

  const raw = await searchParams
  const { t, locale } = await getLocaleContext()

  const wanted = typeof raw.tab === 'string' ? raw.tab : null
  const tab: Tab = (TABS as readonly string[]).includes(wanted ?? '')
    ? (wanted as Tab)
    : 'scheduled'

  // THE SAME `?week=` THE BATCHES PAGE READS, so a link carries across the two
  // screens. Defaulting to the week that is due (MONEY-DESIGN §0), not the one
  // that just closed.
  const due = payWeekFor(new Date())
  const chosen =
    weekFromParam(typeof raw.week === 'string' ? raw.week : null) ?? due.period
  const offered = recentWeeks(due.period, 12)

  const search = new URLSearchParams(
    Object.entries(raw).flatMap(([key, value]) =>
      value === undefined
        ? []
        : [
            [key, Array.isArray(value) ? (value[0] ?? '') : value] as [
              string,
              string,
            ],
          ],
    ),
  )

  const data = await withCurrentOrg(
    'read',
    'driver.pay',
    async (tx, session) => {
      const scope = companyScopeFilter(session.companyScopes)
      const [charges, standing, oneTime, drivers, companies, columns] =
        await Promise.all([
          listCharges(tx, scope),
          // NO SCOPE ARGUMENT, AND THAT IS THE MODEL. A standing charge belongs
          // to the organization and carries no `companyId`, so there is nothing
          // to narrow — row-level security is the whole fence. See
          // `listStandingCharges`.
          listStandingCharges(tx),
          readOneTimeCharges(tx, scope),
          tx.driver.findMany({
            where: { deletedAt: null, ...scope },
            orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
            select: { id: true, firstName: true, lastName: true },
          }),
          listedAuthorities(tx, session.companyScopes),
          // ONE CHOOSER PER GRID, keyed by the tab on screen. Three keys for
          // four tabs: `thisWeek` shares `payroll.scheduled` with the toolbar
          // it already renders, because it is the same columns over the same
          // table narrowed to a week.
          readGridColumns(
            tx,
            session.userId,
            tab === 'standing'
              ? 'charges.standing'
              : tab === 'oneTime'
                ? 'charges.oneTime'
                : 'charges.scheduled',
            tab === 'standing'
              ? STANDING_COLUMNS
              : tab === 'oneTime'
                ? ONE_TIME_COLUMNS
                : SCHEDULED_COLUMNS,
          ),
        ])
      // THE WEEK-SCOPED SET IS THE SAME ROWS, NARROWED — not a second query.
      // `scheduledForWeek` takes the overlap, because a rule starting or ending
      // mid-week still applies to that week, which is what the engine's
      // `ruleInForce` decides for a period.
      const thisWeek = scheduledForWeek(charges, chosen)
      return {
        charges,
        standing,
        oneTime,
        thisWeek,
        drivers,
        companies,
        columns,
      }
    },
  )

  const money = (cents: number) => (
    <span className="font-mono tabular-nums">{formatCents(cents, locale)}</span>
  )
  const day = (value: Date | null) =>
    value === null ? '—' : value.toISOString().slice(0, 10)
  const errors = Object.fromEntries(ERROR_KEYS.map((key) => [key, t(key)]))
  const gridErrors = {
    'grid.columns.errorEmpty': t('grid.columns.errorEmpty'),
    'grid.columns.errorGrid': t('grid.columns.errorGrid'),
  }
  const toolbarLabels = {
    export: t('grid.export'),
    columns: t('grid.columns'),
    apply: t('grid.columns.apply'),
    cancel: t('grid.columns.cancel'),
    firstLocked: t('grid.columns.firstLocked'),
  }
  const footerLabels = {
    of: t('grid.of'),
    previous: t('grid.previous'),
    next: t('grid.next'),
    perPage: t('grid.perPage'),
  }

  const tabHref = (key: string) => {
    const next = new URLSearchParams(search)
    next.set('tab', key)
    next.delete('sort')
    next.delete('dir')
    next.delete('page')
    next.delete('type')
    next.delete('live')
    return `${PATH}?${next}`
  }

  const header = (
    <>
      <PageHeader
        title={t('accounting.charges.title')}
        breadcrumb={[t('nav.group.payroll'), t('accounting.charges.title')]}
        action={
          mayEdit && tab === 'standing' ? (
            // THE ORGANIZATION'S CHARGE, SO NO DRIVER FIELD. See `AddStanding`
            // on why that absence is the feature.
            <AddStanding
              types={DEDUCTION_TYPES}
              scopes={STANDING_SCOPES.map((scope) => ({
                value: scope,
                label: t(SCOPE_LABELS[scope]),
              }))}
              labels={{
                add: t('standing.add'),
                cancel: t('charges.cancel'),
                save: t('charges.save'),
                type: t('charges.type'),
                cadence: t('charges.cadence'),
                weekly: t('charges.cadenceWeekly'),
                monthlySplit: t('charges.cadenceMonthly'),
                amount: t('charges.weekly'),
                appliesTo: t('standing.appliesTo'),
                description: t('charges.description'),
                from: t('charges.from'),
              }}
              errors={errors}
            />
          ) : mayEdit && tab === 'scheduled' ? (
            <AddCharge
              drivers={data.drivers.map((driver) => ({
                id: driver.id,
                name: `${driver.lastName}, ${driver.firstName}`,
              }))}
              types={DEDUCTION_TYPES}
              labels={{
                add: t('charges.add'),
                cancel: t('charges.cancel'),
                save: t('charges.save'),
                driver: t('charges.driver'),
                type: t('charges.type'),
                cadence: t('charges.cadence'),
                weekly: t('charges.cadenceWeekly'),
                monthlySplit: t('charges.cadenceMonthly'),
                amount: t('charges.weekly'),
                monthlyTotal: t('charges.monthlyTotal'),
                target: t('charges.target'),
                description: t('charges.description'),
                from: t('charges.from'),
              }}
              errors={errors}
            />
          ) : null
        }
      />
      <Tabs
        tabs={[
          {
            key: 'scheduled',
            label: t('charges.tab.scheduled'),
            count: data.charges.length,
          },
          {
            key: 'standing',
            label: t('charges.tab.standing'),
            count: data.standing.length,
          },
          {
            key: 'oneTime',
            label: t('charges.tab.oneTime'),
            count: data.oneTime.length,
          },
          {
            key: 'thisWeek',
            label: t('charges.tab.thisWeek'),
            count: data.thisWeek.length,
          },
        ]}
        active={tab}
        hrefFor={tabHref}
        label={t('grid.tabs')}
      />
    </>
  )

  // ── STANDING CHARGES (§6.2.4, migration 61) ──────────────────────────────
  //
  // THE ORGANIZATION'S RULES. A scheduled charge belongs to one driver; these
  // materialise onto whoever the week produces, which is why there is no driver
  // column, no company chip and no driver to link a row to.
  if (tab === 'standing') {
    // THE FUNNEL IS APPLIED, not only offered. `applyList` handles search, range
    // and sort; in-force is computed per row rather than stored, so it is
    // narrowed here — the same shape the Scheduled tab uses, and the same reason
    // it cannot live in the shape's `sorts`.
    const live = typeof raw.live === 'string' ? raw.live : null
    const narrowedStanding = data.standing.filter((row) => {
      if (live === 'yes' && !row.inForceToday) return false
      if (live === 'no' && row.inForceToday) return false
      return true
    })
    const view = gridView(narrowedStanding, raw, standingShape, applyList)
    const columns: Column<StandingChargeListRow>[] = [
      {
        key: 'type',
        header: t('charges.type'),
        sortable: true,
        render: (row) => row.type,
      },
      {
        key: 'appliesTo',
        header: t('standing.appliesTo'),
        sortable: true,
        // THE SCOPE IN WORDS, NOT THE STORED ENUM. `OWNER_OPERATOR` is a column
        // value; "Owner-operators" is what the office calls them (§10). An
        // UNRECOGNISED value renders as itself rather than as a blank, because a
        // scope nobody recognises matches nobody and that is worth seeing.
        render: (row) =>
          row.appliesTo in SCOPE_LABELS ? (
            t(SCOPE_LABELS[row.appliesTo as StandingScope])
          ) : (
            <span className="z-identifier font-mono text-xs" dir="ltr">
              {row.appliesTo}
            </span>
          ),
      },
      {
        key: 'amount',
        header: t('charges.weekly'),
        align: 'end',
        sortable: true,
        render: (row) => money(row.amountCents),
        foot: (shown) => money(sumCents(shown, (row) => row.amountCents)),
      },
      {
        key: 'description',
        header: t('charges.description'),
        truncate: true,
        render: (row) =>
          row.description === null ? (
            <span className="text-ink-3">—</span>
          ) : (
            row.description
          ),
      },
      {
        key: 'from',
        header: t('charges.from'),
        sortable: true,
        render: (row) => (
          <span className="font-mono text-xs" dir="ltr">
            {day(row.effectiveFrom)}
          </span>
        ),
      },
      {
        key: 'to',
        header: t('charges.to'),
        sortable: true,
        render: (row) => (
          <span className="font-mono text-xs" dir="ltr">
            {day(row.effectiveTo)}
          </span>
        ),
      },
      {
        key: 'exempt',
        header: t('standing.exemptCount'),
        align: 'end',
        sortable: true,
        // ZERO IS THE NORMAL CASE and reads as `—`, not `0` (§8): an exemption
        // count of zero is an absence of decisions, and a column of zeros would
        // make the one row carrying a 3 harder to find rather than easier.
        render: (row) =>
          row.exemptCount === 0 ? (
            <span className="text-ink-3">—</span>
          ) : (
            <span className="font-mono tabular-nums">
              {String(row.exemptCount)}
            </span>
          ),
      },
      {
        key: 'live',
        header: t('charges.state'),
        render: (row) => (
          <StatusBadge
            tone={row.inForceToday ? 'success' : 'muted'}
            label={
              row.inForceToday ? t('charges.inForce') : t('charges.dormant')
            }
          />
        ),
      },
      // ONLY WHERE IT WOULD WORK, as the Scheduled tab's edit column is: a
      // column of buttons that 403 is worse than no column (§10).
      ...(mayEdit
        ? [
            {
              key: 'act',
              header: t('charges.edit'),
              render: (row: StandingChargeListRow) => (
                <StandingRowForm
                  standingChargeId={row.id}
                  drivers={data.drivers.map((driver) => ({
                    id: driver.id,
                    name: `${driver.lastName}, ${driver.firstName}`,
                  }))}
                  labels={{
                    stop: t('charges.stop'),
                    stopOn: t('charges.stopOn'),
                    exempt: t('standing.exempt'),
                    driver: t('charges.driver'),
                    reason: t('standing.reason'),
                    save: t('charges.save'),
                    cancel: t('charges.cancel'),
                  }}
                  errors={errors}
                />
              ),
            } satisfies Column<StandingChargeListRow>,
          ]
        : []),
    ]

    return (
      <>
        {header}
        <p className="border-b border-border bg-surface-2 px-gutter py-z2 text-xs text-ink-2">
          {t('standing.hint')}
        </p>
        <FilterBar
          groups={[
            {
              param: 'live',
              label: t('charges.state'),
              choices: [
                {
                  value: 'yes',
                  label: t('charges.inForce'),
                  count: data.standing.filter((row) => row.inForceToday).length,
                },
                {
                  value: 'no',
                  label: t('charges.dormant'),
                  count: data.standing.filter((row) => !row.inForceToday)
                    .length,
                },
              ],
            },
          ]}
          search={{
            param: 'q',
            label: t('accounting.search'),
            placeholder: t('standing.searchHint'),
          }}
          clearLabel={t('filter.clear')}
          moreLabel={t('filter.more')}
        />
        {/* NO `CompanyChips`. These rows carry no authority — see the data read. */}
        <div className="flex items-center justify-end gap-z2 border-b border-border bg-surface px-gutter py-z2">
          <GridToolbar
            grid="charges.standing"
            columns={columns.map((column) => ({
              key: column.key,
              header: column.header,
            }))}
            visible={data.columns}
            search={search}
            labels={toolbarLabels}
            errors={gridErrors}
          />
        </div>
        <Table
          columns={keepColumns(columns, data.columns)}
          rows={view.paged.rows}
          footRows={view.filtered}
          rowKey={(row) => row.id}
          // NO `rowHref`, for the Scheduled tab's reason: this row's detail IS
          // the row, and the forms inside it would sit under a stretched link
          // that swallowed their buttons.
          stripeTone={(row) => (row.inForceToday ? 'success' : 'muted')}
          caption={t('charges.tab.standing')}
          sort={{
            key: view.sort.key,
            dir: view.sort.dir,
            hrefFor: view.sortFor(PATH),
            label: t('accounting.sortBy'),
          }}
          totals={{
            label: pagedFooterLabel(
              t('accounting.weeklyTotal'),
              t('grid.rows'),
              view.paged,
            ),
          }}
          empty={
            <EmptyState title={t('standing.empty')} body={t('standing.hint')} />
          }
        />
        <GridFooterNav
          paged={view.paged}
          per={view.params.per}
          path={PATH}
          search={search}
          hrefForPage={view.hrefForPage(PATH)}
          labels={footerLabels}
        />
      </>
    )
  }

  // ── ONE-TIME CHARGES ─────────────────────────────────────────────────────
  if (tab === 'oneTime') {
    const view = gridView(data.oneTime, raw, oneTimeShape, applyList)
    const columns: Column<OneTimeGridRow>[] = [
      {
        key: 'driver',
        header: t('charges.driver'),
        sortable: true,
        render: (row) => row.driverName,
      },
      {
        key: 'type',
        header: t('charges.type'),
        sortable: true,
        render: (row) => row.type,
      },
      {
        key: 'description',
        header: t('charges.description'),
        truncate: true,
        sortable: true,
        render: (row) => row.description,
      },
      {
        key: 'amount',
        header: t('batches.amount'),
        align: 'end',
        sortable: true,
        // SIGNED. §8: a negative figure takes a leading minus and the danger
        // hue, never parentheses — dispatchers are not accountants.
        render: (row) => (
          <span
            className={`font-mono tabular-nums ${row.amountCents < 0 ? 'text-danger' : ''}`}
          >
            {formatCents(row.amountCents, locale)}
          </span>
        ),
        foot: (shown) => money(sumCents(shown, (row) => row.amountCents)),
      },
      {
        key: 'appliesOn',
        header: t('oneTime.appliesOn'),
        sortable: true,
        render: (row) => (
          <span className="font-mono text-xs" dir="ltr">
            {day(row.appliesOn)}
          </span>
        ),
      },
      {
        key: 'load',
        header: t('oneTime.load'),
        render: (row) =>
          row.loadNumber === null ? (
            <span className="text-ink-3">—</span>
          ) : (
            <span className="z-identifier font-mono text-xs" dir="ltr">
              {row.loadNumber}
            </span>
          ),
      },
      {
        key: 'settled',
        header: t('oneTime.settled'),
        sortable: true,
        render: (row) => (
          <StatusBadge
            tone={row.settledAt ? 'success' : 'warning'}
            label={row.settledAt ? t('oneTime.settled') : t('oneTime.pending')}
          />
        ),
      },
    ]

    return (
      <>
        {header}
        <FilterBar
          groups={[]}
          search={{
            param: 'q',
            label: t('accounting.search'),
            placeholder: t('accounting.charges.searchHint'),
          }}
          range={{
            label: t('oneTime.appliesOn'),
            fromLabel: t('accounting.from'),
            toLabel: t('accounting.to'),
          }}
          clearLabel={t('filter.clear')}
          moreLabel={t('filter.more')}
        />
        <div className="flex items-center justify-end gap-z2 border-b border-border bg-surface px-gutter py-z2">
          <GridToolbar
            grid="charges.oneTime"
            columns={columns.map((column) => ({
              key: column.key,
              header: column.header,
            }))}
            visible={data.columns}
            search={search}
            labels={toolbarLabels}
            errors={gridErrors}
          />
        </div>
        <Table
          columns={keepColumns(columns, data.columns)}
          rows={view.paged.rows}
          footRows={view.filtered}
          rowKey={(row) => row.id}
          rowHref={(row) => `/drivers/${row.driverId}`}
          stripeTone={(row) => (row.settledAt ? 'success' : 'warning')}
          caption={t('charges.tab.oneTime')}
          sort={{
            key: view.sort.key,
            dir: view.sort.dir,
            hrefFor: view.sortFor(PATH),
            label: t('accounting.sortBy'),
          }}
          totals={{
            label: pagedFooterLabel(
              t('accounting.total'),
              t('grid.rows'),
              view.paged,
            ),
          }}
          empty={
            <EmptyState
              title={t('oneTime.empty')}
              body={t('oneTime.emptyHint')}
            />
          }
        />
        <GridFooterNav
          paged={view.paged}
          per={view.params.per}
          path={PATH}
          search={search}
          hrefForPage={view.hrefForPage(PATH)}
          labels={footerLabels}
        />
      </>
    )
  }

  // ── THIS WEEK (the standing rules that touch the run on screen) ─────────
  //
  // The same table as Scheduled and NOT the same grid. A rule dormant until
  // November is on that tab and not on this one, which is the difference §6.2
  // records and the reason both exist rather than one.
  if (tab === 'thisWeek') {
    const view = gridView(data.thisWeek, raw, scheduledShape, applyList)
    const columns: Column<ChargeRow>[] = [
      {
        key: 'driver',
        header: t('charges.driver'),
        sortable: true,
        render: (row) => row.driverName,
      },
      {
        key: 'type',
        header: t('charges.type'),
        sortable: true,
        render: (row) => row.type,
      },
      {
        key: 'amount',
        header: t('charges.weekly'),
        align: 'end',
        sortable: true,
        render: (row) => (
          <span className="inline-flex items-baseline gap-z1">
            {money(row.amountCents)}
            {row.monthlyTotalCents !== null ? (
              <span className="font-mono text-xs text-ink-3">
                /{formatCents(row.monthlyTotalCents, locale)}
              </span>
            ) : null}
          </span>
        ),
        foot: (shown) => money(sumCents(shown, (row) => row.amountCents)),
      },
      {
        key: 'from',
        header: t('charges.from'),
        sortable: true,
        render: (row) => (
          <span className="font-mono text-xs" dir="ltr">
            {day(row.effectiveFrom)}
          </span>
        ),
      },
      {
        key: 'to',
        header: t('charges.to'),
        sortable: true,
        render: (row) => (
          <span className="font-mono text-xs" dir="ltr">
            {day(row.effectiveTo)}
          </span>
        ),
      },
    ]

    return (
      <>
        {header}
        <WeekPicker
          weeks={offered.map((period) => ({
            start: day(period.start),
            end: day(period.end),
            hasBatch: false,
          }))}
          selected={day(chosen.start)}
          label={t('payroll.week')}
          openedLabel={t('payroll.opened')}
        />
        <p className="border-b border-border bg-surface-2 px-gutter py-z2 text-xs text-ink-2">
          {t('charges.thisWeekHint')}{' '}
          <span className="font-mono" dir="ltr">
            {day(chosen.start)} — {day(chosen.end)}
          </span>
        </p>
        <FilterBar
          groups={[]}
          search={{
            param: 'q',
            label: t('accounting.search'),
            placeholder: t('accounting.charges.searchHint'),
          }}
          clearLabel={t('filter.clear')}
          moreLabel={t('filter.more')}
        />
        <div className="flex items-center justify-end gap-z2 border-b border-border bg-surface px-gutter py-z2">
          <GridToolbar
            grid="payroll.scheduled"
            columns={columns.map((column) => ({
              key: column.key,
              header: column.header,
            }))}
            visible={data.columns}
            search={search}
            labels={toolbarLabels}
            errors={gridErrors}
          />
        </div>
        <Table
          columns={columns}
          rows={view.paged.rows}
          footRows={view.filtered}
          rowKey={(row) => row.id}
          rowHref={(row) => `/drivers/${row.driverId}`}
          stripeTone={(row) => (row.inForceToday ? 'success' : 'muted')}
          caption={t('charges.tab.thisWeek')}
          sort={{
            key: view.sort.key,
            dir: view.sort.dir,
            hrefFor: view.sortFor(PATH),
            label: t('accounting.sortBy'),
          }}
          totals={{
            label: pagedFooterLabel(
              t('accounting.weeklyTotal'),
              t('grid.rows'),
              view.paged,
            ),
          }}
          empty={
            <EmptyState
              title={t('accounting.charges.empty')}
              body={t('charges.thisWeekHint')}
            />
          }
        />
        <GridFooterNav
          paged={view.paged}
          per={view.params.per}
          path={PATH}
          search={search}
          hrefForPage={view.hrefForPage(PATH)}
          labels={footerLabels}
        />
      </>
    )
  }

  // ── SCHEDULED (standing rules) ───────────────────────────────────────────
  const typeFilter = typeof raw.type === 'string' ? raw.type : null
  const liveFilter = typeof raw.live === 'string' ? raw.live : null
  const narrowed = data.charges.filter((row) => {
    if (typeFilter !== null && row.type !== typeFilter) return false
    if (liveFilter === 'yes' && !row.inForceToday) return false
    if (liveFilter === 'no' && row.inForceToday) return false
    return true
  })

  const view = gridView(narrowed, raw, scheduledShape, applyList)

  const columns: Column<ChargeRow>[] = [
    {
      key: 'driver',
      header: t('charges.driver'),
      sortable: true,
      render: (row) => row.driverName,
    },
    {
      key: 'type',
      header: t('charges.type'),
      sortable: true,
      render: (row) => row.type,
    },
    {
      key: 'amount',
      header: t('charges.weekly'),
      align: 'end',
      sortable: true,
      render: (row) => (
        <span className="inline-flex items-baseline gap-z1">
          {money(row.amountCents)}
          {/* `$1800/$450` is how the statements print a monthly split. The
           * month's total is context for the instalment, not a second figure to
           * add — so it is dimmer and smaller, and never in the total. */}
          {row.monthlyTotalCents !== null ? (
            <span className="font-mono text-xs text-ink-3">
              /{formatCents(row.monthlyTotalCents, locale)}
            </span>
          ) : null}
        </span>
      ),
      foot: (shown) => money(sumCents(shown, (row) => row.amountCents)),
    },
    {
      key: 'target',
      header: t('charges.target'),
      align: 'end',
      sortable: true,
      // §8 — `—` means no value recorded, and most charges have no target. Only
      // Escrow stops at one.
      render: (row) =>
        row.targetCents === null ? (
          <span className="text-ink-3">—</span>
        ) : (
          money(row.targetCents)
        ),
    },
    {
      key: 'from',
      header: t('charges.from'),
      sortable: true,
      render: (row) => (
        <span className="font-mono text-xs" dir="ltr">
          {day(row.effectiveFrom)}
        </span>
      ),
    },
    {
      key: 'to',
      header: t('charges.to'),
      sortable: true,
      render: (row) => (
        <span className="font-mono text-xs" dir="ltr">
          {day(row.effectiveTo)}
        </span>
      ),
    },
    {
      key: 'live',
      header: t('charges.state'),
      render: (row) => (
        <StatusBadge
          tone={row.inForceToday ? 'success' : 'muted'}
          label={row.inForceToday ? t('charges.inForce') : t('charges.dormant')}
        />
      ),
    },
    // THE EDIT COLUMN ONLY WHERE IT WOULD WORK. A column of buttons that 403 is
    // worse than no column: §10 wants an interface that says what is possible.
    ...(mayEdit
      ? [
          {
            key: 'edit',
            header: t('charges.edit'),
            render: (row: ChargeRow) => (
              <ChargeRowForm
                chargeId={row.id}
                driverId={row.driverId}
                amount={(row.amountCents / 100).toFixed(2)}
                monthlyTotal={
                  row.monthlyTotalCents === null
                    ? ''
                    : (row.monthlyTotalCents / 100).toFixed(2)
                }
                target={
                  row.targetCents === null
                    ? ''
                    : (row.targetCents / 100).toFixed(2)
                }
                description={row.description ?? ''}
                splitsMonthly={row.cadence === 'MONTHLY_SPLIT_WEEKLY'}
                labels={{
                  edit: t('charges.edit'),
                  save: t('charges.save'),
                  cancel: t('charges.cancel'),
                  stop: t('charges.stop'),
                  stopOn: t('charges.stopOn'),
                  amount: t('charges.weekly'),
                  monthlyTotal: t('charges.monthlyTotal'),
                  target: t('charges.target'),
                  description: t('charges.description'),
                }}
                errors={errors}
              />
            ),
          } satisfies Column<ChargeRow>,
        ]
      : []),
  ]

  return (
    <>
      {header}
      <FilterBar
        groups={[
          {
            param: 'live',
            label: t('charges.state'),
            choices: [
              {
                value: 'yes',
                label: t('charges.inForce'),
                count: data.charges.filter((row) => row.inForceToday).length,
              },
              {
                value: 'no',
                label: t('charges.dormant'),
                count: data.charges.filter((row) => !row.inForceToday).length,
              },
            ],
          },
          {
            param: 'type',
            label: t('charges.type'),
            choices: DEDUCTION_TYPES.map((type) => ({
              value: type,
              label: type,
              count: data.charges.filter((row) => row.type === type).length,
            })),
          },
        ]}
        search={{
          param: 'q',
          label: t('accounting.search'),
          placeholder: t('accounting.charges.searchHint'),
        }}
        range={{
          label: t('charges.from'),
          fromLabel: t('accounting.from'),
          toLabel: t('accounting.to'),
        }}
        clearLabel={t('filter.clear')}
        moreLabel={t('filter.more')}
      />
      <div className="flex items-center justify-between gap-z2 border-b border-border bg-surface px-gutter py-z2">
        <CompanyChips
          companies={data.companies}
          label={t('accounting.company')}
          allLabel={t('accounting.allCompanies')}
        />
        <GridToolbar
          grid="charges.scheduled"
          columns={columns.map((column) => ({
            key: column.key,
            header: column.header,
          }))}
          visible={data.columns}
          search={search}
          labels={toolbarLabels}
          errors={gridErrors}
        />
      </div>
      <Table
        columns={keepColumns(columns, data.columns)}
        rows={view.paged.rows}
        footRows={view.filtered}
        rowKey={(row) => row.id}
        // NO `rowHref`. §7.1 makes the whole row a link where there is a detail
        // page to open; this row's detail IS the row, and the editor inside it
        // would sit under a stretched link that swallowed its buttons.
        stripeTone={(row) => (row.inForceToday ? 'success' : 'muted')}
        caption={t('charges.tab.scheduled')}
        sort={{
          key: view.sort.key,
          dir: view.sort.dir,
          hrefFor: view.sortFor(PATH),
          label: t('accounting.sortBy'),
        }}
        totals={{
          label: pagedFooterLabel(
            t('accounting.weeklyTotal'),
            t('grid.rows'),
            view.paged,
          ),
        }}
        empty={
          <EmptyState
            title={t('accounting.charges.empty')}
            body={t('accounting.charges.emptyHint')}
          />
        }
      />
      <GridFooterNav
        paged={view.paged}
        per={view.params.per}
        path={PATH}
        search={search}
        hrefForPage={view.hrefForPage(PATH)}
        labels={footerLabels}
      />
    </>
  )
}
