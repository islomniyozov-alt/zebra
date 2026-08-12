import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyIdScopeFilter } from '@/lib/tenancy'
import { lastUsedAuthority } from '../../_reference/shared'
import { RelayImportForm } from './RelayImportForm'

// Loads → Import from Amazon Relay (Phase 6 §3a).
//
// GATED ON `load:create`, because that is exactly what this screen does — in
// bulk. There is no separate import permission: a role that may book a load
// may book forty-five of them, and inventing a second permission for the same
// act would be a wall with a door beside it.

export default async function RelayImportPage() {
  if (!(await currentUserCan('create', 'load'))) notFound()

  const { t } = await getLocaleContext()

  const companies = await withCurrentOrg('read', 'load', (tx, session) =>
    tx.company.findMany({
      // `id`, not `companyId` — Company IS the authority. See tenancy.ts.
      where: { isActive: true, ...companyIdScopeFilter(session.companyScopes) },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  )

  const remembered = await lastUsedAuthority()

  return (
    <div className="flex flex-col gap-z4">
      <div className="flex flex-col gap-z1">
        <h1 className="text-xl font-semibold text-ink">{t('relay.title')}</h1>
        <p className="text-sm text-ink-2">{t('relay.subtitle')}</p>
      </div>

      <RelayImportForm
        companies={companies}
        defaultCompanyId={
          companies.find((company) => company.id === remembered)?.id ??
          companies[0]?.id ??
          ''
        }
        labels={{
          authority: t('relay.authority'),
          mode: t('relay.mode'),
          modeBooked: t('relay.modeBooked'),
          modeBookedHint: t('relay.modeBookedHint'),
          modeDelivered: t('relay.modeDelivered'),
          modeDeliveredHint: t('relay.modeDeliveredHint'),
          choose: t('relay.choose'),
          file: t('relay.file'),
          preview: t('relay.preview'),
          previewTitle: t('relay.previewTitle'),
          previewOne: t('relay.previewOne'),
          previewNone: t('relay.previewNone'),
          confirm: t('relay.confirm'),
          back: t('relay.back'),
          row: t('relay.row'),
          loadId: t('relay.loadId'),
          lane: t('relay.lane'),
          stops: t('relay.stops'),
          first: t('relay.first'),
          last: t('relay.last'),
          miles: t('relay.miles'),
          rate: t('relay.rate'),
          skippedTitle: t('relay.skippedTitle'),
          warningsTitle: t('relay.warningsTitle'),
          done: t('relay.done'),
          doneFailed: t('relay.doneFailed'),
          stale: t('relay.stale'),
          why: t('relay.why'),
          toLoads: t('relay.toLoads'),
          noFile: t('relay.error.noFile'),
        }}
      />
    </div>
  )
}
