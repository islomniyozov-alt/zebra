import type { MessageKey } from '@/lib/i18n'

// The rate form's starting state. Out of ./rate-actions.ts because a
// "use server" file may export async functions and nothing else.

export interface RateState {
  error: MessageKey | null
  field: 'linehaul' | 'fuelSurcharge' | null
  savedTotalCents: number | null
}

export const RATE_INITIAL: RateState = {
  error: null,
  field: null,
  savedTotalCents: null,
}
