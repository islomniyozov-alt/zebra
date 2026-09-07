import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyIdScopeFilter, companyScopeFilter } from '@/lib/tenancy'
import { driverFields } from '../fields'
import { NewDriverFlow } from './NewDriverFlow'
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
        <NewDriverFlow
          authorities={authorities}
          defaultAuthority={defaultAuthority}
          fields={driverFields(t, authorities, 'create', truckOptions)}
          labels={{
            authority: t('ref.authority'),
            dropTitle: t('drivers.cdl.dropTitle'),
            dropBody: t('drivers.cdl.dropBody'),
            dropHint: t('drivers.cdl.dropHint'),
            browse: t('drivers.cdl.dropTitle'),
            manual: t('drivers.cdl.manual'),
            reading: t('drivers.cdl.reading'),
            save: t('ref.save'),
            cancel: t('ref.cancel'),
            cardSays: t('drivers.cdl.cardSays'),
            classPrinted: t('drivers.cdl.classPrinted'),
            endorsements: t('drivers.cdl.endorsements'),
            restrictions: t('drivers.cdl.restrictions'),
            none: t('drivers.cdl.none'),
            codeUnread: t('drivers.cdl.codeUnread'),
            codeUnknown: t('drivers.cdl.codeUnknown'),
            temporary: t('drivers.cdl.temporary'),
            temporaryBody: t('drivers.cdl.temporaryBody'),
            // PRE-TRANSLATED, KEYED BY THE KEY the action returns. A translator
            // closure cannot cross to a client component, and the action deals
            // in i18n keys rather than sentences so it stays language-free.
            notices: {
              'drivers.cdl.notReadingYet': t('drivers.cdl.notReadingYet'),
              'drivers.cdl.unreadable': t('drivers.cdl.unreadable'),
              'drivers.cdl.wrongType': t('drivers.cdl.wrongType'),
              'drivers.cdl.tooLarge': t('drivers.cdl.tooLarge'),
              'drivers.cdl.noFile': t('drivers.cdl.noFile'),
              'drivers.cdl.failed': t('drivers.cdl.failed'),
              'drivers.cdl.contradictory': t('drivers.cdl.contradictory'),
              'drivers.cdl.notAllowed': t('drivers.cdl.notAllowed'),
            },
          }}
        />
      </div>
    </>
  )
}
