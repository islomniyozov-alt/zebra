import { notFound } from 'next/navigation'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { documentTypeLabels } from '@/lib/document-types'
import { formatAddress } from '@/lib/locations'
import { renderStopTime } from '@/lib/stop-time'
import { operationalLabelKey, operationalTone } from '@/lib/status'
import { currentLoad, documentsNeeded, nextStop, ownDriver } from '@/lib/portal'
import { nextStatusFor } from '@/lib/portal-status'
import type { MessageKey } from '@/lib/i18n'
import { NoDriverRow } from '../NoDriverRow'
import { StatusStep } from './StatusStep'

// HOME = THE CURRENT LOAD (§9; PHASE-7-BRIEF.md §1.1). The one open load the
// driver is on, stops in sequence with the facility's memory, every
// identifier `dir="ltr"`, and below it the documents the load still needs.
// The one primary action — the next status — lands with step 4; until then
// the screen reads and asks nothing.
//
// TWO STATEMENTS inside the tenant transaction (`HOME_STATEMENTS`): the own
// row, then the load with stops, locations and document types in one
// relation read. Measured in tests/integration/portal.test.ts.

export default async function PortalHomePage() {
  const { t, locale } = await getLocaleContext()
  // §6.8: a role without the read is REFUSED as a 404, never a 500.
  if (!(await currentUserCan('read', 'portal.load'))) notFound()

  const data = await withCurrentOrg(
    'read',
    'portal.load',
    async (tx, session) => {
      const driver = await ownDriver(tx, session)
      if (!driver) return null
      return { driver, load: await currentLoad(tx, driver.id) }
    },
  )

  if (!data) return <NoDriverRow sentence={t('portal.noDriver')} />
  const { driver, load } = data
  const typeLabels = documentTypeLabels(t)

  if (!load) {
    return (
      <section className="px-z4 py-z6">
        <h1 className="text-lg font-medium">{t('portal.home.title')}</h1>
        <p className="mt-z3 text-base text-ink-2">{t('portal.home.noLoad')}</p>
      </section>
    )
  }

  const next = nextStop(load)
  const needed = documentsNeeded(load)
  const nextStatus = nextStatusFor(load.operationalStatus)
  const when = (
    at: Date | null,
    stop: {
      state: string | null
      location: { timezone: string | null } | null
    },
  ) =>
    renderStopTime(at, stop.state, {
      fallbackZone: driver.timezone,
      locale,
      zone: stop.location?.timezone,
    })?.text ?? null

  return (
    <section className="flex flex-col gap-z4 px-z4 py-z4">
      <header className="flex flex-col gap-z1">
        <p className="text-xs uppercase tracking-[0.04em] text-ink-3">
          {t('portal.home.title')}
        </p>
        <h1 className="flex flex-wrap items-baseline gap-z2 text-lg font-medium">
          <span dir="ltr">{load.loadNumber}</span>
          <StatusBadge
            tone={operationalTone(load.operationalStatus)}
            label={t(operationalLabelKey(load.operationalStatus))}
          />
        </h1>
        {load.referenceNumber ? (
          <p className="text-sm text-ink-2">
            {t('portal.home.reference')}{' '}
            <span dir="ltr" className="text-ink">
              {load.referenceNumber}
            </span>
          </p>
        ) : null}
        {load.coDriverId === driver.id ? (
          <p className="text-sm text-ink-2">{t('portal.home.coDriver')}</p>
        ) : null}
      </header>

      {/* THE ONE PRIMARY ACTION (§9; step 4). The next rung for the DRIVER OF
       * RECORD; a co-driver reads a sentence instead, and a finished load says
       * the office takes it from here. The write refuses what the button could
       * not, so the absence of the button is never the rule. */}
      {load.driverId === driver.id ? (
        nextStatus ? (
          <StatusStep
            loadId={load.id}
            to={nextStatus}
            labels={{
              set: t('portal.status.set').replace(
                '{status}',
                t(operationalLabelKey(nextStatus)),
              ),
              setting: t('portal.status.setting'),
              landed: t('portal.status.landed'),
              word: t(operationalLabelKey(nextStatus)),
              queued: t('portal.status.queued'),
              failed: t('portal.status.failed'),
            }}
          />
        ) : (
          <p className="text-sm text-ink-2">{t('portal.status.finished')}</p>
        )
      ) : (
        <p className="rounded-card border border-border bg-surface p-z3 text-sm text-ink-2">
          {t('portal.status.coDriver')}
        </p>
      )}

      <ol className="flex flex-col gap-z3">
        {load.stops.map((stop) => {
          const address =
            formatAddress(stop) ?? formatAddress(stop.location) ?? null
          const scheduled = when(stop.scheduledAt, stop)
          const windowStart = when(stop.windowStart, stop)
          const windowEnd = when(stop.windowEnd, stop)
          const isNext = next?.id === stop.id
          return (
            <li
              key={stop.id}
              className={
                isNext
                  ? 'rounded-card border-2 border-accent bg-surface p-z4'
                  : 'rounded-card border border-border bg-surface p-z4'
              }
            >
              <p className="text-xs uppercase tracking-[0.04em] text-ink-3">
                {stop.sequence} · {t(`stop.${stop.type}` as MessageKey)}
                {isNext ? ` · ${t('portal.home.next')}` : ''}
                {stop.departedAt ? ` · ${t('portal.home.done')}` : ''}
              </p>
              <p className="mt-z1 text-base font-medium">{stop.name ?? '—'}</p>
              {address ? (
                <p dir="ltr" className="text-sm text-ink-2">
                  {address}
                </p>
              ) : null}
              <dl className="mt-z2 grid grid-cols-[auto_1fr] gap-x-z3 gap-y-z1 text-sm">
                {scheduled ? (
                  <>
                    <dt className="text-ink-3">{t('portal.stop.when')}</dt>
                    <dd dir="ltr">{scheduled}</dd>
                  </>
                ) : null}
                {windowStart && windowEnd ? (
                  <>
                    <dt className="text-ink-3">{t('portal.stop.window')}</dt>
                    <dd dir="ltr">
                      {windowStart} – {windowEnd}
                    </dd>
                  </>
                ) : null}
                {stop.referenceNumber ? (
                  <>
                    <dt className="text-ink-3">
                      {stop.type === 'DELIVERY'
                        ? t('portal.stop.delRef')
                        : t('portal.stop.puRef')}
                    </dt>
                    <dd dir="ltr">{stop.referenceNumber}</dd>
                  </>
                ) : null}
                {stop.location?.gateCode ? (
                  <>
                    <dt className="text-ink-3">{t('portal.stop.gate')}</dt>
                    <dd dir="ltr">{stop.location.gateCode}</dd>
                  </>
                ) : null}
                {stop.location?.dockNotes ? (
                  <>
                    <dt className="text-ink-3">{t('portal.stop.dock')}</dt>
                    <dd>{stop.location.dockNotes}</dd>
                  </>
                ) : null}
                {stop.instructions ? (
                  <>
                    <dt className="text-ink-3">{t('portal.stop.notes')}</dt>
                    <dd>{stop.instructions}</dd>
                  </>
                ) : null}
              </dl>
            </li>
          )
        })}
      </ol>

      {needed.length > 0 ? (
        <section className="rounded-card border border-warning bg-warning-soft p-z4">
          <h2 className="text-base font-medium">{t('portal.home.needs')}</h2>
          <ul className="mt-z1 list-disc ps-z4 text-sm">
            {needed.map((type) => (
              <li key={type}>{typeLabels[type]}</li>
            ))}
          </ul>
          <p className="mt-z2 text-xs text-ink-2">
            {t('portal.home.needsHint')}
          </p>
        </section>
      ) : null}

      {load.dispatcherNotes ? (
        <section className="rounded-card border border-border bg-surface p-z4">
          <h2 className="text-xs uppercase tracking-[0.04em] text-ink-3">
            {t('portal.home.dispatcherNotes')}
          </h2>
          <p className="mt-z1 text-sm">{load.dispatcherNotes}</p>
        </section>
      ) : null}
    </section>
  )
}
