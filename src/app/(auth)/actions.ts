'use server'

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { login } from '@/lib/auth'
import { unauthenticatedDb } from '@/lib/auth-db'
import {
  requestMetadata,
  setSessionCookie,
  clearSessionCookie,
} from '@/lib/auth-context'
import { SESSION_COOKIE } from '@/lib/session'
import { withSocketRetry } from '@/lib/socket-retry'
import { logout } from '@/lib/auth'
import { LOCALE_COOKIE } from '@/lib/locale'
import { isLocale } from '@/lib/i18n'
import type { MessageKey } from '@/lib/i18n'

// The auth mechanism has been complete and tested since Step 4; this is the
// first thing standing in front of it.
//
// Server actions rather than route handlers, because the form has to work
// before any JavaScript loads. A dispatcher on a bad connection at a truck
// stop should still be able to sign in.
//
// These live outside `withCurrentOrg` on purpose — there is no session yet, so
// there is no tenant to scope to. `User`, `Session` and `LoginAttempt` are the
// three tables outside row-level security for exactly this reason.

// The named exception: sign-in has no session, so it has no tenant to scope
// to. See src/lib/auth-db.ts.
const client = unauthenticatedDb

export interface AuthFormState {
  /** An i18n key, never a sentence — the form renders it in the user's language. */
  error: MessageKey | null
}

export async function signInAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')

  if (email === '' || password === '') {
    return { error: 'auth.invalid' }
  }

  const store = await cookies()
  const db = client()

  // ── THE ACTION DOES NOT THROW. §7.5.1 ─────────────────────────────────
  //
  // Everything fallible is inside this try, and every failure leaves with
  // WORDS. A thrown server action shows whatever the framework shows, which is
  // not a sentence about this form — and the owner's report on 2026-10-03 was
  // exactly that: a correct password, refused, with nothing said.
  //
  // ONE RETRY FIRST, on a dropped Neon socket and nothing else. A message for
  // something a retry would have fixed teaches people to distrust the message.
  //
  // WHAT A REPEAT CAN DUPLICATE, named as `withSocketRetry` requires: a second
  // `LoginAttempt` row for one attempt, and at most one extra `Session` row
  // whose token nothing holds. Both are harmless here and both are bounded —
  // attempt rows for this email are deleted on the next success, and a session
  // nobody holds expires. It is NOT a transaction, so there is no partial write
  // to replay.
  // READ ONCE, OUTSIDE THE RETRY. It reads request headers rather than the
  // database, so it cannot fail from a dropped socket and must not be re-read
  // per attempt.
  const metadata = await requestMetadata()

  let result: Awaited<ReturnType<typeof login>>
  try {
    result = await withSocketRetry('signInAction.login', () =>
      login(db, {
        email,
        password,
        // Session rotation: whatever session arrived with the request is revoked
        // before a new one is minted, so a token planted before authentication is
        // worthless after it.
        currentToken: store.get(SESSION_COOKIE)?.value ?? null,
        metadata,
      }),
    )
  } catch {
    // THE ROW EVERYBODY FORGETS: the request was fine and the system was not.
    // It says the system failed, not the person, and it says the remedy.
    return { error: 'auth.unavailable' }
  }

  if (!result.ok) {
    // Three outcomes, three messages, and none of them says which half was
    // wrong. `invalid_credentials` covers "no such user" and "wrong password"
    // alike — the failure path already costs the same either way (§7).
    return {
      error:
        result.reason === 'rate_limited'
          ? 'auth.rateLimited'
          : result.reason === 'no_membership'
            ? 'auth.noMembership'
            : 'auth.invalid',
    }
  }

  // ── FROM HERE NOTHING CAN FAIL BUT THE REDIRECT. §7.5.1 ───────────────
  //
  // The locale arrived WITH the credential check — one column on a query that
  // already ran — so there is no second read to drop a socket on. It used to be
  // fetched here, after the cookie, and that read was the defect: it threw, the
  // form said nothing, and the session it had just minted was live.
  //
  // Both writes below are cookie-store writes, which cannot reach the network.
  if (isLocale(result.locale)) {
    store.set(LOCALE_COOKIE, result.locale, {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    })
  }

  await setSessionCookie(result.token)

  // THE FIRST SCREEN OF THE DAY, and signing in is the start of it. This was
  // /loads until Step B, which left the two arrival routes disagreeing: the
  // bare domain went to the dashboard and a sign-in went to Loads.
  //
  // Every operator role holds `dashboard:read` — OWNER and ADMIN through
  // EVERYTHING, MANAGER and DISPATCHER through OPERATIONS_READ, ACCOUNTING
  // explicitly. A DRIVER holds neither this nor `load:read`, so the operator
  // application refuses them here exactly as it refused them at /loads.
  redirect('/dashboard')
}

export async function signOutAction(): Promise<void> {
  const store = await cookies()
  await logout(client(), store.get(SESSION_COOKIE)?.value ?? null)
  await clearSessionCookie()
  redirect('/login')
}
