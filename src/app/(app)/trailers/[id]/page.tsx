import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyIdScopeFilter } from '@/lib/tenancy'
import { currentAuthority } from '@/lib/fleet'
import { RecordForm } from '@/components/forms/RecordForm'
import { AssetActions } from '../../_reference/AssetActions'
import { updateTrailerAction } from '../actions'
import { trailerFields } from '../fields'
import {
  restoreAssetAction,
  retireAssetAction,
  transferAssetAction,
} from '../../_reference/asset-actions'

export default async function EditTrailerPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { t } = await getLocaleContext()

  const data = await withCurrentOrg('read', 'trailer', async (tx, session) => {
    const trailer = await tx.trailer.findUnique({ where: { id } })
    if (!trailer) return null

    const companies = await tx.company.findMany({
      // `id`, not `companyId` — Company IS the authority. See tenancy.ts.
      where: {
        isActive: true,
        ...companyIdScopeFilter(session.companyScopes),
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    })

    const open = await currentAuthority(tx, 'trailer', id)
    const openCompany = open
      ? (companies.find((c) => c.id === open.companyId)?.name ?? null)
      : null

    return { trailer, companies, openCompany }
  })

  if (!data) notFound()
  const { trailer, companies, openCompany } = data

  const mayEdit = await currentUserCan('update', 'trailer')
  const mayDelete = await currentUserCan('delete', 'trailer')
  const authorities = companies.map((c) => ({ value: c.id, label: c.name }))

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="text-lg font-medium text-ink">
          {t('trailers.edit')}{' '}
          <span className="font-mono text-ink-2">{trailer.unitNumber}</span>
        </h1>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2 px-gutter py-z5">
        <RecordForm
          fields={trailerFields(t, authorities, 'edit')}
          values={{
            unitNumber: trailer.unitNumber,
            type: trailer.type ?? '',
            year: trailer.year === null ? '' : String(trailer.year),
            vin: trailer.vin ?? '',
            plate: trailer.plate ?? '',
            plateState: trailer.plateState ?? '',
            status: trailer.status,
            ownershipType: trailer.ownershipType,
            notes: trailer.notes ?? '',
          }}
          action={updateTrailerAction.bind(null, id)}
          cancelHref="/trailers"
          labels={{ save: t('ref.save'), cancel: t('ref.cancel') }}
        >
          {mayEdit ? (
            <AssetActions
              kind="trailer"
              id={id}
              isRetired={trailer.deletedAt !== null}
              authorities={authorities.filter(
                (a) => a.value !== trailer.companyId,
              )}
              currentAuthorityName={
                openCompany ??
                companies.find((c) => c.id === trailer.companyId)?.name ??
                null
              }
              transferAction={transferAssetAction.bind(null, 'trailer', id)}
              retireAction={
                mayDelete
                  ? retireAssetAction.bind(null, 'trailer', id)
                  : async () => {
                      'use server'
                    }
              }
              restoreAction={restoreAssetAction.bind(null, 'trailer', id)}
              labels={{
                transfer: t('ref.transfer'),
                transferTitle: t('ref.transferTitle'),
                transferBody: t('ref.transferBody'),
                transferTo: t('ref.transferTo'),
                transferReason: t('ref.transferReason'),
                transferConfirm: t('ref.transferConfirm'),
                retire: t('ref.retire'),
                retireConfirm: t('ref.retireConfirm'),
                retireBody: t('ref.retireBody'),
                restore: t('ref.restore'),
                cancel: t('ref.cancel'),
                currentAuthority: t('ref.currentAuthority'),
                noOpenPeriod: t('ref.noOpenPeriod'),
              }}
            />
          ) : null}
        </RecordForm>
      </div>
    </>
  )
}
