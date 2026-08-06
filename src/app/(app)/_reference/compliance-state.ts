import type { MessageKey } from '@/lib/i18n'

// Form state for the compliance panel. Its own module because a `'use server'`
// file may export async functions and NOTHING else — a value export there is a
// runtime 500 with no message in the browser. See eslint.config.mjs.

export interface ComplianceState {
  error: MessageKey | null
  createdId: string | null
}

export const COMPLIANCE_INITIAL: ComplianceState = {
  error: null,
  createdId: null,
}
