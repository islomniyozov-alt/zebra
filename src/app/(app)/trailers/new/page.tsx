import { notFound } from 'next/navigation'
import { SELECTABLE_AUTHORITY } from '@/lib/companies'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyIdScopeFilter } from '@/lib/tenancy'
import { NewAssetForm } from '@/components/forms/NewAssetForm'
import { createTrailerAction } from '../actions'
import { lastUsedAuthority } from '../../_reference/shared'
import { newAssetLabels } from '../../_reference/new-asset-labels'

export default async function NewTrailerPage() {
  if (!(await currentUserCan('create', 'trailer'))) notFound()

  const { t } = await getLocaleContext()

  const companies = await withCurrentOrg('read', 'company', (tx, session) =>
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
        {/* The truck's short form, the same shape (§6.5 part 3, v11.54). */}
        <NewAssetForm
          kind="trailer"
          authorities={authorities}
          defaultAuthority={defaultAuthority}
          action={createTrailerAction}
          cancelHref="/trailers"
          labels={newAssetLabels(t)}
        />
      </div>
    </>
  )
}
