export interface AddCompanyState {
  /** Pre-translated sentence, or null. */
  error: string | null
  field: string | null
  companyId: string | null
}

export const ADD_COMPANY_INITIAL: AddCompanyState = {
  error: null,
  field: null,
  companyId: null,
}

// --- the FMCSA lookup ------------------------------------------------------
//
// A PLAIN MODULE, because `actions.ts` is `"use server"` and may only export
// async functions — a constant exported from there compiles, typechecks and
// then fails at runtime as a 500 with nothing in the browser to explain it.
// The repository has a lint rule for exactly that.

/**
 * What the register answered, as the form needs it.
 *
 * PRE-TRANSLATED SENTENCES, not codes: the concerns are rendered on the server
 * with the rest of the message catalogue, so the client holds words rather
 * than a switch statement and a locale. Same shape as the load warnings.
 */
export interface CarrierLookupView {
  /** The values that go into the form's fields. */
  prefill: {
    name: string
    legalName: string
    dotNumber: string
    addressLine1: string
    city: string
    state: string
    postalCode: string
    phone: string
  }
  /** Shown, not stored — `Company` has no column for any of these. */
  entityType: string | null
  dbaName: string | null
  operation: string | null
  safetyRating: string | null
  /** `Active` / `Inactive`, already in the reader's language. */
  status: string | null
  /** One sentence per thing wrong with this authority. Possibly empty. */
  concerns: string[]
}

export interface LookupState {
  /** Pre-translated. Present means the form was left exactly as it was. */
  error: string | null
  found: CarrierLookupView | null
}

export const LOOKUP_INITIAL: LookupState = { error: null, found: null }

/** The form fields the lookup can fill. Also the keys marked "From FMCSA". */
export const LOOKUP_FIELDS = [
  'name',
  'legalName',
  'dotNumber',
  'addressLine1',
  'city',
  'state',
  'postalCode',
  'phone',
] as const
