// A `'use server'` file may export async functions and NOTHING else, so the
// batch screen's bulk state lives here (§6.2.10 part 7 step 3).

export interface BatchBulkState {
  /** How many statements the act reached. */
  done: number
  /** Refusals by name, already translated: "ST-000018 — A draft cannot be sent." */
  refusals: string[]
  /** A refusal of the whole act, already translated. */
  error: string | null
}

export const BATCH_BULK_INITIAL: BatchBulkState = {
  done: 0,
  refusals: [],
  error: null,
}
