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
