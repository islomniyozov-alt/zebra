import Link from 'next/link'
import { withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { formatCents } from '@/lib/money'
import { payWeekFor } from '@/lib/settlement-week'
import { thisWeekFor, type NothingReadyReason } from '@/lib/this-week'
import { SETTLEMENT_BATCH_TIMEOUT_MS } from '@/lib/settlement-batch'
import { WeekAction } from './WeekAction'
import { CompanyFilter } from './CompanyFilter'
import type { MessageKey } from '@/lib/i18n'

// MONEY → THIS WEEK. The Tuesday screen, ONE PAGE for the whole operation.
//
// Reshaped by Islom's ruling of 2026-09-11: the sister companies are one
// operation and settlement is org-wide. One period header, one Ready total,
// one held list and one blocked list with a company COLUMN, one Open batch.
//
// THE FILTER NARROWS THE LISTS AND NOT THE TOTALS. Ready is the number that
// becomes the batch, and the batch covers the organization — a Ready that
// changed when somebody picked an authority would be a figure that does not
// correspond to anything anybody can press a button on. The company filter is
// a reading aid, and is documented as one.
//
// ── EMPTY STATES SAY WHAT IS ABSENT ──────────────────────────────────────
//
// "No remittance for Aug 30 – Sep 5", never "$0.00". A zero is a measurement
// and an absence is not one; printing the first where the second is true is how
// somebody concludes Amazon paid nothing that week rather than that nobody has
// imported the file yet.

const day = (value: Date) => value.toISOString().slice(0, 10)

/** One sentence per reason. Named, so a fifth reason fails to compile here. */
const NOTHING_READY: Record<NothingReadyReason, MessageKey> = {
  closed_history: 'money.nothing.closedHistory',
  blocked: 'money.nothing.blocked',
  held: 'money.nothing.held',
  no_freight: 'money.nothing.noFreight',
}

const HELD_REASON = (kind: string): MessageKey =>
  kind === 'no_remittance'
    ? 'batch.held.noRemittance'
    : kind === 'over'
      ? 'batch.held.over'
      : 'batch.held.short'

export default async function ThisWeekPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>
}) {
  const { t, locale } = await getLocaleContext()
  const { company: picked } = await searchParams

  // COMPUTED FROM TODAY, SERVER-SIDE. The period is not a URL parameter: a
  // stale tab left open over a weekend would otherwise offer to settle a
  // fortnight-old week with today's button.
  const { period, payDay } = payWeekFor(new Date())

  const week = await withCurrentOrg(
    'read',
    'settlement',
    (tx) => thisWeekFor(tx, { period, payDay }),
    { timeoutMs: SETTLEMENT_BATCH_TIMEOUT_MS },
  )

  // AN UNKNOWN COMPANY IN THE URL IS IGNORED, not an error and not an empty
  // page: a stale bookmark from before an authority was renamed should show
  // the week, not nothing.
  const filter = week.companies.some((company) => company.id === picked)
    ? picked
    : undefined
  const mine = <T extends { companyId: string }>(rows: readonly T[]) =>
    filter ? rows.filter((row) => row.companyId === filter) : [...rows]

  const held = mine(week.held)
  const blocked = mine(week.blocked)
  const remittances = mine(week.remittances)
  const factoring = mine(week.factoring)
  const periodLabel = `${day(period.start)} — ${day(period.end)}`

  return (
    <div className="flex flex-col gap-z5 p-z5">
      <header className="flex flex-col gap-z1">
        <h1 className="text-lg font-medium text-ink">{t('money.title')}</h1>
        <p className="text-sm text-ink-2">
          <span className="font-mono">{periodLabel}</span>
          {' · '}
          {t('money.paysOn')} <span className="font-mono">{day(payDay)}</span>
        </p>
        {/* SAID OUT LOUD, because the surprising thing about this screen is
         * which week it is about. The company pays two weeks behind (§0), so
         * this is deliberately NOT the week that just closed. */}
        <p className="text-xs text-ink-3">{t('money.periodHint')}</p>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-z3">
        <CompanyFilter
          companies={week.companies}
          selected={filter ?? null}
          labels={{ all: t('money.allCompanies'), label: t('batch.company') }}
        />
        <WeekAction
          batchId={week.batch.id}
          action={week.batch.action}
          labels={{
            open: t('money.openBatch'),
            continueDraft: t('money.continueDraft'),
            markPaid: t('batch.markPaid'),
            settled: t('money.alreadyPaid'),
          }}
        />
      </div>

      {/* READY — the number that becomes the batch, or WHY THERE IS NONE.
       *
       * ONE TOTAL FOR THE ORGANIZATION, and it does not move when the filter
       * does: the batch is org-wide, so a Ready that narrowed with a reading
       * aid would be a figure nobody can press a button on. */}
      {week.nothingReady === null ? (
        <p className="text-sm text-ink">
          <span className="font-medium">{t('money.ready')}</span>{' '}
          <span className="font-mono">{week.ready.loads}</span>{' '}
          {t('money.loadsAcross')}{' '}
          <span className="font-mono">{week.ready.drivers}</span>{' '}
          {t('money.drivers')}
          {' · '}
          <span className="font-mono">
            {formatCents(week.ready.grossCents, locale)}
          </span>
        </p>
      ) : (
        <p className="text-sm text-ink-3">
          <span className="font-medium text-ink-2">{t('money.ready')}</span>{' '}
          {t(NOTHING_READY[week.nothingReady])}
        </p>
      )}

      {/* REMITTANCES, PER AUTHORITY — each is paid separately, so these cannot
       * be summed into the one total above. A missing one is a warning and
       * never a blocker: broker freight and standing deductions still settle,
       * and the Amazon lines hold themselves in the list below. */}
      {remittances.map((row) =>
        row.found ? (
          <p key={row.companyId} className="text-sm text-ink-2">
            <span className="font-medium text-ink">{row.companyName}</span>
            {' · '}
            {t('money.remittance')}{' '}
            <span className="font-mono">{row.invoiceNumber}</span>
            {' · '}
            <span className="font-mono">
              {formatCents(row.totalCents ?? 0, locale)}
            </span>
          </p>
        ) : (
          <p
            key={row.companyId}
            className="rounded-card border border-warning bg-warning-soft px-z3 py-z2 text-sm text-warning"
          >
            <span className="font-medium">{row.companyName}</span>
            {' — '}
            {t('money.remittanceMissing')}{' '}
            <span className="font-mono">{periodLabel}</span>
            {'. '}
            {t('money.remittanceMissingHint')}
          </p>
        ),
      )}

      {/* BLOCKED DRIVERS ABOVE HELD LINES — a held line is a load left out of
       * a correct statement; a blocked driver is a person who gets no
       * statement at all. */}
      {blocked.length > 0 ? (
        <section className="rounded-card border border-danger bg-surface p-z4">
          <h2 className="text-md font-medium text-danger">
            {t('batch.blockers')}
          </h2>
          <table className="mt-z2 w-full text-sm">
            <thead className="text-xs uppercase text-ink-2">
              <tr>
                <th className="py-z1 text-start">{t('batch.driver')}</th>
                <th className="py-z1 text-start">{t('batch.company')}</th>
                <th className="py-z1 text-start">{t('money.reason')}</th>
              </tr>
            </thead>
            <tbody>
              {blocked.map((driver) => (
                <tr key={driver.driverId} className="border-t border-border">
                  <td className="py-z1">
                    <Link
                      href={`/drivers/${driver.driverId}`}
                      className="underline underline-offset-2 hover:text-accent"
                    >
                      {driver.driverName}
                    </Link>
                  </td>
                  <td className="py-z1 text-ink-2">{driver.companyName}</td>
                  <td className="py-z1 text-ink-3">
                    {t('batch.blocker.noPayRule')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {held.length > 0 ? (
        <section className="rounded-card border border-border bg-surface p-z4">
          <h2 className="text-md font-medium text-ink">
            {t('batch.held')}{' '}
            <span className="font-mono text-ink-3">
              {held.length} ·{' '}
              {formatCents(
                held.reduce((sum, row) => sum + row.bookedCents, 0),
                locale,
              )}
            </span>
          </h2>
          <table className="mt-z2 w-full text-sm">
            <thead className="text-xs uppercase text-ink-2">
              <tr>
                <th className="py-z1 text-start">{t('batch.loads')}</th>
                <th className="py-z1 text-start">{t('batch.company')}</th>
                <th className="py-z1 text-start">{t('batch.driver')}</th>
                <th className="py-z1 text-start">{t('money.reason')}</th>
                <th className="py-z1 text-end">{t('money.remittedBooked')}</th>
              </tr>
            </thead>
            <tbody>
              {held.map((row) => (
                <tr key={row.loadId} className="border-t border-border">
                  <td className="py-z1">
                    <Link
                      href={`/loads/${row.loadId}`}
                      className="font-mono underline underline-offset-2 hover:text-accent"
                    >
                      {row.loadNumber}
                    </Link>
                  </td>
                  <td className="py-z1 text-ink-2">{row.companyName}</td>
                  <td className="py-z1 text-ink-2">{row.driverName}</td>
                  <td className="py-z1 text-ink-3">
                    {t(HELD_REASON(row.reason))}
                  </td>
                  <td className="py-z1 text-end font-mono text-xs text-ink-3">
                    {row.remittedCents === null
                      ? '—'
                      : `${formatCents(row.remittedCents, locale)} / ${formatCents(row.bookedCents, locale)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {/* FACTORING, PER AUTHORITY — an invoice carries one authority's MC and
       * goes outside, so this stays a per-company fact even though settlement
       * no longer is. */}
      {factoring.map((row) => (
        <p key={row.companyId} className="text-sm text-ink-2">
          <span className="font-medium text-ink">{row.companyName}</span>
          {' · '}
          {t('money.werner')}{' '}
          <span className="font-mono">{row.filedUnpaid}</span>{' '}
          {t('money.filedUnpaid')}
          {row.oldestFiledAt ? (
            <>
              {' ('}
              {t('money.oldest')}{' '}
              <span className="font-mono">{day(row.oldestFiledAt)}</span>
              {')'}
            </>
          ) : null}
          {' · '}
          <span className="font-mono">{row.readyToFile}</span>{' '}
          {t('money.readyToFile')}
          {' · '}
          <span className="font-mono">{row.notReady}</span>{' '}
          {t('money.notReady')}
          {row.commonestMissing ? (
            <>
              {' — '}
              {t('money.mostOftenMissing')}{' '}
              <span className="text-ink">{row.commonestMissing}</span>
            </>
          ) : null}
        </p>
      ))}

      {week.recent.length > 0 ? (
        <table className="w-full text-xs">
          <thead className="text-ink-2">
            <tr>
              <th className="py-z1 text-start">{t('batch.statement')}</th>
              <th className="py-z1 text-start">{t('batch.week')}</th>
              <th className="py-z1 text-start">{t('money.status')}</th>
              <th className="py-z1 text-end">{t('money.statements')}</th>
              <th className="py-z1 text-end">{t('batch.net')}</th>
            </tr>
          </thead>
          <tbody>
            {week.recent.map((batch) => (
              <tr key={batch.id} className="border-t border-border">
                <td className="py-z1">
                  <Link
                    href={`/settlements/batches/${batch.id}`}
                    className="font-mono hover:text-accent"
                  >
                    {batch.batchNumber ?? batch.status}
                  </Link>
                </td>
                <td className="py-z1 font-mono">
                  {day(batch.periodStart)} — {day(batch.periodEnd)}
                </td>
                <td className="py-z1">{batch.status}</td>
                <td className="py-z1 text-end font-mono">{batch.statements}</td>
                <td className="py-z1 text-end font-mono">
                  {formatCents(batch.netCents, locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  )
}
