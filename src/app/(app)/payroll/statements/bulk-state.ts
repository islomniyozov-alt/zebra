import type { MessageKey } from '@/lib/i18n'

// A `'use server'` file may export async functions and NOTHING else.

export interface StatementRefusal {
  /** What the reader calls it: `ST-000018`, or the driver where there is no number. */
  statement: string
  reason: MessageKey
}

export interface StatementBulkState {
  changed: number
  refusals: StatementRefusal[]
}

export const STATEMENT_BULK_INITIAL: StatementBulkState = {
  changed: 0,
  refusals: [],
}
