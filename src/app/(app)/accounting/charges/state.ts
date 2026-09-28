import type { MessageKey } from '@/lib/i18n'

// A `'use server'` file may export async functions and NOTHING else — Next
// refuses the rest at BUILD time, which `npm run check` never reaches. Same
// reason `deduction-state.ts` exists beside the driver page's actions.

export interface ChargeState {
  error: MessageKey | null
  /** Which row the last write touched, so the screen can confirm in place. */
  savedId: string | null
}

export const CHARGE_INITIAL: ChargeState = { error: null, savedId: null }
