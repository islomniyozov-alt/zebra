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
  const result = await login(db, {
    email,
    password,
    // Session rotation: whatever session arrived with the request is revoked
    // before a new one is minted, so a token planted before authentication is
    // worthless after it.
    currentToken: store.get(SESSION_COOKIE)?.value ?? null,
    metadata: await requestMetadata(),
  })

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

  await setSessionCookie(result.token)

  // From here the interface speaks the language the user chose, without a
  // database read per render.
  const user = await db.user.findUnique({
    where: { id: result.context.userId },
    select: { locale: true },
  })
  if (isLocale(user?.locale)) {
    store.set(LOCALE_COOKIE, user.locale, {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    })
  }

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
