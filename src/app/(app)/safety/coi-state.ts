/**
 * The certificate-filing action's state.
 *
 * Its own file because a `'use server'` module may only export async
 * functions — the repo lint rule that caught `med-state.ts` being folded into
 * its action.
 *
 * `filedRecordIds` is a LIST because one certificate becomes up to two rows,
 * and because a partial success has to be reportable: if liability filed and
 * cargo collided, the ids of what landed are the honest answer.
 */
export interface FileCoiState {
  error: string | null
  filedRecordIds: string[]
}

export const FILE_COI_INITIAL: FileCoiState = {
  error: null,
  filedRecordIds: [],
}
