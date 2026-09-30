import type { MessageKey } from '@/lib/i18n'

// A `'use server'` file may export async functions and NOTHING else.

export interface SentRefusal {
  /** What the reader calls it: `INV-001204`, or the id where there is none. */
  invoice: string
  reason: MessageKey
}

export interface SentState {
  /** How many were recorded as sent. Zero with refusals is a total failure. */
  changed: number
  refusals: SentRefusal[]
}

export const SENT_INITIAL: SentState = { changed: 0, refusals: [] }
