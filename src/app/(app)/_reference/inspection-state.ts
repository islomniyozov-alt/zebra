import type { MessageKey } from '@/lib/i18n'

// Form state for the inspection screens. Its own module because a `'use server'`
// file may export async functions and NOTHING else — a value export there is a
// runtime 500 with no message in the browser. See eslint.config.mjs.

export interface InspectionState {
  error: MessageKey | null
}

export const INSPECTION_INITIAL: InspectionState = { error: null }
