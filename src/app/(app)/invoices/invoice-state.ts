import type { MessageKey } from '@/lib/i18n'

// Form state for the invoice screens. Out of the action files because a
// "use server" module may export async functions and nothing else.

export interface InvoiceState {
  error: MessageKey | null
  /** Load numbers named in a refusal, so the message can say which. */
  loadNumbers: string[]
  createdId: string | null
}

export const INVOICE_INITIAL: InvoiceState = {
  error: null,
  loadNumbers: [],
  createdId: null,
}
