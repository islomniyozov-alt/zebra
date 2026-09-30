import type { MessageKey } from '@/lib/i18n'

// A `'use server'` file may export async functions and NOTHING else.

export interface ApplyRefusal {
  /** What the reader calls it: `INV-1002`, `DT-015095`. */
  label: string
  reason: MessageKey
}

export interface ApplyState {
  /** Total applied. Null before anything has been submitted. */
  appliedCents: number | null
  /** What is left on the payment. Often, correctly, not zero. */
  unappliedCents: number | null
  /**
   * Every allocation that was refused.
   *
   * NON-EMPTY MEANS NOTHING WAS APPLIED. The apply is all-or-nothing (§6.2.5)
   * — one person dividing one payment, so a partial split is one nobody
   * chose. These are what to fix before resubmitting.
   */
  refusals: ApplyRefusal[]
}

export const APPLY_INITIAL: ApplyState = {
  appliedCents: null,
  unappliedCents: null,
  refusals: [],
}
