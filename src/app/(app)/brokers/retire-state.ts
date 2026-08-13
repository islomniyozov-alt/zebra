/**
 * What retiring a broker can come back with (Phase 6 §7 flag 35).
 *
 * A PLAIN MODULE, because `actions.ts` is `"use server"` and may only export
 * async functions — the repository has a lint rule for exactly that.
 *
 * The action used to return `void`, which meant it had nowhere to put a
 * refusal: `retireBroker` throws when freight is filed under the broker, and a
 * throw out of a server action is a 500 with nothing in the browser. The
 * screen hides the control in that case, so the 500 was only reachable in the
 * race — freight booked between the page rendering and the button being
 * pressed. Rare is not the same as acceptable, and a race that prints a stack
 * trace is the one somebody hits at 6am.
 */
export interface RetireState {
  /** Pre-translated sentence, or null. */
  error: string | null
}

export const RETIRE_INITIAL: RetireState = { error: null }
