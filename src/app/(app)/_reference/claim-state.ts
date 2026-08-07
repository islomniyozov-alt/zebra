import type { MessageKey } from '@/lib/i18n'

// Form state for the claim and DataQs screens. Its own module because a
// `'use server'` file may export async functions and NOTHING else — a value
// export there is a runtime 500 with no message in the browser.

export interface ClaimState {
  error: MessageKey | null
}

export const CLAIM_INITIAL: ClaimState = { error: null }
