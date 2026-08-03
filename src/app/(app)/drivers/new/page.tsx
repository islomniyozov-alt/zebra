import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyIdScopeFilter, companyScopeFilter } from '@/lib/tenancy'
import { RecordForm } from '@/components/forms/RecordForm'
import { createDriverAction } from '../actions'
import { driverFields } from '../fields'
import { lastUsedAuthority } from '../../_reference/shared'

export default async function NewDriverPage() {
  if (!(await currentUserCan('create', 'driver'))) notFound()

  const { t } = await getLocaleContext()

  // Both in one transaction: two `withCurrentOrg` calls would be two round
  // trips to us-east-2 for one form.
  const { companies, trucks } = await withCurrentOrg(
    'read',
    'company',
    async (tx, session) => {
      const scope = companyScopeFilter(session.companyScopes)
      const companyIdScope = companyIdScopeFilter(session.companyScopes)
      return {
        companies: await tx.company.findMany({
          // `id`, not `companyId` — Company IS the authority. See tenancy.ts.
          where: { isActive: true, ...companyIdScope },
          orderBy: { name: 'asc' },
          select: { id: true, name: true },
        }),
        trucks: await tx.truck.findMany({
          where: { ...scope, deletedAt: null, status: { not: 'SOLD' } },
          orderBy: [{ company: { name: 'asc' } }, { unitNumber: 'asc' }],
          select: {
            id: true,
            unitNumber: true,
            company: { select: { name: true } },
          },
        }),
      }
    },
  )

  const authorities = companies.map((c) => ({ value: c.id, label: c.name }))
  // The authority is IN the label, so a dispatcher can see the mismatch before
  // the form refuses it.
  const truckOptions = trucks.map((truck) => ({
    value: truck.id,
    label: `${truck.unitNumber} · ${truck.company.name}`,
  }))
  const remembered = await lastUsedAuthority()
  const defaultAuthority =
    remembered && authorities.some((a) => a.value === remembered)
      ? remembered
      : (authorities[0]?.value ?? '')

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="text-lg font-medium text-ink">{t('drivers.new')}</h1>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2 px-gutter py-z5">
        <RecordForm
          fields={driverFields(t, authorities, 'create', truckOptions)}
          values={{
            companyId: defaultAuthority,
            status: 'AVAILABLE',
            employmentType: 'OWNED',
          }}
          action={createDriverAction}
          cancelHref="/drivers"
          labels={{ save: t('ref.save'), cancel: t('ref.cancel') }}
        />
      </div>
    </>
  )
}
