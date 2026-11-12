import { notFound } from 'next/navigation'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { formatCents } from '@/lib/money'
import { renderDateOnly } from '@/lib/stop-time'
import { operationalLabelKey, operationalTone } from '@/lib/status'
import { ownDriver, ownLoads } from '@/lib/portal'
import { NoDriverRow } from '../../NoDriverRow'

// MY LOADS (§9; brief §1.2): the driver's own loads — either seat — open ones
// first, then the last thirty days of finished ones. Status word and badge,
// city to city, the pickup date, and THE DRIVER'S OWN PAY only once the
// settlement that includes it is finalised (§4.3): no projected pay, never
// the broker's rate, never revenue.

export default async function PortalLoadsPage() {
  const { t, locale } = await getLocaleContext()
  if (!(await currentUserCan('read', 'portal.load'))) notFound()

  const data = await withCurrentOrg(
    'read',
    'portal.load',
    async (tx, session) => {
      const driver = await ownDriver(tx, session)
      if (!driver) return null
      return { rows: await ownLoads(tx, driver.id, new Date()) }
    },
  )
  if (!data) return <NoDriverRow sentence={t('portal.noDriver')} />

  return (
    <section className="flex flex-col gap-z3 px-z4 py-z4">
      <h1 className="text-lg font-medium">{t('portal.loads.title')}</h1>
      {data.rows.length === 0 ? (
        <p className="text-base text-ink-2">{t('portal.loads.none')}</p>
      ) : (
        <ul className="flex flex-col gap-z2">
          {data.rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-col gap-z1 rounded-card border border-border bg-surface p-z3"
            >
              <div className="flex items-center justify-between gap-z2">
                <span dir="ltr" className="text-base font-medium">
                  {row.loadNumber}
                </span>
                <StatusBadge
                  tone={
                    row.isCancelled
                      ? 'muted'
                      : operationalTone(row.operationalStatus)
                  }
                  label={
                    row.isCancelled
                      ? t('portal.loads.cancelled')
                      : t(operationalLabelKey(row.operationalStatus))
                  }
                />
              </div>
              <p className="text-sm text-ink-2">
                {row.from ?? '—'} → {row.to ?? '—'}
              </p>
              <div className="flex items-center justify-between gap-z2 text-sm">
                <span className="text-ink-3" dir="ltr">
                  {renderDateOnly(row.pickupAt, locale) ?? '—'}
                </span>
                {row.payCents === null ? null : (
                  <span>
                    <span className="text-ink-3">{t('portal.loads.pay')}</span>{' '}
                    <span dir="ltr" className="font-medium">
                      {formatCents(row.payCents, locale)}
                    </span>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
