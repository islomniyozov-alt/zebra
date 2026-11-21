import { notFound } from 'next/navigation'
import { currentUserCan, withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { fmcsaLabels } from '@/components/forms/fmcsa-labels'
import { companyUsage, retiredRemovalRefusal } from '@/lib/companies'
import { COMPANY_FORM_SELECT, companyFormValues } from '@/lib/company-form'
import { AddCompanyForm } from '../AddCompanyForm'
import { CompanyLifecycle } from './CompanyLifecycle'
import {
  deactivateCompanyAction,
  deleteCompanyAction,
  reactivateCompanyAction,
  updateCompanyAction,
} from '../actions'

// Admin → Authorities → one authority (owner report: rows are not clickable).
//
// FLAG 11 BUILT CREATE AND SAID SO. What it skipped is everything after the
// first save: a mistyped MC number was uncorrectable and an authority added by
// mistake was permanent, both reachable only with SQL — the state this whole
// screen exists to end.
//
// GATED ON `company:update`, which OWNER and ADMIN hold and nothing else does.
// A MANAGER holds `company:read` for the authority switcher and gets a 404
// here, which is the same shape the Add screen already had.

export default async function EditCompanyPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!(await currentUserCan('update', 'company'))) notFound()

  const { t } = await getLocaleContext()

  const data = await withCurrentOrg('read', 'company', async (tx) => {
    const company = await tx.company.findFirst({
      where: { id },
      select: {
        id: true,
        ...COMPANY_FORM_SELECT,
        isActive: true,
        retired: true,
      },
    })
    if (!company) return null
    return { company, usage: await companyUsage(tx, id) }
  })

  // RLS ALREADY MAKES THIS THE ONLY POSSIBLE ANSWER for another tenant's id,
  // and 404 is the same thing a wrong id gets. One shape for "not yours" and
  // "not there" is deliberate: the difference is information.
  if (!data) notFound()
  const { company, usage } = data

  const mayRemove = await currentUserCan('delete', 'company')
  // A retired authority: the OWNER's alone, and a placeholder only (TMS §6.3
  // v11.40). The same predicate `deleteCompany` refuses with.
  const removable =
    usage.total === 0 &&
    retiredRemovalRefusal(
      company,
      await currentUserCan('delete', 'company.retired'),
    ) === null

  return (
    <div className="flex flex-col gap-z4">
      <div className="flex items-baseline gap-z3">
        <h1 className="text-xl font-semibold text-ink">{company.name}</h1>
        {!company.isActive ? (
          <span className="text-sm text-ink-2">{t('companies.inactive')}</span>
        ) : null}
      </div>

      <AddCompanyForm
        action={updateCompanyAction.bind(null, company.id)}
        initial={companyFormValues(company)}
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
          save: t('ref.save'),
          cancel: t('companies.cancel'),
          hint: t('companies.editHint'),
        }}
        fmcsa={fmcsaLabels(t)}
      >
        {mayRemove ? (
          <CompanyLifecycle
            isActive={company.isActive}
            usageSentence={t('companies.usageSummary')
              .replace('{loads}', String(usage.loads))
              .replace('{invoices}', String(usage.invoices))
              .replace('{settlements}', String(usage.settlements))
              .replace('{other}', String(usage.other))}
            deactivate={deactivateCompanyAction.bind(null, company.id)}
            reactivate={reactivateCompanyAction.bind(null, company.id)}
            // NOT SENT AT ALL when freight is filed under the authority — the
            // action and its four sentences both. Passing them and hiding the
            // button still ships "Remove permanently" in the payload of a page
            // where removing is impossible, which the walkthrough caught.
            {...(removable
              ? {
                  remove: {
                    action: deleteCompanyAction.bind(null, company.id),
                    labels: {
                      remove: t('companies.remove'),
                      confirm: t('companies.removeConfirm'),
                      body: t('companies.removeBody'),
                      cancel: t('companies.cancel'),
                    },
                  },
                }
              : {})}
            labels={{
              deactivate: t('companies.deactivate'),
              deactivateHint: t('companies.deactivateHint'),
              reactivate: t('companies.reactivate'),
              reactivateHint: t('companies.reactivateHint'),
            }}
          />
        ) : null}
      </AddCompanyForm>
    </div>
  )
}
