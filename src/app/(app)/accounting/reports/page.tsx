import Link from 'next/link'
import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { formatCents } from '@/lib/money'
import { SETTLEMENT_BATCH_TIMEOUT_MS } from '@/lib/settlement-batch'
import {
  assembleReport,
  driverPayByCompany,
  driverTotals,
  firstSettledPeriodStart,
  grossByCompany,
  type DriverTotalRow,
  type Grouping,
} from '@/lib/by-company'
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
import { EmptyState } from '@/components/ui/EmptyState'
import { FilterBar } from '@/components/ui/FilterBar'
import { AccountingHeader } from '../AccountingHeader'
import { CutPicker } from './CutPicker'

// ACCOUNTING → REPORTS (§6.2): the same money cut by company, week or driver.
//
// ── THREE CUTS, ONE WINDOW ────────────────────────────────────────────────
//
// `/money/by-company` was two of these — company × week and company × month —
// and had no by-driver cut at all, so "what has this driver earned this quarter"
// was a question with no screen. All three now take the same date range, which is
// what makes them comparable: a company total and the driver totals under it are
// over the same weeks or they are two different reports.
//
// ── "AFTER DRIVER PAY" IS THE WHOLE LABEL, AND IT IS NOT PROFIT ───────────
//
// Gross minus settlement load lines. Not fuel, not tolls, not insurance, not
// escrow. Carried over verbatim from the screen this replaces, because a column
// named profit that ignores fuel is a figure somebody quotes at a bank.
//
// ── NULL IS NOT ZERO ──────────────────────────────────────────────────────
//
// Before Zebra's first FINAL batch, Datatruck paid those drivers and this system
// never saw it. A zero would read as "this freight cost nothing to drive", which
// is the most expensive wrong number this page can print. `—` and a sentence.

const DEFAULT_WEEKS = 13

export type Cut = 'company' | 'week' | 'driver'

