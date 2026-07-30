'use server'

import { unauthenticatedDb } from '@/lib/auth-db'
import { requestMetadata } from '@/lib/auth-context'
import { requestPasswordReset, resetPassword } from '@/lib/password-reset'
import type { MessageKey } from '@/lib/i18n'

// The named exception: sign-in has no session, so it has no tenant to scope
// to. See src/lib/auth-db.ts.
const client = unauthenticatedDb

export interface ResetRequestState {
  status: 'idle' | 'sent' | 'rate_limited'
}

export async function requestResetAction(
  _previous: ResetRequestState,
  formData: FormData,
): Promise<ResetRequestState> {
  const email = String(formData.get('email') ?? '')
  const { ip } = await requestMetadata()

  const outcome = await requestPasswordReset(client(), email, { ip })
  if (outcome.rateLimited) return { status: 'rate_limited' }

  // DELIVERY IS NOT BUILT. §4 puts integrations, email included, out of scope
  // for Phase 1, so there is nowhere to send the link yet. What exists is the
  // whole mechanism: the token is generated, stored as a digest, expiring and
  // single-use. Only the transport is missing, and wiring it does not change
  // anything here.
  //
  // The answer is the same sentence whether or not the account exists.
  return { status: 'sent' }
}

export interface ResetConfirmState {
  error: MessageKey | null
  done: boolean
}

export async function confirmResetAction(
  _previous: ResetConfirmState,
  formData: FormData,
): Promise<ResetConfirmState> {
  const token = String(formData.get('token') ?? '')
  const password = String(formData.get('password') ?? '')
  const confirmation = String(formData.get('confirmation') ?? '')

  if (password !== confirmation) {
    return { error: 'auth.reset.mismatch', done: false }
  }

  const outcome = await resetPassword(client(), token, password)
  if (outcome.ok) return { error: null, done: true }

  return {
    error:
      outcome.reason === 'too_short'
        ? 'auth.reset.tooShort'
        : 'auth.reset.invalidToken',
    done: false,
  }
}
