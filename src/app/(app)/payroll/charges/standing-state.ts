import type { MessageKey } from '@/lib/i18n'

// A `'use server'` file may export async functions and NOTHING else — Next
// refuses the rest at BUILD time, which `npm run check` never reaches. Same
// reason `state.ts` exists beside the same folder's other actions.

export interface StandingState {
  error: MessageKey | null
  /** Which row the last write touched, so the screen can confirm in place. */
  savedId: string | null
}

export const STANDING_INITIAL: StandingState = { error: null, savedId: null }
