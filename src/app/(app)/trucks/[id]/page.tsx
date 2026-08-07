import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyIdScopeFilter } from '@/lib/tenancy'
import { currentAuthority } from '@/lib/fleet'
import { CompliancePanel } from '../../_reference/CompliancePanel'
import { compliancePanelData } from '../../_reference/compliance-view'
import { MaintenancePanel } from '../../_reference/MaintenancePanel'
import { maintenancePanelData } from '../../_reference/maintenance-view'
import { RecordForm } from '@/components/forms/RecordForm'
import { AssetActions } from '../../_reference/AssetActions'
import { updateTruckAction } from '../actions'
import { truckFields } from '../fields'
import {
  restoreAssetAction,
  retireAssetAction,
  transferAssetAction,
} from '../../_reference/asset-actions'

export default async function EditTruckPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { t, locale } = await getLocaleContext()

  // Decided before the transaction opens and threaded into the service, so the
  // cost is never selected for a role that cannot see it — §2.5 and the
  // standing rule that a field the role cannot see is left OUT of the payload.
  const maySeeCost = await currentUserCan('read', 'truck.financials')

  const data = await withCurrentOrg('read', 'truck', async (tx, session) => {
    // Row-level security has already removed another tenant's trucks, so a
    // miss here is a genuine 404 rather than a permission answer in disguise.
    const truck = await tx.truck.findUnique({ where: { id } })
    if (!truck) return null

    const companies = await tx.company.findMany({
      // `id`, not `companyId` — Company IS the authority. See tenancy.ts.
      where: {
        isActive: true,
        ...companyIdScopeFilter(session.companyScopes),
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    })

    const open = await currentAuthority(tx, 'truck', id)
    const openCompany = open
      ? (companies.find((c) => c.id === open.companyId)?.name ?? null)
      : null

    const compliance = await compliancePanelData(tx, 'truck', id, t)
    const maintenance = await maintenancePanelData(
      tx,
      'truck',
      id,
      maySeeCost,
      t,
      locale,
    )

    return { truck, companies, openCompany, compliance, maintenance }
  })

  if (!data) notFound()
  const { truck, companies, openCompany, compliance, maintenance } = data
  const maySeeCompliance = await currentUserCan('read', 'compliance')
  const mayRenew = await currentUserCan('create', 'compliance')

  const maySeeMaintenance = await currentUserCan('read', 'maintenance')
  const mayRecordMaintenance = await currentUserCan('create', 'maintenance')
  const mayAttach = await currentUserCan('create', 'document')

  const mayEdit = await currentUserCan('update', 'truck')
  const mayDelete = await currentUserCan('delete', 'truck')

  const authorities = companies.map((c) => ({ value: c.id, label: c.name }))

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="text-lg font-medium text-ink">
          {t('trucks.edit')}{' '}
          <span className="font-mono text-ink-2">{truck.unitNumber}</span>
        </h1>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2 px-gutter py-z5">
        <RecordForm
          fields={truckFields(t, authorities, 'edit')}
          values={{
            unitNumber: truck.unitNumber,
            make: truck.make ?? '',
            model: truck.model ?? '',
            year: truck.year === null ? '' : String(truck.year),
            vin: truck.vin ?? '',
            plate: truck.plate ?? '',
            plateState: truck.plateState ?? '',
            currentOdometer:
              truck.currentOdometer === null
                ? ''
                : String(truck.currentOdometer),
            status: truck.status,
            ownershipType: truck.ownershipType,
            notes: truck.notes ?? '',
          }}
          action={updateTruckAction.bind(null, id)}
          cancelHref="/trucks"
          labels={{ save: t('ref.save'), cancel: t('ref.cancel') }}
        >
          {mayEdit ? (
            <AssetActions
              kind="truck"
              id={id}
              isRetired={truck.deletedAt !== null}
              // Its current authority is not a place to transfer it to. The
              // service refuses a same-authority move anyway; leaving it out
              // of the list means nobody has to be refused to find out.
              authorities={authorities.filter(
                (a) => a.value !== truck.companyId,
              )}
              currentAuthorityName={
                openCompany ??
                companies.find((c) => c.id === truck.companyId)?.name ??
                null
              }
              transferAction={transferAssetAction.bind(null, 'truck', id)}
              retireAction={
                mayDelete
                  ? retireAssetAction.bind(null, 'truck', id)
                  : async () => {
                      'use server'
                    }
              }
              restoreAction={restoreAssetAction.bind(null, 'truck', id)}
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

        {/* PHASE 4 §5 STEP 2. Compliance dates are OPERATIONAL — a dispatcher
         * reads them because they gate a dispatch decision (§2.5), and
         * ACCOUNTING reads them for insurance certificates at billing time.
         * Renewing is `compliance:create`, which stays with FLEET_WRITE. */}
        {maySeeCompliance ? (
          <div className="mt-z4 max-w-[900px]">
            <CompliancePanel
              subject="truck"
              subjectId={id}
              rows={compliance.rows}
              types={compliance.types}
              documentTypeFor={compliance.documentTypeFor}
              mayRenew={mayRenew}
              today={compliance.today}
              translate={compliance.translate}
              labels={
                compliance.labels as Parameters<
                  typeof CompliancePanel
                >[0]['labels']
              }
            />
          </div>
        ) : null}

        {/* PHASE 4 §5 STEP 3. A dispatcher reads the service history — a truck
         * in the shop is a dispatch fact — and never the cost, which is
         * `truck.financials` and simply is not in the payload for them. */}
        {maySeeMaintenance ? (
          <div className="mt-z4 max-w-[900px]">
            <MaintenancePanel
              subject="truck"
              subjectId={id}
              rows={maintenance.rows}
              categories={maintenance.categories}
              {...(maintenance.totals ? { totals: maintenance.totals } : {})}
              mayRecord={mayRecordMaintenance}
              mayAttach={mayAttach}
              today={maintenance.today}
              translate={maintenance.translate}
              labels={
                maintenance.labels as Parameters<
                  typeof MaintenancePanel
                >[0]['labels']
              }
            />
          </div>
        ) : null}
      </div>
    </>
  )
}
