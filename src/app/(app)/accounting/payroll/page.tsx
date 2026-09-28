import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { formatCents } from '@/lib/money'
import { payWeekFor } from '@/lib/settlement-week'
import {
  payrollWeek,
  recentWeeks,
  weekFromParam,
  type PayrollRow,
  type PayrollRowState,
} from '@/lib/payroll'
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
import { AccountingHeader } from '../AccountingHeader'
import { WeekPicker } from './WeekPicker'
import { OpenWeek } from './OpenWeek'
import { BatchActions } from '../../settlements/batches/[id]/BatchActions'
import type { MessageKey } from '@/lib/i18n'
import type { StatusTone } from '@/lib/status'

// ACCOUNTING → PAYROLL (§6.2): what one week costs per driver, and its state.
//
// ── THE THREE SCREENS THIS IS ─────────────────────────────────────────────
//
// `/money/this-week` (the week that is due), `/settlements/batches` (a list of
// batches) and `/settlements` (a list of per-driver settlements) were one
// question asked at three distances. The week is a PARAMETER here, so every past
// week is reachable without knowing a batch id — which is the thing none of the
// three could do and the reason they collapse.
//
// THE PER-DRIVER STATEMENT STAYS ITS OWN PAGE. It is a document somebody prints
// and hands to a driver, and §7.1 makes the row the way in: clicking a row opens
// that driver's settlement.
//
// THE STRIPE MEANS THE DRIVER'S LINE, not the batch — blocked, held, negative,
// or the batch's own state where none of those apply. `payroll.ts` decides that
// precedence once and this screen renders it; a driver who cannot be paid at all
// is not "draft", however draft the batch is.

const ROW_TONE: Record<PayrollRowState, StatusTone> = {
  blocked: 'danger',
  negative: 'danger',
  held: 'warning',
  draft: 'neutral',
  final: 'progress',
  paid: 'success',
}

const ROW_LABEL: Record<PayrollRowState, MessageKey> = {
  blocked: 'payroll.state.blocked',
  negative: 'payroll.state.negative',
  held: 'payroll.state.held',
  draft: 'payroll.state.draft',
  final: 'payroll.state.final',
  paid: 'payroll.state.paid',
}