const CUTS: readonly Cut[] = ['company', 'week', 'driver']

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>
}) {
  if (!(await currentUserCan('read', 'settlement'))) notFound()

  const raw = await searchParams
  const params = readListParams(raw)
  const { t, locale } = await getLocaleContext()

  const cutParam = typeof raw.cut === 'string' ? raw.cut : null
  const cut: Cut = (CUTS as readonly string[]).includes(cutParam ?? '')
    ? (cutParam as Cut)
    : 'company'

  // THE WINDOW COMES FROM THE SHARED RANGE, defaulting to the last 13 weeks.
  //
  // `to` IS EXCLUSIVE IN THESE QUERIES and `dayBound` returns an INCLUSIVE end,
  // so a millisecond is added rather than a day: adding a day would pull in the
  // next period and the week boundary is exactly where that is invisible
  // (MONEY-DESIGN §0). Where the reader has set no range, the default window is
  // used unchanged.
  const now = new Date()
  const midnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  )
  const from =
    params.from ?? new Date(midnight - DEFAULT_WEEKS * 7 * 86_400_000)
  const to =
    params.to === null
      ? new Date(midnight + 86_400_000)
      : new Date(params.to.getTime() + 1)

  const grouping: Grouping =
    typeof raw.by === 'string' && raw.by === 'month' ? 'month' : 'week'

  const data = await withCurrentOrg(
    'read',
    'settlement',
    async (tx) => {
      if (cut === 'driver') {
        return {
          kind: 'driver' as const,
          rows: await driverTotals(tx, { from, to }),
        }
      }
      const [gross, pay, first] = await Promise.all([
        grossByCompany(tx, { grouping, from, to }),
        driverPayByCompany(tx, { grouping, from, to }),
        firstSettledPeriodStart(tx),
      ])
      return {
        kind: 'periods' as const,
        report: assembleReport({ gross, pay, firstSettledPeriodStart: first }),
      }
    },
    { timeoutMs: SETTLEMENT_BATCH_TIMEOUT_MS },
  )

  const money = (cents: number) => (
    <span className="font-mono tabular-nums">{formatCents(cents, locale)}</span>
  )
  const dash = <span className="text-ink-3">—</span>
  const day = (value: Date) => value.toISOString().slice(0, 10)

  const header = (
    <>
      <AccountingHeader
        title={t('accounting.reports.title')}
        stripeMeans={t('accounting.reports.window')}
      />
      <CutPicker
        cuts={CUTS}
        selected={cut}
        grouping={grouping}
        labels={{
          cut: t('reports.cut'),
          company: t('reports.byCompany'),
          week: t('reports.byWeek'),
          driver: t('reports.byDriver'),
          grouping: t('reports.grouping'),
          weekly: t('reports.weekly'),
          monthly: t('reports.monthly'),
        }}
      />
      <FilterBar
        groups={[]}
        search={
          cut === 'driver'
            ? {
                param: 'q',
                label: t('accounting.search'),
                placeholder: t('accounting.reports.searchHint'),
              }
            : undefined
        }
        range={{
          label: t('reports.delivered'),
          fromLabel: t('accounting.from'),
          toLabel: t('accounting.to'),
        }}
        clearLabel={t('filter.clear')}
        moreLabel={t('filter.more')}
      />
      <p className="border-b border-border bg-surface-2 px-gutter py-z2 text-xs text-ink-2">
        {t('reports.windowIs')}{' '}
        <span className="font-mono" dir="ltr">
          {day(from)} — {day(new Date(to.getTime() - 1))}
        </span>
      </p>
    </>
  )

  // ── BY DRIVER: A LIST, so it gets the four controls and a totals row ─────
  if (data.kind === 'driver') {
    const shape: ListShape<DriverTotalRow> = {
      searchText: (row) => row.driverName,
      sorts: {
        driver: (row) => row.driverName,
        weeks: (row) => row.weeks,
        gross: (row) => row.grossCents,
        deductions: (row) => row.deductionsCents,
        net: (row) => row.netCents,
      },
      defaultSort: 'net',
      defaultDir: 'desc',
    }
    const rows = applyList(data.rows, params, shape)
    const current = activeSort(params, shape)

    const columns: Column<DriverTotalRow>[] = [
      {
        key: 'driver',
        header: t('payroll.driver'),
        sortable: true,
        render: (row) => row.driverName,
      },
      {
        key: 'weeks',
        header: t('reports.weeksPaid'),
        align: 'end',
        sortable: true,
        render: (row) => (
          <span className="font-mono tabular-nums">{row.weeks}</span>
        ),
        foot: (shown) => (
          <span className="font-mono tabular-nums">
            {sumCents(shown, (row) => row.weeks)}
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
    ]

    return (
      <>
        {header}
        <Table
          columns={columns}
          rows={rows}
          rowKey={(row) => row.driverId}
          rowHref={(row) => `/drivers/${row.driverId}`}
          caption={t('reports.byDriver')}
          sort={{
            key: current.key,
            dir: current.dir,
            hrefFor: (key) =>
              sortHref('/accounting/reports', raw, key, current),
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
              title={t('reports.emptyDriver')}
              body={t('reports.emptyDriverHint')}
            />
          }
        />
      </>
    )
  }

  // ── BY COMPANY / BY WEEK: a matrix, which is not a list ──────────────────
  //
  // Deliberately NOT `Table`: §7.1's component is one row per record with a
  // status stripe and a clickable row, and this is periods down, authorities
  // across. Forcing it through would mean nine columns of "company" headers
  // pretending to be fields.
  const { report } = data
  const periods =
    cut === 'week' ? report.periods : [...report.periods].reverse()

  return (
    <>
      {header}
      {report.firstSettledPeriodStart === null ? (
        <p className="border-b border-border bg-warning-soft px-gutter py-z2 text-xs text-warning">
          {t('reports.noneSettled')}
        </p>
      ) : null}

      {periods.length === 0 ? (
        <EmptyState
          title={t('reports.emptyPeriods')}
          body={t('reports.emptyPeriodsHint')}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto bg-surface">
          <table className="w-full border-collapse text-start">
            <caption className="sr-only">
              {cut === 'week' ? t('reports.byWeek') : t('reports.byCompany')}
            </caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky top-0 z-10 border-b border-border bg-surface-2 px-z3 py-z2 text-start text-xs font-semibold uppercase tracking-[0.04em] text-ink-2"
                >
                  {grouping === 'week' ? t('reports.week') : t('reports.month')}
                </th>
                <th
                  scope="col"
                  className="sticky top-0 z-10 border-b border-border bg-surface-2 px-z3 py-z2 text-start text-xs font-semibold uppercase tracking-[0.04em] text-ink-2"
                >
                  {t('reports.authority')}
                </th>
                <th
                  scope="col"
                  className="sticky top-0 z-10 border-b border-border bg-surface-2 px-z3 py-z2 text-end text-xs font-semibold uppercase tracking-[0.04em] text-ink-2"
                >
                  {t('reports.gross')}
                </th>
                <th
                  scope="col"
                  className="sticky top-0 z-10 border-b border-border bg-surface-2 px-z3 py-z2 text-end text-xs font-semibold uppercase tracking-[0.04em] text-ink-2"
                >
                  {t('reports.atRate')}
                </th>
                <th
                  scope="col"
                  className="sticky top-0 z-10 border-b border-border bg-surface-2 px-z3 py-z2 text-end text-xs font-semibold uppercase tracking-[0.04em] text-ink-2"
                >
                  {t('reports.afterDriverPay')}
                </th>
              </tr>
            </thead>
            <tbody>
              {periods.map((period) =>
                [period.all, ...period.companies].map((cell, index) => (
                  <tr
                    key={`${period.periodStart.getTime()}-${cell.companyId}`}
                    className="h-[var(--z-row-height)] border-b border-border hover:bg-surface-3"
                  >
                    {/* THE PERIOD ONCE PER GROUP, not repeated down every
                     * authority — rule 1, and a column of identical dates is
                     * four rows of nothing to compare. */}
                    <td className="px-z3 py-[var(--z-cell-pad-y)] font-mono text-[length:var(--z-body-size)]/[var(--z-body-line)] text-ink">
                      {index === 0 ? (
                        <Link
                          href={`/accounting/payroll?week=${day(period.periodStart)}`}
                          className="font-medium text-ink hover:text-accent"
                          dir="ltr"
                        >
                          {day(period.periodStart)}
                        </Link>
                      ) : null}
                    </td>
                    <td
                      className={`px-z3 py-[var(--z-cell-pad-y)] text-[length:var(--z-body-size)]/[var(--z-body-line)] ${
                        index === 0 ? 'font-medium text-ink' : 'text-ink-2'
                      }`}
                    >
                      {index === 0
                        ? t('reports.allCompanies')
                        : cell.companyName}
                    </td>
                    <td className="px-z3 py-[var(--z-cell-pad-y)] text-end text-[length:var(--z-body-size)]/[var(--z-body-line)] text-ink">
                      {money(cell.grossCents)}
                    </td>
                    <td className="px-z3 py-[var(--z-cell-pad-y)] text-end text-[length:var(--z-body-size)]/[var(--z-body-line)] text-ink-2">
                      {money(cell.atRateCents)}
                    </td>
                    <td className="px-z3 py-[var(--z-cell-pad-y)] text-end text-[length:var(--z-body-size)]/[var(--z-body-line)] text-ink">
                      {cell.afterDriverPayCents === null
                        ? dash
                        : money(cell.afterDriverPayCents)}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
