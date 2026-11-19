import { notFound } from 'next/navigation'
import { currentUserCan } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { fmcsaLabels } from '@/components/forms/fmcsa-labels'
import { AddCompanyForm } from '../AddCompanyForm'
import { addCompanyAction } from '../actions'
import { safeReturnPath } from '@/lib/return-path'

// Admin → Authorities → Add. `company:create` is OWNER and ADMIN only, and a
// MANAGER who types the URL gets a 404 rather than a form that refuses on
// submit — the difference between hiding a button and closing a door.

export default async function NewCompanyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { t } = await getLocaleContext()
  if (!(await currentUserCan('create', 'company'))) notFound()
  // "+ Add authority" from a Transfer dialog (v11.35): the record to return
  // to, checked — anything but a driver, truck or trailer record is ignored.
  const returnTo = safeReturnPath((await searchParams)['return'])

  return (
    <div className="flex flex-col gap-z4">
      <h1 className="text-xl font-semibold text-ink">{t('companies.add')}</h1>
      <AddCompanyForm
        action={addCompanyAction}
        returnTo={returnTo}
        labels={{
          name: t('companies.name'),
          legalName: t('companies.legalName'),
          mcNumber: t('companies.mcNumber'),
          dotNumber: t('companies.dotNumber'),
          addressLine1: t('companies.addressLine1'),
          addressLine2: t('companies.addressLine2'),
          city: t('companies.city'),
          state: t('companies.state'),
          postalCode: t('companies.postalCode'),
          phone: t('companies.phone'),
          email: t('companies.email'),
          save: t('companies.save'),
          cancel: t('companies.cancel'),
          hint: t('companies.hint'),
        }}
        fmcsa={fmcsaLabels(t)}
      />
    </div>
  )
}
