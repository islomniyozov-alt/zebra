import type { MessageKey } from '@/lib/i18n'

// Form state for the settings screen. Its own module because a `'use server'`
// file may export async functions and NOTHING else.

export interface SettingsState {
  error: MessageKey | null
  /** Which input the error is about, so the screen can point at it. */
  field: string | null
  /** What actually moved. Null before a save, empty when nothing changed. */
  changed: string[] | null
}

export const SETTINGS_INITIAL: SettingsState = {
  error: null,
  field: null,
  changed: null,
}
