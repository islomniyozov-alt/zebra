import Link from 'next/link'
import { withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { formatCents } from '@/lib/money'
import { payWeekFor } from '@/lib/settlement-week'
import {
  thisWeekFor,
  type CompanyWeek,
  type NothingReadyReason,
} from '@/lib/this-week'
import { SETTLEMENT_BATCH_TIMEOUT_MS } from '@/lib/settlement-batch'
import { WeekAction } from './WeekAction'
import type { MessageKey } from '@/lib/i18n'

// MONEY → THIS WEEK. The Tuesday screen.
//
// ── EMPTY STATES SAY WHAT IS ABSENT ──────────────────────────────────────
//
// "No remittance for Aug 30 – Sep 5", never "$0.00". A zero is a measurement
// and an absence is not one; printing the first where the second is true is how
// somebody concludes Amazon paid nothing that week rather than that nobody has
// imported the file yet. The same rule the statement follows for an empty
// section, applied to a screen.

const day = (value: Date) => value.toISOString().slice(0, 10)

/** One sentence per reason. Named, so a fifth reason fails to compile here. */
const NOTHING_READY: Record<NothingReadyReason, MessageKey> = {
  closed_history: 'money.nothing.closedHistory',
  blocked: 'money.nothing.blocked',
  held: 'money.nothing.held',
  no_freight: 'money.nothing.noFreight',
}

export default async function ThisWeekPage() {
  const { t, locale } = await getLocaleContext()

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

      {week.companies.map((company) => (
        <CompanySection
          key={company.companyId}
          company={company}
          periodLabel={periodLabel}
          locale={locale}
          t={t}
        />
      ))}

      {week.companies.length === 0 ? (
        <p className="text-sm text-ink-3">{t('money.noCompanies')}</p>
      ) : null}
    </div>
  )
}

