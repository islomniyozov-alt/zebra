'use server'

import { headers } from 'next/headers'
import { unauthenticatedDb } from '@/lib/auth-db'
import { requestMetadata } from '@/lib/auth-context'
import { requestPasswordReset, resetPassword } from '@/lib/password-reset'
import { getLocaleContext } from '@/lib/locale'
import { sendEmail } from '@/lib/email'
import { resetEmail, resetLink } from '@/lib/reset-email'
import type { MessageKey } from '@/lib/i18n'

/** The host this request arrived on, when `APP_ORIGIN` is not set. */
async function requestHost(): Promise<string | null> {
  const list = await headers()
  return list.get('host')
}

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
  if (outcome.rateLimited) {
    // Logged because it is the OTHER way this request produces no email, and
    // without it a rate-limited attempt and a delivered one look identical in
    // the worker log. That ambiguity cost a diagnosis round trip.
    console.warn('[zebra.reset] refused: rate limited', { ip })
    return { status: 'rate_limited' }
  }

  // A token comes back only when the address belongs to an active account.
  // Everything below therefore happens for SOME requests and not others — and
  // the answer returned to the browser is identical either way, because that
  // difference is exactly what an enumeration attack is looking for. No
  // branch below may reach the return value, including the failures.
  if (outcome.token) {
    const { t, locale, dir } = await getLocaleContext()
    const link = resetLink(outcome.token, {
      origin: process.env.APP_ORIGIN,
      host: await requestHost(),
    })
    // Not awaited into the response? It is. A Worker that returns before its
    // subrequest finishes has the subrequest cancelled, and `waitUntil` is not
    // reachable from a server action. The send is ~200ms and the honest cost
    // of the feature.
    const sent = await sendEmail(resetEmail(email, link, t, locale, dir))
    if (!sent.ok) {
      console.error('[zebra.reset] the link was issued but not delivered', {
        reason: sent.reason,
      })
    }
  }

  // The same sentence whether or not the account exists, and whether or not
  // Resend was reachable.
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
