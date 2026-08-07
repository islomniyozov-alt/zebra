import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyIdScopeFilter } from '@/lib/tenancy'
import { currentAuthority } from '@/lib/fleet'
import { CompliancePanel } from '../../_reference/CompliancePanel'
import { compliancePanelData } from '../../_reference/compliance-view'
import { InspectionPanel } from '../../_reference/InspectionPanel'
import { inspectionPanelData } from '../../_reference/inspection-view'
import { MaintenancePanel } from '../../_reference/MaintenancePanel'
import { maintenancePanelData } from '../../_reference/maintenance-view'
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
  const { t, locale } = await getLocaleContext()

  // Decided before the transaction opens and threaded into the service, so the
  // cost is never selected for a role that cannot see it — §2.5.
  const maySeeCost = await currentUserCan('read', 'truck.financials')

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

    const compliance = await compliancePanelData(tx, 'trailer', id, t)
    const inspections = await inspectionPanelData(tx, 'trailer', id, t)
    const maintenance = await maintenancePanelData(
      tx,
      'trailer',
      id,
      maySeeCost,
      t,
      locale,
    )

    return {
      trailer,
      companies,
      openCompany,
      compliance,
      maintenance,
      inspections,
    }
  })

  if (!data) notFound()
  const {
    trailer,
    companies,
    openCompany,
    compliance,
    maintenance,
    inspections,
  } = data
  const maySeeCompliance = await currentUserCan('read', 'compliance')
  const maySeeInspections = await currentUserCan('read', 'inspection')
  const mayRenew = await currentUserCan('create', 'compliance')

  const maySeeMaintenance = await currentUserCan('read', 'maintenance')
  const mayRecordMaintenance = await currentUserCan('create', 'maintenance')
  const mayAttach = await currentUserCan('create', 'document')

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

        {/* PHASE 4 §5 STEP 2. Compliance dates are OPERATIONAL — a dispatcher
         * reads them because they gate a dispatch decision (§2.5), and
         * ACCOUNTING reads them for insurance certificates at billing time.
         * Renewing is `compliance:create`, which stays with FLEET_WRITE. */}
        {maySeeCompliance ? (
          <div className="mt-z4 max-w-[900px]">
            <CompliancePanel
              subject="trailer"
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

        {/* PHASE 4 §5 STEP 3. Trailers get serviced too — reefer units and
         * brake jobs are where a dry van's year actually goes. */}
        {maySeeMaintenance ? (
          <div className="mt-z4 max-w-[900px]">
            <MaintenancePanel
              subject="trailer"
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

        {/* PHASE 4 §5 STEP 4. Read-only: an inspection is recorded from
         * /safety/inspections/new, where the truck, the trailer and the driver
         * can all be named at once. A panel that could file one from here
         * would have to guess the other two. */}
        {maySeeInspections ? (
          <div className="mt-z4 max-w-[900px]">
            <InspectionPanel
              rows={inspections.rows}
              labels={
                inspections.labels as Parameters<
                  typeof InspectionPanel
                >[0]['labels']
              }
            />
          </div>
        ) : null}
      </div>
    </>
  )
}