function CompanySection({
  company,
  periodLabel,
  locale,
  t,
}: {
  company: CompanyWeek
  periodLabel: string
  locale: string
  t: (key: MessageKey) => string
}) {
  const heldReason = (kind: string): MessageKey =>
    kind === 'no_remittance'
      ? 'batch.held.noRemittance'
      : kind === 'over'
        ? 'batch.held.over'
        : 'batch.held.short'

  return (
    <section className="rounded-card border border-border bg-surface p-z4">
      <div className="flex flex-wrap items-baseline justify-between gap-z3">
        <h2 className="text-md font-medium text-ink">{company.companyName}</h2>
        <WeekAction
          companyId={company.companyId}
          batchId={company.batch.id}
          action={company.batch.action}
          labels={{
            open: t('money.openBatch'),
            continueDraft: t('money.continueDraft'),
            markPaid: t('batch.markPaid'),
            settled: t('money.alreadyPaid'),
          }}
        />
      </div>

      {/* THE REMITTANCE WARNING IS AT THE TOP AND IS NOT A BLOCKER. Werner
       * freight and idle-driver deductions still settle; the Amazon lines hold
       * themselves with "no remittance", which is the held list below. */}
      {company.remittance && !company.remittance.found ? (
        <p className="mt-z3 rounded-card border border-warning bg-warning-soft px-z3 py-z2 text-sm text-warning">
          <span className="font-medium">{t('money.remittanceMissing')}</span>{' '}
          <span className="font-mono">{periodLabel}</span>
          {' — '}
          {t('money.remittanceMissingHint')}
        </p>
      ) : null}

      {company.remittance?.found ? (
        <p className="mt-z3 text-sm text-ink-2">
          {t('money.remittance')}{' '}
          <span className="font-mono">{company.remittance.invoiceNumber}</span>
          {' · '}
          <span className="font-mono">
            {formatCents(company.remittance.totalCents ?? 0, locale)}
          </span>
          {company.remittance.importedAt ? (
            <>
              {' · '}
              {t('money.importedOn')}{' '}
              <span className="font-mono">
                {day(company.remittance.importedAt)}
              </span>
            </>
          ) : null}
        </p>
      ) : null}

      {/* READY — the number that becomes the batch, or WHY THERE IS NONE.
       *
       * Never "$0.00". A zero is a measurement and an absence is not one, and
       * the four reasons lead four different places: a blocked driver is
       * somebody's afternoon, a held line is a phone call, closed history is
       * nothing at all. During the cutover the last is the commonest answer —
       * 62 of 62 Dolphins deliveries in the week of Aug 30 settled in
       * Datatruck — and reading "$0.00" for that is how somebody concludes
       * the software is broken. */}
      {company.nothingReady === null ? (
        <p className="mt-z3 text-sm text-ink">
          <span className="font-medium">{t('money.ready')}</span>{' '}
          <span className="font-mono">{company.ready.loads}</span>{' '}
          {t('money.loadsAcross')}{' '}
          <span className="font-mono">{company.ready.drivers}</span>{' '}
          {t('money.drivers')}
          {' · '}
          <span className="font-mono">
            {formatCents(company.ready.grossCents, locale)}
          </span>
        </p>
      ) : (
        <p className="mt-z3 text-sm text-ink-3">
          <span className="font-medium text-ink-2">{t('money.ready')}</span>{' '}
          {t(NOTHING_READY[company.nothingReady])}
        </p>
      )}

      {/* BLOCKED DRIVERS, BY NAME, ABOVE THE HELD LINES — a held line is a load
       * left out of a correct statement; a blocked driver is a person who gets
       * no statement at all. */}
      {company.blocked.length > 0 ? (
        <div className="mt-z4">
          <h3 className="text-sm font-medium text-danger">
            {t('batch.blockers')}
          </h3>
          <ul className="mt-z2 flex flex-col gap-z1 text-sm">
            {company.blocked.map((driver) => (
              <li key={driver.driverId}>
                <Link
                  href={`/drivers/${driver.driverId}`}
                  className="underline underline-offset-2 hover:text-accent"
                >
                  {driver.driverName}
                </Link>{' '}
                <span className="text-ink-3">
                  {t('batch.blocker.noPayRule')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {company.held.length > 0 ? (
        <div className="mt-z4">
          <h3 className="text-sm font-medium text-ink">
            {t('batch.held')}{' '}
            <span className="font-mono text-ink-3">
              {company.held.length} ·{' '}
              {formatCents(company.heldSumCents, locale)}
            </span>
          </h3>
          <ul className="mt-z2 flex flex-col gap-z1 text-sm">
            {company.held.map((row) => (
              <li key={row.loadId} className="flex flex-wrap gap-z2">
                <Link
                  href={`/loads/${row.loadId}`}
                  className="font-mono underline underline-offset-2 hover:text-accent"
                >
                  {row.loadNumber}
                </Link>
                <span className="text-ink-2">{row.driverName}</span>
                <span className="text-ink-3">{t(heldReason(row.reason))}</span>
                {row.remittedCents !== null ? (
                  <span className="font-mono text-xs text-ink-3">
                    {formatCents(row.remittedCents, locale)} /{' '}
                    {formatCents(row.bookedCents, locale)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* WERNER — absent entirely on a company whose freight is all
       * direct-settled, because nothing there is ever invoiced or factored. */}
      {company.werner ? (
        <p className="mt-z4 text-sm text-ink-2">
          <span className="font-medium text-ink">{t('money.werner')}</span>{' '}
          <span className="font-mono">{company.werner.filedUnpaid}</span>{' '}
          {t('money.filedUnpaid')}
          {company.werner.oldestFiledAt ? (
            <>
              {' ('}
              {t('money.oldest')}{' '}
              <span className="font-mono">
                {day(company.werner.oldestFiledAt)}
              </span>
              {')'}
            </>
          ) : null}
          {' · '}
          <span className="font-mono">{company.werner.readyToFile}</span>{' '}
          {t('money.readyToFile')}
          {' · '}
          <span className="font-mono">{company.werner.notReady}</span>{' '}
          {t('money.notReady')}
          {company.werner.commonestMissing ? (
            <>
              {' — '}
              {t('money.mostOftenMissing')}{' '}
              <span className="text-ink">
                {company.werner.commonestMissing}
              </span>
            </>
          ) : null}
        </p>
      ) : null}

      {company.recent.length > 0 ? (
        <table className="mt-z4 w-full text-xs">
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
            {company.recent.map((batch) => (
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
    </section>
  )
}
