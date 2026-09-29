import type { MessageKey } from '@/lib/i18n'

// A `'use server'` file may export async functions and NOTHING else.

export interface BulkRefusal {
  /** What the reader calls it: `SB-000004`, or the id where there is no number. */
  batch: string
  reason: MessageKey
  /** Named drivers, where the refusal was a blocker. */
  blockedBy: string[]
}

export interface BulkState {
  /** How many batches changed. Zero with refusals is a complete failure. */
  changed: number
  refusals: BulkRefusal[]
}

export const BULK_INITIAL: BulkState = { changed: 0, refusals: [] }
