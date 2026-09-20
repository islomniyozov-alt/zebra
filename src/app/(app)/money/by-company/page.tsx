import Link from 'next/link'
import { withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { formatCents } from '@/lib/money'
import { SETTLEMENT_BATCH_TIMEOUT_MS } from '@/lib/settlement-batch'
import {
  assembleReport,
  driverPayByCompany,
  firstSettledPeriodStart,
  grossByCompany,
  type Grouping,
} from '@/lib/by-company'
import { PeriodChart } from './PeriodChart'

// MONEY → BY COMPANY. What did each authority make.
//
// Settlement is org-wide by ruling — one batch, one statement per driver,
// whoever's freight they pulled. Settle together, REPORT APART: the money
// still belongs to an authority and somebody has to be able to see which.
//
// ── READ-ONLY, AND NOTHING IS RECOMPUTED HERE ────────────────────────────
//
// Two grouped queries and an assembler that pairs them. No load is read into
// this process and nothing is summed over freight in TypeScript — the money
// screen already went down that road and came back at 4,427ms.
//
// ── "AFTER DRIVER PAY" IS THE WHOLE LABEL ────────────────────────────────
//
// Gross minus settlement load lines. Not fuel, not tolls, not insurance, not
// escrow. It is not profit and it must never be called profit on this page: a
// column named profit that ignores fuel is a figure somebody quotes at a bank.

const DEFAULT_WEEKS = 13
const DEFAULT_MONTHS = 12

/** The window the page opens on: the last 13 weeks, or the last 12 months. */
function windowFor(grouping: Grouping): { from: Date; to: Date } {
  const now = new Date()
  const midnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  )
  const to = new Date(midnight + 86_400_000)
  if (grouping === 'week') {
    return { from: new Date(midnight - DEFAULT_WEEKS * 7 * 86_400_000), to }
  }
  return {
    from: new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - DEFAULT_MONTHS + 1, 1),
    ),
    to,
  }
}

