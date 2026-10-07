import type { MessageKey } from '@/lib/i18n'

// The shape the roster bulk bar's `useActionState` starts in. Kept out of
// ./bulk-actions.ts for the reason recorded in ../dispatch/assign-state.ts: a
// "use server" file may export async functions and nothing else.

export interface RosterRefusal {
  /** The driver as the reader knows them, or the id where the row is gone. */
  driver: string
  reason: MessageKey
}

export interface RosterBulkState {
  /** How many drivers changed. Zero with refusals is a complete failure. */
  changed: number
  refusals: RosterRefusal[]
}

export const ROSTER_BULK_INITIAL: RosterBulkState = { changed: 0, refusals: [] }
