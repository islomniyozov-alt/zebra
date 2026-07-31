import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyScopeFilter } from '@/lib/tenancy'
import { RecordForm } from '@/components/forms/RecordForm'
import { createDriverAction } from '../actions'
import { driverFields } from '../fields'
import { lastUsedAuthority } from '../../_reference/shared'

export default async function NewDriverPage() {
  if (!(await currentUserCan('create', 'driver'))) notFound()

  const { t } = await getLocaleContext()

  const companies = await withCurrentOrg('read', 'company', (tx, session) =>
    tx.company.findMany({
      where: { isActive: true, ...companyScopeFilter(session.companyScopes) },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  )

  const authorities = companies.map((c) => ({ value: c.id, label: c.name }))
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
          fields={driverFields(t, authorities, 'create')}
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
