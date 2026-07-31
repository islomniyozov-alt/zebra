import { cookies } from 'next/headers'
import { REFERENCE_ERROR_KEYS, ReferenceError } from '@/lib/reference'
import { TransferError } from '@/lib/fleet'
import type { RecordFormState } from '@/components/forms/RecordForm'
import type { MessageKey, Translate } from '@/lib/i18n'

// Shared plumbing for the four reference screens. Under `_reference`, so Next
// does not route it.
//
// Nothing here decides anything. Validation lives in src/lib/reference.ts and
// src/lib/fleet.ts; permission lives in src/lib/permissions.ts. This file
// turns their answers into the shapes a form and a cookie want.

/** Remembers the authority a dispatcher last created something under (§6.3). */
export const LAST_AUTHORITY_COOKIE = 'zebra_last_authority'

export async function lastUsedAuthority(): Promise<string | null> {
  const store = await cookies()
  return store.get(LAST_AUTHORITY_COOKIE)?.value ?? null
}

export async function rememberAuthority(companyId: string): Promise<void> {
  const store = await cookies()
  // A convenience, not a security boundary — the value is validated against
  // the session's own scope on every write, in `assertCompanyInScope`.
  store.set(LAST_AUTHORITY_COOKIE, companyId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 180,
  })
}

/**
 * Turn a service-layer failure into a sentence and a field.
 *
 * Anything that is not a typed domain error is re-thrown. Swallowing it here
 * would put "This is required." under a field on a database outage, and the
 * §10 rule is that an error says what actually happened.
 */
export function toFormState(error: unknown, t: Translate): RecordFormState {
  if (error instanceof ReferenceError) {
    return {
      error: t(REFERENCE_ERROR_KEYS[error.code]),
      field: error.field ?? null,
    }
  }
  if (error instanceof TransferError) {
    const key: MessageKey =
      error.code === 'same_authority'
        ? 'ref.error.sameAuthority'
        : error.code === 'double_open'
          ? 'ref.error.doubleOpen'
          : 'ref.error.notFound'
    return { error: t(key), field: null }
  }
  throw error
}

/** `Date` → the `yyyy-mm-dd` an `<input type="date">` expects. */
export function dateInputValue(value: Date | null | undefined): string {
  return value ? value.toISOString().slice(0, 10) : ''
}

/** `—` in ink-3 means no value recorded; `0` means zero (§8). */
export const DASH = '—'

export function orDash(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return DASH
  const text = String(value)
  return text.trim() === '' ? DASH : text
}
