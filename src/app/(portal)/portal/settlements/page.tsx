import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { formatCents } from '@/lib/money'
import { renderDateOnly } from '@/lib/stop-time'
import { isPlaceholderNumber } from '@/lib/settlement-number'
import { ownDriver, ownSettlements } from '@/lib/portal'
import { NoDriverRow } from '../../NoDriverRow'

// SETTLEMENTS (§9; brief §1.4): the driver's own statements, FINALISED ONLY —
// APPROVED or PAID (§4.2, owner's ruling) — newest first: period, gross,
// deductions, net, the paid date, and the statement PDF through the portal's
// own route, gated by the own-settlements predicate. A DRAFT is absent, not
// shown with a word on it.

export default async function PortalSettlementsPage() {
  const { t, locale } = await getLocaleContext()
  if (!(await currentUserCan('read', 'portal.settlement'))) notFound()

  const data = await withCurrentOrg(
    'read',
    'portal.settlement',
    async (tx, session) => {
      const driver = await ownDriver(tx, session)
      if (!driver) return null
      return { rows: await ownSettlements(tx, driver.id) }
    },
  )
  if (!data) return <NoDriverRow sentence={t('portal.noDriver')} />

  return (
    <section className="flex flex-col gap-z3 px-z4 py-z4">
      <h1 className="text-lg font-medium">{t('portal.settlements.title')}</h1>
      {data.rows.length === 0 ? (
        <p className="text-base text-ink-2">{t('portal.settlements.none')}</p>
      ) : (
        <ul className="flex flex-col gap-z2">
          {data.rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-col gap-z2 rounded-card border border-border bg-surface p-z3"
            >
              <div className="flex items-center justify-between gap-z2">
                <span dir="ltr" className="text-base font-medium">
                  {isPlaceholderNumber(row.settlementNumber)
                    ? t('portal.settlements.unnumbered')
                    : row.settlementNumber}
                </span>
                <span className="text-sm text-ink-2">
                  {row.status === 'PAID'
                    ? `${t('portal.settlements.paid')} ${renderDateOnly(row.paidAt, locale) ?? ''}`.trim()
                    : t('portal.settlements.approved')}
                </span>
              </div>
              <p className="text-sm text-ink-2" dir="ltr">
                {renderDateOnly(row.periodStart, locale)} –{' '}
                {renderDateOnly(row.periodEnd, locale)}
              </p>
              <dl className="grid grid-cols-3 gap-z2 text-sm">
                <div>
                  <dt className="text-xs text-ink-3">
                    {t('portal.settlements.gross')}
                  </dt>
                  <dd dir="ltr">{formatCents(row.grossCents, locale)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-3">
                    {t('portal.settlements.deductions')}
                  </dt>
                  <dd dir="ltr">{formatCents(row.deductionsCents, locale)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-3">
                    {t('portal.settlements.net')}
                  </dt>
                  <dd dir="ltr" className="font-medium">
                    {formatCents(row.netCents, locale)}
                  </dd>
                </div>
              </dl>
              <a
                href={`/api/portal/statements/${row.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[44px] items-center justify-center rounded-control border border-border-strong bg-surface px-z4 text-base font-medium text-ink"
              >
                {t('portal.settlements.pdf')}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
