import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyScopeFilter } from '@/lib/tenancy'
import { RecordForm } from '@/components/forms/RecordForm'
import { createTruckAction } from '../actions'
import { truckFields } from '../fields'
import { lastUsedAuthority } from '../../_reference/shared'

// A dispatcher holds `truck:read` and not `truck:create`, so this route is
// simply not there for them — 404, not a disabled button. §4's rule about
// absent routes cuts both ways: a route you may not use should not exist for
// you either.

export default async function NewTruckPage() {
  if (!(await currentUserCan('create', 'truck'))) notFound()

  const { t } = await getLocaleContext()

  const companies = await withCurrentOrg('read', 'company', (tx, session) =>
    tx.company.findMany({
      where: { isActive: true, ...companyScopeFilter(session.companyScopes) },
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
        <RecordForm
          fields={truckFields(t, authorities, 'create')}
          values={{
            companyId: defaultAuthority,
            status: 'AVAILABLE',
            ownershipType: 'OWNED',
          }}
          action={createTruckAction}
          cancelHref="/trucks"
          labels={{ save: t('ref.save'), cancel: t('ref.cancel') }}
        />
      </div>
    </>
  )
}
