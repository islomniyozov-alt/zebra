import type { MessageKey } from '@/lib/i18n'

// The shapes the users screen's forms start in. Kept out of ./actions.ts
// because a "use server" file may export async functions and nothing else —
// see ../dispatch/assign-state.ts and the eslint rule it is named in.

export interface CreateUserState {
  error: MessageKey | null
  /**
   * Set exactly once, on the response that created the account.
   *
   * It is never read back from anywhere: the server has only the argon2id
   * hash after this. If the admin loses it before handing it over, the answer
   * is to deactivate the account and create another — which is cheap, and
   * cheaper than a password that lives long enough to be worth stealing.
   */
  created: { name: string; email: string; temporaryPassword: string } | null
}

export const CREATE_USER_INITIAL: CreateUserState = {
  error: null,
  created: null,
}
