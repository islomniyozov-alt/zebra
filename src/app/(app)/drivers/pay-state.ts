import type { MessageKey } from '@/lib/i18n'

// Form state for the pay-rule panel. Its own module because a `'use server'`
// file may export async functions and NOTHING else — a value export there is a
// runtime 500 with no message in the browser. See eslint.config.mjs.

export interface PayRuleState {
  error: MessageKey | null
  savedId: string | null
}

export const PAY_RULE_INITIAL: PayRuleState = { error: null, savedId: null }
