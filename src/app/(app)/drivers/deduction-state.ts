import type { MessageKey } from '@/lib/i18n'

// Form state for the deduction and opening-balance panels. Its own module for
// the reason `pay-state.ts` gives: a `'use server'` file may export async
// functions and NOTHING else, and a value export there is a runtime 500 with
// nothing in the browser to explain it. See eslint.config.mjs.

export interface DeductionState {
  error: MessageKey | null
  savedId: string | null
}

export const DEDUCTION_INITIAL: DeductionState = { error: null, savedId: null }

export interface OpeningState {
  error: MessageKey | null
  savedId: string | null
}

export const OPENING_INITIAL: OpeningState = { error: null, savedId: null }
