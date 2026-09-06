// The shape the CDL read passes back, in a PLAIN module.
//
// NOT IN `cdl-actions.ts`, and the lint rule that sent it here is Phase 2 flag
// 13's: a `'use server'` file may only export async functions. A value export
// compiles, typechecks, and then fails at runtime as a 500 with a bare digest
// in the browser — which shipped three times before the selector existed.

export interface CdlReadState {
  /** Values for the confirm form. Empty until the reader can read. */
  values: Record<string, string>
  /** True once a read was attempted, whatever it returned. */
  attempted: boolean
  /** An i18n key, never a sentence — the screen renders it in the language. */
  notice: string | null
  fileName: string | null
}

export const EMPTY_CDL_READ: CdlReadState = {
  values: {},
  attempted: false,
  notice: null,
  fileName: null,
}
