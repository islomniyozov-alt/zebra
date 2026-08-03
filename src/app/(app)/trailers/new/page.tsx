import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyIdScopeFilter } from '@/lib/tenancy'
import { RecordForm } from '@/components/forms/RecordForm'
import { createTrailerAction } from '../actions'
import { trailerFields } from '../fields'
import { lastUsedAuthority } from '../../_reference/shared'

export default async function NewTrailerPage() {
  if (!(await currentUserCan('create', 'trailer'))) notFound()

  const { t } = await getLocaleContext()

  const companies = await withCurrentOrg('read', 'company', (tx, session) =>
    tx.company.findMany({
      // `id`, not `companyId` — Company IS the authority. See tenancy.ts.
      where: {
        isActive: true,
        ...companyIdScopeFilter(session.companyScopes),
      },
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
        <h1 className="text-lg font-medium text-ink">{t('trailers.new')}</h1>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2 px-gutter py-z5">
        <RecordForm
          fields={trailerFields(t, authorities, 'create')}
          values={{
            companyId: defaultAuthority,
            status: 'AVAILABLE',
            ownershipType: 'OWNED',
          }}
          action={createTrailerAction}
          cancelHref="/trailers"
          labels={{ save: t('ref.save'), cancel: t('ref.cancel') }}
        />
      </div>
    </>
  )
}
