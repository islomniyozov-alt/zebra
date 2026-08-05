import type { MessageKey } from '@/lib/i18n'

// Form state for the factoring screens. Its own module because a `'use server'`
// file may export async functions and NOTHING else — a value export there is a
// runtime 500 with no message in the browser, which is how the dispatch board's
// assign button silently did nothing for a session. See eslint.config.mjs.

export interface FactoringState {
  error: MessageKey | null
  savedId: string | null
}

export const FACTORING_INITIAL: FactoringState = {
  error: null,
  savedId: null,
}
