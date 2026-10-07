import type { MessageKey } from '@/lib/i18n'

// Form state for the pay-rule panel. Its own module because a `'use server'`
// file may export async functions and NOTHING else — a value export there is a
// runtime 500 with no message in the browser. See eslint.config.mjs.

export interface PayRuleState {
  error: MessageKey | null
  savedId: string | null
}

export const PAY_RULE_INITIAL: PayRuleState = { error: null, savedId: null }

/** The pay-to form (§6.4 part 2, queue item 17). The error is already in words. */
export interface PayToState {
  error: string | null
  saved: boolean
}

export const PAY_TO_INITIAL: PayToState = { error: null, saved: false }
