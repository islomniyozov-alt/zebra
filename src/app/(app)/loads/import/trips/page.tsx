import { notFound } from 'next/navigation'
import { SELECTABLE_AUTHORITY } from '@/lib/companies'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyIdScopeFilter } from '@/lib/tenancy'
import { lastUsedAuthority } from '../../../_reference/shared'
import { TripsImportForm } from './TripsImportForm'

// Loads → Import → Amazon Relay TRIPS.
//
// GATED ON `load:create`, the same as the load-board import beside it and for
// the same reason: this screen books loads, in bulk, and a role that may book
// one may book forty. A second permission for the same act would be a wall
// with a door next to it.

export default async function TripsImportPage() {
  if (!(await currentUserCan('create', 'load'))) notFound()

  const { t } = await getLocaleContext()

  const companies = await withCurrentOrg('read', 'load', (tx, session) =>
    tx.company.findMany({
      // `id`, not `companyId` — Company IS the authority. See tenancy.ts.
      where: {
        ...SELECTABLE_AUTHORITY,
        ...companyIdScopeFilter(session.companyScopes),
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  )

  const remembered = await lastUsedAuthority()

  return (
    <div className="flex flex-col gap-z4">
      <div className="flex flex-col gap-z1">
        <h1 className="text-xl font-semibold text-ink">{t('trips.title')}</h1>
        <p className="text-sm text-ink-2">{t('trips.subtitle')}</p>
        {/* THE CROSS-LINK IS GONE. It offered the other reading of the same
         * file as a link at the top of the screen — before anybody had chosen
         * a file, let alone seen what either reading would produce. That is
         * the wrong-screen trap: a choice presented as navigation, decided
         * without information. The same capability is now a button ON the
         * preview, printing what it would make. */}
      </div>

      <TripsImportForm
        companies={companies}
        defaultCompanyId={
          companies.find((company) => company.id === remembered)?.id ??
          companies[0]?.id ??
          ''
        }
        labels={{
          authority: t('relay.authority'),
          choose: t('relay.choose'),
          file: t('relay.file'),
          preview: t('trips.preview'),
          previewTitle: t('trips.previewTitle'),
          previewOne: t('trips.previewOne'),
          previewNone: t('trips.previewNone'),
          trip: t('trips.trip'),
          lane: t('trips.lane'),
          stops: t('trips.stops'),
          miles: t('trips.miles'),
          what: t('trips.what'),
          driver: t('trips.driver'),
          equipment: t('trips.equipment'),
          rate: t('relay.rate'),
          willCreate: t('trips.willCreate'),
          willEnrich: t('trips.willEnrich'),
          unchanged: t('trips.unchanged'),
          skippedLegs: t('trips.skippedLegs'),
          previewTrip: t('trips.previewTrip'),
          previewTrips: t('trips.previewTrips'),
          perRow: t('trips.perRow'),
          stageUpcoming: t('trips.stageUpcoming'),
          stageFinished: t('trips.stageFinished'),
          stageRunning: t('trips.stageRunning'),
          unresolvedTitle: t('trips.unresolvedTitle'),
          noAddressTitle: t('trips.noAddressTitle'),
          warningsTitle: t('trips.warningsTitle'),
          notAssigned: t('trips.notAssigned'),
          confirm: t('trips.confirm'),
          back: t('trips.back'),
          stale: t('trips.stale'),
          done: t('trips.done'),
          toLoads: t('trips.toLoads'),
        }}
      />
    </div>
  )
}
