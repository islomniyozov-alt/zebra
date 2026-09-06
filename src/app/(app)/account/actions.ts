'use server'

import { changeOwnPassword, setOwnName } from '@/lib/auth'
import { ownAccountDb } from '@/lib/auth-db'
import { requireSession } from '@/lib/auth-context'
import { MIN_PASSWORD_LENGTH } from '@/lib/password-reset'
import { revalidatePath } from 'next/cache'
import type { MessageKey } from '@/lib/i18n'

// Changing your own password. See src/lib/auth-db.ts for why this reaches for
// a handle rather than `withCurrentOrg`: `User` and `Session` are outside RLS,
// and this is emphatically not `user:update`.
//
// The decision itself — is the current password right, is the new one long
// enough — lives in `changeOwnPassword`, not here. Routes call; they do not
// decide.

export interface PasswordFormState {
  /** An i18n key, never a sentence. The form renders it in the user's language. */
  error: MessageKey | null
  done: boolean
}

export async function changePasswordAction(
  _previous: PasswordFormState,
  formData: FormData,
): Promise<PasswordFormState> {
  const session = await requireSession()

  const current = String(formData.get('current') ?? '')
  const next = String(formData.get('password') ?? '')
  const confirmation = String(formData.get('confirmation') ?? '')

  if (next !== confirmation) {
    return { error: 'account.password.mismatch', done: false }
  }

  const outcome = await changeOwnPassword(
    ownAccountDb(),
    session.userId,
    current,
    next,
    // Every other session ends; this one survives, so the person who just
    // proved they own the account is not the one thrown out.
    { minLength: MIN_PASSWORD_LENGTH, keepSessionId: session.sessionId },
  )

  if (outcome.ok) return { error: null, done: true }

  return {
    error:
      outcome.reason === 'too_short'
        ? 'account.password.tooShort'
        : outcome.reason === 'unchanged'
          ? 'account.password.unchanged'
          : 'account.password.wrongCurrent',
    done: false,
  }
}

export interface NameFormState {
  error: MessageKey | null
  done: boolean
}

/**
 * Your own name, which until 2026-09-06 nothing could change.
 *
 * `revalidatePath('/', 'layout')` because the topbar reads this on every
 * screen: without it the field saves, the page re-renders from cache, and the
 * name in the corner still says what it said — which reads as a save that
 * silently failed.
 */
export async function changeNameAction(
  _previous: NameFormState,
  formData: FormData,
): Promise<NameFormState> {
  const session = await requireSession()

  const outcome = await setOwnName(
    ownAccountDb(),
    session.userId,
    String(formData.get('name') ?? ''),
  )

  if (!outcome.ok) {
    return {
      error:
        outcome.reason === 'too_long'
          ? 'account.name.tooLong'
          : 'account.name.empty',
      done: false,
    }
  }

  revalidatePath('/', 'layout')
  return { error: null, done: true }
}
