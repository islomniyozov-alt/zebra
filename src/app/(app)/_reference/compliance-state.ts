import type { MessageKey } from '@/lib/i18n'
import type { ComplianceFormValues } from '@/lib/compliance-form'

// Form state for the compliance panel. Its own module because a `'use server'`
// file may export async functions and NOTHING else — a value export there is a
// runtime 500 with no message in the browser. See eslint.config.mjs.

export interface ComplianceState {
  error: MessageKey | null
  createdId: string | null
  /**
   * What was typed, handed back on a refusal so the form shows it again
   * (§0 rule 14). React resets an action form's fields after the action;
   * the panel's `defaultValue`s read this, so the reset lands on the typed
   * values rather than on blanks. Null after a save — the form starts clean.
   */
  values: ComplianceFormValues | null
}

export const COMPLIANCE_INITIAL: ComplianceState = {
  error: null,
  createdId: null,
  values: null,
}
