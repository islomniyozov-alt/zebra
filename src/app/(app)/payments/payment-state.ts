import type { MessageKey } from '@/lib/i18n'

// Form state for the payment screens. Its own module because a `'use server'`
// file may export async functions and NOTHING else — a value export there is a
// runtime 500 with no message in the browser. See eslint.config.mjs.

export interface PaymentState {
  error: MessageKey | null
  /** Load numbers named in a refusal, so the message can say which. */
  loadNumbers: string[]
  /** Set after a successful apply, so the panel can say what is left. */
  unappliedCents: number | null
  /** Statement money the loads did not account for. Never forced to zero. */
  shortfallCents: number | null
}

export const PAYMENT_INITIAL: PaymentState = {
  error: null,
  loadNumbers: [],
  unappliedCents: null,
  shortfallCents: null,
}
