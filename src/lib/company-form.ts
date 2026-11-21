import type { AddCompanyInput } from './companies'

// ---------------------------------------------------------------------------
// THE AUTHORITY FORM'S FIELDS, ONE LIST (TMS §6.3 v11.41; owner's report
// 2026-11-21).
//
// The form renders these, both actions read them through `readCompanyForm`,
// and the edit page loads them back through `companyFormValues`. A field
// added to one of the three and not the others is the truck record's bug of
// 2026-11-19 — written by Save and never loaded back — and
// tests/company-form.test.ts fails by name if the three stop agreeing.
// ---------------------------------------------------------------------------

export const COMPANY_FORM_FIELDS = [
  'name',
  'legalName',
  'mcNumber',
  'dotNumber',
  'addressLine1',
  'addressLine2',
  'city',
  'state',
  'postalCode',
  'phone',
  'email',
] as const

export type CompanyFormField = (typeof COMPANY_FORM_FIELDS)[number]

/** What the create and edit actions pass to `addCompany` / `updateCompany`. */
export function readCompanyForm(formData: FormData): AddCompanyInput {
  const text = (name: CompanyFormField) => String(formData.get(name) ?? '')
  const input = {} as Record<CompanyFormField, string>
  for (const name of COMPANY_FORM_FIELDS) input[name] = text(name)
  return input
}

export type StoredCompanyFields = Record<CompanyFormField, string | null>

/** The edit form's starting values, from the stored authority. */
export function companyFormValues(
  company: StoredCompanyFields,
): Record<CompanyFormField, string> {
  const values = {} as Record<CompanyFormField, string>
  for (const name of COMPANY_FORM_FIELDS) values[name] = company[name] ?? ''
  return values
}

/** The `select` that reads every field the form shows. */
export const COMPANY_FORM_SELECT = Object.fromEntries(
  COMPANY_FORM_FIELDS.map((name) => [name, true]),
) as Record<CompanyFormField, true>

/**
 * Where a successful edit lands: the authorities list, carrying which
 * authority was saved so the list can say so.
 */
export function savedHref(id: string): string {
  return `/companies?saved=${encodeURIComponent(id)}`
}
