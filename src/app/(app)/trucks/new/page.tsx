import { notFound } from 'next/navigation'
import { SELECTABLE_AUTHORITY } from '@/lib/companies'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyIdScopeFilter } from '@/lib/tenancy'
import { NewAssetForm } from '@/components/forms/NewAssetForm'
import { createTruckAction } from '../actions'
import { lastUsedAuthority } from '../../_reference/shared'
import { newAssetLabels } from '../../_reference/new-asset-labels'

// A dispatcher holds `truck:read` and not `truck:create`, so this route is
// simply not there for them — 404, not a disabled button. §4's rule about
// absent routes cuts both ways: a route you may not use should not exist for
// you either.

export default async function NewTruckPage() {
  if (!(await currentUserCan('create', 'truck'))) notFound()

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

  const authorities = companies.map((company) => ({
    value: company.id,
    label: company.name,
  }))

  // §6.3 — defaulting to last-used, and only if it is still one this user may
  // write to. A remembered id that has since left their scope defaults to
  // nothing rather than to somebody else's authority.
  const remembered = await lastUsedAuthority()
  const defaultAuthority =
    remembered && authorities.some((option) => option.value === remembered)
      ? remembered
      : (authorities[0]?.value ?? '')

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="text-lg font-medium text-ink">{t('trucks.new')}</h1>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2 px-gutter py-z5">
        {/* THE SHORT FORM (§6.5 part 3, v11.54): what identifies the unit.
         * Status and ownership take their defaults; odometer and the item-12
         * facts are on the record's Details tab, which Save opens. */}
        <NewAssetForm
          kind="truck"
          authorities={authorities}
          defaultAuthority={defaultAuthority}
          action={createTruckAction}
          cancelHref="/trucks"
          labels={newAssetLabels(t)}
        />
      </div>
    </>
  )
}
