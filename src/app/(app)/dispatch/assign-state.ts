// The shape the assign form's `useActionState` starts in.
//
// It lives here rather than beside the action because a "use server" file may
// export async functions and nothing else — a constant exported from one is a
// runtime 500 with no message in the browser, which is how this board first
// shipped. The eslint rule in eslint.config.mjs now makes that a build error.

/** One line of "this truck's registration lapsed 12 days ago". */
export interface AssignWarning {
  subjectLabel: string
  typeLabel: string
  /** Already rendered by the server: "40 days ago", "in 6 days". */
  when: string
  expired: boolean
}

export interface AssignState {
  error: string | null
  /** Set when the assignment moved the load, so the board can say so. */
  moved: string | null
  /**
   * §2.4's warning, shown and NOT acted on. The assignment did not happen; the
   * dispatcher sees these in words and confirms, or does not.
   *
   * Empty rather than null once acknowledged, so the board can tell "we have
   * not asked yet" from "we asked and they said go".
   */
  warnings: AssignWarning[] | null
}

export const ASSIGN_INITIAL: AssignState = {
  error: null,
  moved: null,
  warnings: null,
}
