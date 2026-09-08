// The action's state shape, in a plain module beside it.
//
// A `'use server'` FILE MAY ONLY EXPORT ASYNC FUNCTIONS. Exporting this
// constant from `med-actions.ts` compiles and typechecks and then fails at
// runtime as a 500 with nothing in the browser — which is why the repo has a
// lint rule that refuses it by name. It caught this one.
export interface FileMedicalCertState {
  error: string | null
  filedRecordId: string | null
}

export const FILE_MEDICAL_CERT_INITIAL: FileMedicalCertState = {
  error: null,
  filedRecordId: null,
}
