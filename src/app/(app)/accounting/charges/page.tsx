import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyIdScopeFilter, companyScopeFilter } from '@/lib/tenancy'
import { formatCents } from '@/lib/money'
import {
  DEDUCTION_TYPES,
  listCharges,
  type ChargeRow,
} from '@/lib/driver-deductions'
import {
  applyList,
  activeSort,
  readListParams,
  sortHref,
  sumCents,
  totalsLabel,
  type ListShape,
  type RawParams,
} from '@/lib/list-view'
import { Table, type Column } from '@/components/ui/Table'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EmptyState } from '@/components/ui/EmptyState'
import { FilterBar } from '@/components/ui/FilterBar'
import { CompanyChips } from '../CompanyChips'
import { AccountingHeader } from '../AccountingHeader'
import { AddCharge } from './AddCharge'
import { ChargeRowForm } from './ChargeRowForm'
import type { MessageKey } from '@/lib/i18n'

// ACCOUNTING → CHARGES (§6.2): what comes off cheques every week, across drivers.
//
// ── THE QUESTION NO OTHER SCREEN COULD ANSWER ─────────────────────────────
//
// The driver page's editor answers "what comes off THIS driver's cheque", which
// is the question you have when you are already looking at a driver. It cannot
// answer the one the office asks on a Monday: "who is not paying insurance".
// That needed 164 driver pages, so nobody asked it — and the four replayed weeks
// on dev showed every statement's deductions against Zebra's $0.00, because dev
// held no recurring charges at all and no screen made that visible.
//
// THE STRIPE MEANS IN FORCE TODAY. A rule scheduled to start next month and a
// rule that ended in June are both "not in force" and neither is an error, so the
// muted bar says dormant rather than wrong — and the word is in the row (rule 5).
//
// AMOUNTS ARE THE WEEKLY INSTALMENT. A monthly-split rule shows `$450` with its
// month's total beside it, which is how the statements print it — `$1800/$450` —
// and summing the instalments is the figure that means something: what one week
// of charges is worth.

const ERROR_KEYS: MessageKey[] = [
  'deduction.error.driverNotFound',
  'deduction.error.unknownType',
  'deduction.error.badAmount',
  'deduction.error.badMonthlyTotal',
  'deduction.error.badTarget',
  'deduction.error.badDates',
  'deduction.error.overlaps',
]

export default async function ChargesPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>
}) {
  // READ TO OPEN, UPDATE TO CHANGE — the driver page's own split (`maySeePay` /
  // `maySetPay`). `driver.pay:read` is MONEY_READ, so ACCOUNTING and MANAGER get
  // the list; `driver.pay:update` is OWNER and ADMIN only, so they alone get the
  // Add button and the row editors.
  //
  // NOT gated on `settlement`: a role that may read a batch total does not
  // thereby get to see one driver's insurance instalment.
  if (!(await currentUserCan('read', 'driver.pay'))) notFound()
  const mayEdit = await currentUserCan('update', 'driver.pay')

  const raw = await searchParams
  const params = readListParams(raw)
  const { t, locale } = await getLocaleContext()

  const data = await withCurrentOrg(
    'update',
    'driver.pay',
    async (tx, session) => {
      const scope = companyScopeFilter(session.companyScopes)
      const [charges, drivers, companies] = await Promise.all([
        listCharges(tx, scope),
        tx.driver.findMany({
          where: { deletedAt: null, ...scope },
          orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
          select: { id: true, firstName: true, lastName: true },
        }),
        // `companyIdScopeFilter`, NOT `companyScopeFilter`. The second is
        // `{ companyId: ... }`, which is not a valid `CompanyWhereInput` — see
        // tenancy.ts: it compiles, and 500s for the first person whose membership
        // is scoped to one authority. And Company retires with `isActive`.
        tx.company.findMany({
          where: {
            isActive: true,
            ...companyIdScopeFilter(session.companyScopes),
          },
          orderBy: { name: 'asc' },
          select: { id: true, name: true },
        }),
      ])
      return { charges, drivers, companies }
    },
  )

  const shape: ListShape<ChargeRow> = {
    searchText: (row) =>
      `${row.driverName} ${row.type} ${row.description ?? ''} ${row.companyName}`,
    // §7.4.1 — STARTS is the date bounded. "Which charges started in September"
    // is the question a range answers here; `effectiveTo` is mostly null and a
    // range over it would exclude every live rule.
    dateOf: (row) => row.effectiveFrom,
    companyIdOf: (row) => row.companyId,
    sorts: {
      driver: (row) => row.driverName,
      type: (row) => row.type,
      amount: (row) => row.amountCents,
      cadence: (row) => row.cadence,
      target: (row) => row.targetCents,
      from: (row) => row.effectiveFrom.getTime(),
      to: (row) => row.effectiveTo?.getTime() ?? null,
    },
    defaultSort: 'driver',
  }

  const typeFilter = typeof raw.type === 'string' ? raw.type : null
  const liveFilter = typeof raw.live === 'string' ? raw.live : null

  const narrowed = data.charges.filter((row) => {
    if (typeFilter !== null && row.type !== typeFilter) return false
    if (liveFilter === 'yes' && !row.inForceToday) return false
    if (liveFilter === 'no' && row.inForceToday) return false
    return true
  })

  const rows = applyList(narrowed, params, shape)
  const current = activeSort(params, shape)

  const money = (cents: number) => (
    <span className="font-mono tabular-nums">{formatCents(cents, locale)}</span>
  )
  const day = (value: Date | null) =>
    value === null ? '—' : value.toISOString().slice(0, 10)

  // EVERY REFUSAL SENTENCE, TRANSLATED HERE. A client component cannot call `t`,
  // and a function that closes over it cannot be serialised across the boundary —
  // which is what the first version of this page did, and why it 500d.
  const errors = Object.fromEntries(ERROR_KEYS.map((key) => [key, t(key)]))

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
           * add — so it is dimmer and smaller, never in the total. */}
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
      <AccountingHeader
        title={t('accounting.charges.title')}
        stripeMeans={t('accounting.charges.stripe')}
        action={
          mayEdit ? (
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

      <CompanyChips
        companies={data.companies}
        label={t('accounting.company')}
        allLabel={t('accounting.allCompanies')}
      />

      <Table
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        // NO `rowHref`. §7.1 makes the whole row a link where there is a detail
        // page to open; this row's detail IS the row, and the editor inside it
        // would sit under a stretched link that swallowed its buttons.
        stripeTone={(row) => (row.inForceToday ? 'success' : 'muted')}
        caption={t('accounting.charges.title')}
        sort={{
          key: current.key,
          dir: current.dir,
          hrefFor: (key) => sortHref('/accounting/charges', raw, key, current),
          label: t('accounting.sortBy'),
        }}
        totals={{
          label: totalsLabel(
            t('accounting.weeklyTotal'),
            rows.length,
            t('accounting.rows'),
          ),
        }}
        empty={
          <EmptyState
            title={t('accounting.charges.empty')}
            body={t('accounting.charges.emptyHint')}
          />
        }
      />
    </>
  )
}