export default async function ByCompanyPage({
  searchParams,
}: {
  searchParams: Promise<{ by?: string; company?: string; measure?: string }>
}) {
  const { t, locale } = await getLocaleContext()
  const params = await searchParams

  const grouping: Grouping = params.by === 'month' ? 'month' : 'week'
  const measure =
    params.measure === 'afterDriverPay' ? 'afterDriverPay' : 'gross'
  const window = windowFor(grouping)

  const report = await withCurrentOrg(
    'read',
    'settlement',
    async (tx) => {
      const [gross, pay, settledFrom] = await Promise.all([
        grossByCompany(tx, { grouping, ...window }),
        driverPayByCompany(tx, { grouping, ...window }),
        firstSettledPeriodStart(tx),
      ])
      return assembleReport({
        gross,
        pay,
        firstSettledPeriodStart: settledFrom,
      })
    },
    { timeoutMs: SETTLEMENT_BATCH_TIMEOUT_MS },
  )

  // RETIRED AUTHORITIES APPEAR ONLY WHERE THEY HAVE FREIGHT, which falls out
  // of building the list from the rows rather than from the Company table.
  const companies = [
    ...new Map(
      report.periods
        .flatMap((period) => period.companies)
        .map((cell) => [cell.companyId, cell.companyName]),
    ).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]))

  const picked =
    params.company && companies.some(([id]) => id === params.company)
      ? params.company
      : null

  const money = (cents: number) => formatCents(cents, locale)
  const dash = t('money.byCompany.unknown')

  const href = (next: Partial<Record<string, string | null>>) => {
    const query = new URLSearchParams()
    const by = next.by ?? grouping
    if (by === 'month') query.set('by', 'month')
    const company = next.company === null ? null : (next.company ?? picked)
    if (company) query.set('company', company)
    const m = next.measure ?? measure
    if (m === 'afterDriverPay') query.set('measure', 'afterDriverPay')
    const text = query.toString()
    return text ? `/money/by-company?${text}` : '/money/by-company'
  }

  const tab = (active: boolean) =>
    `rounded-control px-z3 py-z2 text-sm ${
      active ? 'bg-accent text-on-accent' : 'text-ink-subtle hover:text-ink'
    }`

  return (
    <main className="flex flex-col gap-z4 p-z4">
      <header className="flex flex-col gap-z2">
        <h1 className="text-lg font-semibold text-ink">
          {t('money.byCompany.title')}
        </h1>
        <p className="text-sm text-ink-subtle">{t('money.byCompany.blurb')}</p>
      </header>

      <div className="flex flex-wrap items-center gap-z3">
        <nav className="flex gap-z1" aria-label={t('money.byCompany.grouping')}>
          <Link
            href={href({ by: 'week' })}
            className={tab(grouping === 'week')}
          >
            {t('money.byCompany.weeks')}
          </Link>
          <Link
            href={href({ by: 'month' })}
            className={tab(grouping === 'month')}
          >
            {t('money.byCompany.months')}
          </Link>
        </nav>

        <nav className="flex gap-z1" aria-label={t('money.byCompany.measure')}>
          <Link
            href={href({ measure: 'gross' })}
            className={tab(measure === 'gross')}
          >
            {t('money.byCompany.gross')}
          </Link>
          <Link
            href={href({ measure: 'afterDriverPay' })}
            className={tab(measure === 'afterDriverPay')}
          >
            {t('money.byCompany.afterDriverPay')}
          </Link>
        </nav>

        <nav className="flex gap-z1" aria-label={t('money.byCompany.company')}>
          <Link href={href({ company: null })} className={tab(picked === null)}>
            {t('money.byCompany.all')}
          </Link>
          {companies.map(([id, name]) => (
            <Link
              key={id}
              href={href({ company: id })}
              className={tab(picked === id)}
            >
              {name}
            </Link>
          ))}
        </nav>
      </div>

      <section className="rounded-card border border-border bg-surface p-z4">
        <PeriodChart
          report={report}
          measure={measure}
          companyId={picked}
          labels={{ unknown: dash }}
          format={money}
        />
      </section>

      {/* THE SENTENCE THAT EXPLAINS EVERY DASH, PRINTED ONCE. */}
      {report.firstSettledPeriodStart ? (
        <p className="text-sm text-ink-subtle">
          {t('money.byCompany.payFrom').replace(
            '{period}',
            report.firstSettledPeriodStart.toISOString().slice(0, 10),
          )}
        </p>
      ) : (
        <p className="text-sm text-ink-subtle">
          {t('money.byCompany.payNever')}
        </p>
      )}

      <section className="overflow-x-auto rounded-card border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-start text-ink-subtle">
              <th className="p-z3 text-start">{t('money.byCompany.period')}</th>
              <th className="p-z3 text-start">
                {t('money.byCompany.company')}
              </th>
              <th className="p-z3 text-end">{t('money.byCompany.gross')}</th>
              <th className="p-z3 text-end">
                {t('money.byCompany.afterDriverPay')}
              </th>
            </tr>
          </thead>
          <tbody>
            {report.periods.map((period) => {
              const rows =
                picked === null
                  ? [...period.companies, period.all]
                  : period.companies.filter((cell) => cell.companyId === picked)
              return rows.map((cell, index) => (
                <tr
                  key={`${period.periodStart.toISOString()}-${cell.companyId}`}
                  className={`border-b border-border ${
                    cell.companyId === 'all' ? 'font-semibold text-ink' : ''
                  }`}
                >
                  <td className="p-z3 text-ink-subtle">
                    {index === 0
                      ? period.periodStart.toISOString().slice(0, 10)
                      : ''}
                  </td>
                  <td className="p-z3 text-ink">
                    {cell.companyId === 'all'
                      ? t('money.byCompany.all')
                      : cell.companyName}
                  </td>
                  <td className="p-z3 text-end tabular-nums text-ink">
                    {money(cell.grossCents)}
                    {/* MARKED AS SUCH, per the ruling: this much of the gross
                     * is a broker load quoting its own rate because nothing has
                     * been invoiced yet. */}
                    {cell.atRateCents > 0 ? (
                      <span
                        className="ms-z2 text-xs text-ink-subtle"
                        title={t('money.byCompany.atRateHint')}
                      >
                        {t('money.byCompany.atRate')}
                      </span>
                    ) : null}
                  </td>
                  <td className="p-z3 text-end tabular-nums text-ink">
                    {cell.afterDriverPayCents === null
                      ? dash
                      : money(cell.afterDriverPayCents)}
                  </td>
                </tr>
              ))
            })}
          </tbody>
        </table>
      </section>
    </main>
  )
}
