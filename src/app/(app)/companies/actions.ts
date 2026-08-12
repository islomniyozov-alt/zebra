'use server'

import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { addCompany } from '@/lib/companies'
import { ADD_COMPANY_INITIAL, type AddCompanyState } from './company-state'

// The one write this screen has. It goes through `withCurrentOrg('create',
// 'company')`, so the permission is decided in permissions.ts and the row is
// attributed to whoever pressed the button — an authority appearing out of
// nowhere is the last thing an audit trail should be quiet about.

export async function addCompanyAction(
  _previous: AddCompanyState,
  formData: FormData,
): Promise<AddCompanyState> {
  const { t } = await getLocaleContext()
  const text = (name: string) => String(formData.get(name) ?? '')

  const outcome = await withCurrentOrg('create', 'company', (tx, session) =>
    addCompany(tx, session.organizationId, {
      name: text('name'),
      legalName: text('legalName'),
      mcNumber: text('mcNumber'),
      dotNumber: text('dotNumber'),
      addressLine1: text('addressLine1'),
      addressLine2: text('addressLine2'),
      city: text('city'),
      state: text('state'),
      postalCode: text('postalCode'),
      phone: text('phone'),
      email: text('email'),
    }),
  )

  if (!outcome.ok) {
    // THE LIMIT REFUSAL SAYS THE NUMBER. "You have reached your limit" is a
    // dead end; "your plan covers 2 authorities and you have 2" is something
    // the owner can act on, and it names the lever rather than hiding it.
    const error =
      outcome.reason === 'limit_reached'
        ? t('companies.error.limitReached').replace(
            '{limit}',
            String(outcome.limit ?? 1),
          )
        : outcome.reason === 'duplicate_name'
          ? t('companies.error.duplicateName')
          : outcome.reason === 'bad_state'
            ? t('companies.error.badState')
            : t('ref.error.required')

    return {
      ...ADD_COMPANY_INITIAL,
      error,
      field:
        outcome.reason === 'bad_state'
          ? 'state'
          : outcome.reason === 'limit_reached'
            ? null
            : 'name',
    }
  }

  // Every screen that lists authorities is now wrong until it re-reads.
  revalidatePath('/companies')
  revalidatePath('/loads/new')
  revalidatePath('/settings')

  return { error: null, field: null, companyId: outcome.id }
}
