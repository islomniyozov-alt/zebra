// Form state for the driver record's Sign-in card (Phase 7 step 1). Its own
// module because a `'use server'` file may export async functions and NOTHING
// else — see pay-state.ts and eslint.config.mjs.

export interface SignInLinkState {
  /** Already in words. */
  error: string | null
  saved: boolean
}

export const SIGN_IN_LINK_INITIAL: SignInLinkState = {
  error: null,
  saved: false,
}
