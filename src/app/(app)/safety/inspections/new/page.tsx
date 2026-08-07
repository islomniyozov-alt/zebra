import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { companyScopeFilter } from '@/lib/tenancy'
import { INSPECTION_LEVELS } from '@/lib/inspections'
import { InspectionForm } from '../../../_reference/InspectionForm'
import type { MessageKey } from '@/lib/i18n'

// The three subject lists are read HERE, through the scoped transaction, so a
// dispatcher-scoped user is only ever offered units from their own authorities
// — and the service refuses a mixed-authority combination besides. Two
// mechanisms, because the select is a convenience and the refusal is the rule.

export default async function NewInspectionPage() {
  if (!(await currentUserCan('create', 'inspection'))) notFound()

  const { t } = await getLocaleContext()

  const { trucks, trailers, drivers } = await withCurrentOrg(
    'read',
    'inspection',
    async (tx, session) => {
      const scope = companyScopeFilter(session.companyScopes)

      const [trucks, trailers, drivers] = await Promise.all([
        tx.truck.findMany({
          where: { ...scope, deletedAt: null },
          orderBy: { unitNumber: 'asc' },
          select: { id: true, unitNumber: true },
        }),
        tx.trailer.findMany({
          where: { ...scope, deletedAt: null },
          orderBy: { unitNumber: 'asc' },
          select: { id: true, unitNumber: true },
        }),
        tx.driver.findMany({
          where: { ...scope, deletedAt: null },
          orderBy: { lastName: 'asc' },
          select: { id: true, firstName: true, lastName: true },
        }),
      ])

      return { trucks, trailers, drivers }
    },
  )

  // A blank first option on each, because none of the three is required and a
  // select that opens on the first truck would file every Level III against it.
  const blank = { value: '', label: t('ins.new.none') }

  return (
    <>
      <div className="flex items-baseline justify-between gap-z4 border-b border-border bg-surface px-gutter py-z3">
        <h1 className="text-lg font-medium text-ink">{t('ins.new.title')}</h1>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2 px-gutter py-z5">
        <InspectionForm
          levels={INSPECTION_LEVELS.map((level) => ({
            value: level,
            label: t(`insLevel.${level}` as MessageKey),
          }))}
          trucks={[
            blank,
            ...trucks.map((truck) => ({
              value: truck.id,
              label: truck.unitNumber,
            })),
          ]}
          trailers={[
            blank,
            ...trailers.map((trailer) => ({
              value: trailer.id,
              label: trailer.unitNumber,
            })),
          ]}
          drivers={[
            blank,
            ...drivers.map((driver) => ({
              value: driver.id,
              label: `${driver.firstName} ${driver.lastName}`.trim(),
            })),
          ]}
          today={new Date().toISOString().slice(0, 10)}
          translate={{
            'ins.error.noSubject': t('ins.error.noSubject'),
            'ins.error.subjectNotFound': t('ins.error.subjectNotFound'),
            'ins.error.mixedAuthority': t('ins.error.mixedAuthority'),
            'ins.error.noDate': t('ins.error.noDate'),
            'ins.error.badState': t('ins.error.badState'),
          }}
          labels={{
            hint: t('ins.new.hint'),
            date: t('ins.new.date'),
            dateHint: t('ins.new.dateHint'),
            level: t('ins.level'),
            state: t('ins.new.state'),
            stateHint: t('ins.new.stateHint'),
            report: t('ins.new.report'),
            location: t('ins.new.location'),
            inspector: t('ins.new.inspector'),
            truck: t('ins.new.truck'),
            trailer: t('ins.new.trailer'),
            driver: t('ins.new.driver'),
            subjectHint: t('ins.new.subjectHint'),
            notes: t('ins.new.notes'),
            save: t('ins.new.save'),
            cancel: t('ref.cancel'),
          }}
        />
      </div>
    </>
  )
}
