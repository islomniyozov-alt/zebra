/**
 * The certificate-filing action's state.
 *
 * Its own file because a `'use server'` module may only export async
 * functions — the repo lint rule that caught `med-state.ts` being folded into
 * its action.
 *
 * `filedRecordIds` is a LIST because one certificate becomes one row per
 * coverage per subject — which since the per-truck branch arrived can be four
 * rows from one document — and because a partial success has to be reportable:
 * if the first coverage filed and the second collided, the ids of what landed
 * are the honest answer.
 *
 * `vinsFilled` IS SEPARATE FROM THE ROWS, and reported, because it is the one
 * thing filing does that is not a compliance record: a matched truck missing a
 * VIN gets the certificate's, add-missing. A write nobody is told about is a
 * write nobody can check.
 */
export interface FileCoiState {
  error: string | null
  filedRecordIds: string[]
  /** Truck ids whose VIN this filing wrote. Usually empty; the screen names them. */
  vinsFilled: string[]
}

export const FILE_COI_INITIAL: FileCoiState = {
  error: null,
  filedRecordIds: [],
  vinsFilled: [],
}
