// Form state for Load's one primary action (Phase 7 step 4). Its own module
// because a `'use server'` file may export async functions and NOTHING else.

export interface StatusStepState {
  /** Already in words. */
  error: string | null
  /** The status word the tap landed on, in words, or null. */
  movedTo: string | null
}

export const STATUS_STEP_INITIAL: StatusStepState = {
  error: null,
  movedTo: null,
}
