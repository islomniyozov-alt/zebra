// A `'use server'` file may export async functions and NOTHING else, so the
// cutover form's state lives here.
export interface CutoverFormState {
  error: string | null
  saved: boolean
}

export const CUTOVER_INITIAL: CutoverFormState = { error: null, saved: false }
