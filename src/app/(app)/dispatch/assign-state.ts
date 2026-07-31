// The shape the assign form's `useActionState` starts in.
//
// It lives here rather than beside the action because a "use server" file may
// export async functions and nothing else — a constant exported from one is a
// runtime 500 with no message in the browser, which is how this board first
// shipped. The eslint rule in eslint.config.mjs now makes that a build error.

export interface AssignState {
  error: string | null
  /** Set when the assignment moved the load, so the board can say so. */
  moved: string | null
}

export const ASSIGN_INITIAL: AssignState = { error: null, moved: null }
