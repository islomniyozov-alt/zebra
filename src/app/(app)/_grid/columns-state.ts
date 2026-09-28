import type { MessageKey } from '@/lib/i18n'

// A `'use server'` file may export async functions and NOTHING else — Next
// refuses the rest at BUILD time, which `npm run check` never reaches.

export interface ColumnsState {
  error: MessageKey | null
}

export const COLUMNS_INITIAL: ColumnsState = { error: null }
