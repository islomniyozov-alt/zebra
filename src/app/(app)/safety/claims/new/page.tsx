import { notFound } from 'next/navigation'
import { SELECTABLE_AUTHORITY } from '@/lib/companies'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyIdScopeFilter, companyScopeFilter } from '@/lib/tenancy'
import { CLAIM_TYPES } from '@/lib/claims'
import { ClaimForm } from '../../../_reference/ClaimForm'
import type { MessageKey } from '@/lib/i18n'

export default async function NewClaimPage() {
  if (!(await currentUserCan('create', 'claim'))) notFound()

  const { t } = await getLocaleContext()

  const { companies, loads, trucks, drivers } = await withCurrentOrg(
    'read',
    'claim',
    async (tx, session) => {
      const [companies, loads, trucks, drivers] = await Promise.all([
        tx.company.findMany({
          // `id`, not `companyId` — Company IS the authority. See tenancy.ts.
          where: {
            ...SELECTABLE_AUTHORITY,
            ...companyIdScopeFilter(session.companyScopes),
          },
          orderBy: { name: 'asc' },
          select: { id: true, name: true },
        }),
        // The recent ones only. A claim is filed about a load somebody
        // remembers, and a select holding two years of freight is a select
        // nobody scrolls.
        tx.load.findMany({
          where: { ...companyScopeFilter(session.companyScopes) },
          orderBy: { createdAt: 'desc' },
          take: 200,
          select: { id: true, loadNumber: true, companyId: true },
        }),
        tx.truck.findMany({
          where: {
            ...companyScopeFilter(session.companyScopes),
            deletedAt: null,
          },
          orderBy: { unitNumber: 'asc' },
          select: { id: true, unitNumber: true },
        }),
        tx.driver.findMany({
          where: {
            ...companyScopeFilter(session.companyScopes),
            deletedAt: null,
          },
          orderBy: { lastName: 'asc' },
          select: { id: true, firstName: true, lastName: true },
        }),
      ])

      return { companies, loads, trucks, drivers }
    },
  )

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="text-lg font-medium text-ink">
          {t('claims.new.title')}
        </h1>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2 px-gutter py-z5">
        <ClaimForm
          authorities={companies.map((company) => ({
            value: company.id,
            label: company.name,
          }))}
          types={CLAIM_TYPES.map((type) => ({
            value: type,
            label: t(`claimType.${type}` as MessageKey),
          }))}
          loads={[
            // Blank first: the load is optional, and a select that opens on
            // somebody's freight would attach the wrong load to an accident.
            { value: '', label: t('claims.new.none') },
            ...loads.map((load) => ({
              value: load.id,
              label: load.loadNumber,
            })),
          ]}
          trucks={[
            { value: '', label: t('claims.new.none') },
            ...trucks.map((truck) => ({
              value: truck.id,
              label: truck.unitNumber,
            })),
          ]}
          drivers={[
            { value: '', label: t('claims.new.none') },
            ...drivers.map((driver) => ({
              value: driver.id,
              label: `${driver.firstName} ${driver.lastName}`.trim(),
            })),
          ]}
          today={new Date().toISOString().slice(0, 10)}
          translate={{
            'claims.error.noAuthority': t('claims.error.noAuthority'),
            'claims.error.loadNotFound': t('claims.error.loadNotFound'),
            'claims.error.assetNotFound': t('claims.error.assetNotFound'),
            'claims.error.badAmount': t('claims.error.badAmount'),
            'claims.error.noDescription': t('claims.error.noDescription'),
          }}
          labels={{
            hint: t('claims.new.hint'),
            authority: t('claims.new.authority'),
            type: t('claims.new.type'),
            incident: t('claims.new.incident'),
            incidentHint: t('claims.new.incidentHint'),
            load: t('claims.new.load'),
            loadHint: t('claims.new.loadHint'),
            truck: t('claims.new.truck'),
            driver: t('claims.new.driver'),
            assetHint: t('claims.new.assetHint'),
            claimant: t('claims.new.claimant'),
            number: t('claims.new.number'),
            amount: t('claims.new.amount'),
            description: t('claims.new.description'),
            save: t('claims.new.save'),
            cancel: t('ref.cancel'),
          }}
        />
      </div>
    </>
  )
}
