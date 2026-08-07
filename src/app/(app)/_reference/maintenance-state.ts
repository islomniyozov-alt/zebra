import type { MessageKey } from '@/lib/i18n'

// Form state for the maintenance panel. Its own module for the same reason
// `compliance-state.ts` is: a `'use server'` file may export async functions
// and NOTHING else, and a value export there is a runtime 500 with no message
// in the browser. See eslint.config.mjs.

export interface MaintenanceState {
  error: MessageKey | null
  createdId: string | null
}

export const MAINTENANCE_INITIAL: MaintenanceState = {
  error: null,
  createdId: null,
}
