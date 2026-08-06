import type { MessageKey } from '@/lib/i18n'

// Form state for the settlement screens. Its own module because a `'use server'`
// file may export async functions and NOTHING else — a value export there is a
// runtime 500 with no message in the browser. See eslint.config.mjs.

export interface SettlementState {
  error: MessageKey | null
  /** Load numbers named in a refusal, so the message can say which. */
  loadNumbers: string[]
  createdId: string | null
}

export const SETTLEMENT_INITIAL: SettlementState = {
  error: null,
  loadNumbers: [],
  createdId: null,
}
