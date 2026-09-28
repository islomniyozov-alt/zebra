// A `'use server'` FILE MAY EXPORT ASYNC FUNCTIONS AND NOTHING ELSE.
//
// Next refuses anything else at BUILD time, which `npm run check` never reaches
// — so a type exported from `actions.ts` compiles, lints, passes every test and
// then fails the deploy. That has cost a session before; the state type lives in
// a plain module beside the action instead.

export interface PayrollFormState {
  error: string | null
}

export const PAYROLL_INITIAL: PayrollFormState = { error: null }