const WEEKS_OFFERED = 12

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>
}) {
  if (!(await currentUserCan('read', 'settlement'))) notFound()

  const raw = await searchParams
  const params = readListParams(raw)
  const { t, locale } = await getLocaleContext()
  const mayWrite = await currentUserCan('update', 'settlement')
  const mayOpen = await currentUserCan('create', 'settlement')

  // THE DEFAULT IS THE WEEK THAT IS DUE, which is `payWeekFor` — the period that
  // ended two Saturdays ago (MONEY-DESIGN §0). A screen defaulting to the week
  // that just closed would offer to settle freight a fortnight before anybody is
  // paid for it, which is that section's own warning.
  const due = payWeekFor(new Date())
  const chosen =
    weekFromParam(typeof raw.week === 'string' ? raw.week : null) ?? due.period
  const offered = recentWeeks(due.period, WEEKS_OFFERED)

  const data = await withCurrentOrg(
    'read',
    'settlement',
    async (tx, session) => {
      const week = await payrollWeek(tx, {
        organizationId: session.organizationId,
        period: chosen,
      })
      // WHICH OF THE OFFERED WEEKS ALREADY HAVE A BATCH — one query for the dot on
      // twelve chips, rather than twelve reads or a guess.
      const opened = await tx.settlementBatch.findMany({
        where: {
          organizationId: session.organizationId,
          deletedAt: null,
          periodStart: { in: offered.map((period) => period.start) },
        },
        select: { periodStart: true },
      })
      return { week, opened: opened.map((row) => row.periodStart.getTime()) }
    },
  )

  const { week } = data
  const day = (value: Date) => value.toISOString().slice(0, 10)

  const shape: ListShape<PayrollRow> = {
    searchText: (row) =>
      `${row.driverName} ${row.unitNumber ?? ''} ${row.settlementNumber ?? ''}`,
    // NO DATE RANGE ON THIS LIST. The week IS the range, and a second date
    // control beside it would be two answers to the same question — §7.4.1 wants
    // a range labelled with which date, and there is no other date here to bound.
    sorts: {
      driver: (row) => row.driverName,
      unit: (row) => row.unitNumber,
      loads: (row) => row.loadCount,
      gross: (row) => row.grossCents,
      deductions: (row) => row.deductionsCents,
      net: (row) => row.netCents,
      state: (row) => row.state,
    },
    defaultSort: 'driver',
  }

  const only = typeof raw.state === 'string' ? raw.state : null
  const narrowed =
    only === 'attention'
      ? week.rows.filter(
          (row) =>
            row.state === 'blocked' ||
            row.state === 'held' ||
            row.state === 'negative',
        )
      : week.rows

  const rows = applyList(narrowed, params, shape)
  const current = activeSort(params, shape)

  const money = (cents: number) => (
    <span className="font-mono tabular-nums">{formatCents(cents, locale)}</span>
  )

  const columns: Column<PayrollRow>[] = [
    {
      key: 'driver',
      header: t('payroll.driver'),
      sortable: true,
      render: (row) => row.driverName,
    },
    {
      key: 'unit',
      header: t('payroll.unit'),
      sortable: true,
      render: (row) => (
        <span className="z-identifier font-mono text-xs" dir="ltr">
          {row.unitNumber ?? '—'}
        </span>
      ),
    },
    {
      key: 'loads',
      header: t('payroll.loads'),
      align: 'end',
      sortable: true,
      render: (row) => (
        <span className="font-mono tabular-nums">{row.loadCount}</span>
      ),
      foot: (shown) => (
        <span className="font-mono tabular-nums">
          {sumCents(shown, (row) => row.loadCount)}
        </span>
      ),
    },
    {
      key: 'gross',
      header: t('payroll.gross'),
      align: 'end',
      sortable: true,
      render: (row) => money(row.grossCents),
      foot: (shown) => money(sumCents(shown, (row) => row.grossCents)),
    },
    {
      key: 'deductions',
      header: t('payroll.deductions'),
      align: 'end',
      sortable: true,
      render: (row) => money(row.deductionsCents),
      foot: (shown) => money(sumCents(shown, (row) => row.deductionsCents)),
    },
    {
      key: 'net',
      header: t('payroll.net'),
      align: 'end',
      sortable: true,
      render: (row) => money(row.netCents),
      foot: (shown) => money(sumCents(shown, (row) => row.netCents)),
    },
    {
      key: 'state',
      header: t('payroll.status'),
      sortable: true,
      render: (row) => (
        <div className="flex items-baseline gap-z2">
          <StatusBadge
            tone={ROW_TONE[row.state]}
            label={t(ROW_LABEL[row.state])}
          />
          {/* THE REASON BESIDE THE WORD. "Held" on its own sends somebody to
           * another screen to find out which load; §10 wants the sentence. */}
          {row.reason ? (
            <span className="text-xs text-ink-3">
              {t(row.reason as MessageKey)}
            </span>
          ) : null}
        </div>
      ),
    },
  ]

  return (
    <>
      <AccountingHeader
        title={t('accounting.payroll.title')}
        stripeMeans={t('accounting.payroll.stripe')}
        action={
          week.batch === null ? (
            mayOpen ? (
              <OpenWeek week={day(chosen.start)} label={t('money.openBatch')} />
            ) : null
          ) : mayWrite ? (
            <BatchActions
              batchId={week.batch.id}
              status={week.batch.status}
              canFinalise={week.blockers.length === 0}
              labels={{
                refresh: t('batch.refresh'),
                finalise: t('batch.finalise'),
                markPaid: t('batch.markPaid'),
              }}
            />
          ) : null
        }
      />

      <WeekPicker
        weeks={offered.map((period) => ({
          start: day(period.start),
          end: day(period.end),
          hasBatch: data.opened.includes(period.start.getTime()),
        }))}
        selected={day(chosen.start)}
        label={t('payroll.week')}
        openedLabel={t('payroll.opened')}
      />

      {/* THE PERIOD AND ITS TWO DATES, SPELLED OUT. The week chips carry
       * `MM-DD` and nothing else; a person about to finalise needs to see the
       * statement date and the pay date in full, and the check date is derived
       * so it is worth showing rather than assuming. */}
      <div className="flex flex-wrap items-baseline gap-z3 border-b border-border bg-surface-2 px-gutter py-z2 text-xs text-ink-2">
        <span className="font-mono" dir="ltr">
          {day(chosen.start)} — {day(chosen.end)}
        </span>
        {week.batch ? (
          <>
            <span className="font-mono text-ink" dir="ltr">
              {week.batch.batchNumber ?? week.batch.status}
            </span>
            <span>
              {t('batch.statementDate')}{' '}
              <span className="font-mono" dir="ltr">
                {day(week.batch.statementDate)}
              </span>
            </span>
            <span>
              {t('batch.checkDate')}{' '}
              <span className="font-mono" dir="ltr">
                {day(week.batch.checkDate)}
              </span>
            </span>
          </>
        ) : (
          <span>{t('payroll.noBatch')}</span>
        )}
        {week.heldCount > 0 ? (
          <span className="text-warning">
            {t('payroll.heldSum')} {formatCents(week.heldSumCents, locale)}
          </span>
        ) : null}
      </div>

      {/* BLOCKERS BY NAME, ABOVE THE TABLE, and shown even where the week has no
       * batch: "who could not be paid" is answerable before anybody presses
       * Open, and it is the answer somebody needs BEFORE they press it. A
       * blocked driver has no settlement row, so the table cannot carry them. */}
      {week.blockers.length > 0 ? (
        <section className="border-b border-border bg-danger-soft px-gutter py-z3">
          <h2 className="text-sm font-medium text-danger">
            {t('batch.blockers')}
          </h2>
          <ul className="mt-z1 flex flex-wrap gap-x-z5 gap-y-z1 text-xs text-ink">
            {week.blockers.map((row) => (
              <li key={row.driverId}>
                <span className="font-medium">{row.driverName}</span> —{' '}
                {t(row.reason as MessageKey)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <FilterBar
        groups={[
          {
            param: 'state',
            label: t('payroll.status'),
            choices: [
              {
                value: 'attention',
                label: t('payroll.needsAttention'),
                count: week.rows.filter(
                  (row) =>
                    row.state === 'blocked' ||
                    row.state === 'held' ||
                    row.state === 'negative',
                ).length,
              },
            ],
          },
        ]}
        search={{
          param: 'q',
          label: t('accounting.search'),
          placeholder: t('accounting.payroll.searchHint'),
        }}
        clearLabel={t('filter.clear')}
        moreLabel={t('filter.more')}
      />

      <Table
        columns={columns}
        rows={rows}
        rowKey={(row) => row.settlementId}
        rowHref={(row) => `/settlements/${row.settlementId}`}
        stripeTone={(row) => ROW_TONE[row.state]}
        caption={t('accounting.payroll.title')}
        sort={{
          key: current.key,
          dir: current.dir,
          hrefFor: (key) => sortHref('/accounting/payroll', raw, key, current),
          label: t('accounting.sortBy'),
        }}
        totals={{
          label: totalsLabel(
            t('accounting.total'),
            rows.length,
            t('accounting.rows'),
          ),
        }}
        empty={
          <EmptyState
            title={
              week.batch === null
                ? t('payroll.emptyNoBatch')
                : t('payroll.emptyFiltered')
            }
            body={
              week.batch === null
                ? t('payroll.emptyNoBatchHint')
                : t('accounting.emptyHint')
            }
          />
        }
      />
    </>
  )
}
