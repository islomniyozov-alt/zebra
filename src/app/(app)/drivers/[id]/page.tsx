import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyScopeFilter } from '@/lib/tenancy'
import { currentAuthority } from '@/lib/fleet'
import { RecordForm } from '@/components/forms/RecordForm'
import { AssetActions } from '../../_reference/AssetActions'
import { updateDriverAction } from '../actions'
import { driverFields } from '../fields'
import { dateInputValue } from '../../_reference/shared'
import {
  restoreAssetAction,
  retireAssetAction,
  transferAssetAction,
} from '../../_reference/asset-actions'

export default async function EditDriverPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { t } = await getLocaleContext()

  const data = await withCurrentOrg('read', 'driver', async (tx, session) => {
    const driver = await tx.driver.findUnique({ where: { id } })
    if (!driver) return null

    const companies = await tx.company.findMany({
      where: { isActive: true, ...companyScopeFilter(session.companyScopes) },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    })

    const open = await currentAuthority(tx, 'driver', id)
    const openCompany = open
      ? (companies.find((c) => c.id === open.companyId)?.name ?? null)
      : null

    return { driver, companies, openCompany }
  })

  if (!data) notFound()
  const { driver, companies, openCompany } = data

  const mayEdit = await currentUserCan('update', 'driver')
  const mayDelete = await currentUserCan('delete', 'driver')
  const authorities = companies.map((c) => ({ value: c.id, label: c.name }))

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="text-lg font-medium text-ink">
          {t('drivers.edit')}{' '}
          <span className="text-ink-2">
            {driver.firstName} {driver.lastName}
          </span>
        </h1>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2 px-gutter py-z5">
        <RecordForm
          fields={driverFields(t, authorities, 'edit')}
          values={{
            firstName: driver.firstName,
            lastName: driver.lastName,
            phone: driver.phone ?? '',
            email: driver.email ?? '',
            cdlNumber: driver.cdlNumber ?? '',
            cdlState: driver.cdlState ?? '',
            cdlClass: driver.cdlClass ?? '',
            hireDate: dateInputValue(driver.hireDate),
            status: driver.status,
            employmentType: driver.employmentType,
            notes: driver.notes ?? '',
          }}
          action={updateDriverAction.bind(null, id)}
          cancelHref="/drivers"
          labels={{ save: t('ref.save'), cancel: t('ref.cancel') }}
        >
          {mayEdit ? (
            <AssetActions
              kind="driver"
              id={id}
              isRetired={driver.deletedAt !== null}
              authorities={authorities.filter(
                (a) => a.value !== driver.companyId,
              )}
              currentAuthorityName={
                openCompany ??
                companies.find((c) => c.id === driver.companyId)?.name ??
                null
              }
              transferAction={transferAssetAction.bind(null, 'driver', id)}
              retireAction={
                mayDelete
                  ? retireAssetAction.bind(null, 'driver', id)
                  : async () => {
                      'use server'
                    }
              }
              restoreAction={restoreAssetAction.bind(null, 'driver', id)}
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
