import type { PrismaClient } from '@/generated/prisma/client'
import {
  dummyHash,
  hashPassword,
  needsRehash,
  verifyPassword,
} from './password'
import {
  createSession,
  resolveMembership,
  revokeAllSessionsForUser,
  revokeSession,
  type IssuedSession,
  type RequestMetadata,
  type SessionDb,
} from './session'

// ---------------------------------------------------------------------------
// LOGIN
//
// Three things this file refuses to do, each because the alternative leaks
// something:
//
//   1. It never says which half was wrong. "No such user" and "wrong password"
//      are the same answer, returned after the same amount of work — a missing
//      user still pays for a full PBKDF2 verify against a throwaway hash, so
//      the response time is not a membership oracle.
//   2. It never lets an attacker try indefinitely. Failures are counted per
//      email and per IP over a rolling window.
//   3. It never reuses a session token across a login. Whatever session the
//      browser arrived with is revoked and a fresh one issued, so a token
//      planted before authentication is worthless after it.
// ---------------------------------------------------------------------------

export type AuthDb = SessionDb & Pick<PrismaClient, 'loginAttempt'>

export const RATE_LIMIT = {
  /** Rolling window both limits are measured over. */
  windowMs: 15 * 60 * 1000,
  /** Failures against one email address before it stops accepting attempts. */
  perEmail: 5,
  /**
   * Failures from one address before it is cut off. Higher than perEmail
   * because an office shares an address, and locking out a dispatch floor
   * because one person fat-fingered their password is its own outage.
   */
  perIp: 30,
} as const

export type LoginFailure =
  | { reason: 'invalid_credentials' }
  | { reason: 'rate_limited'; retryAfterMs: number }
  | { reason: 'no_membership' }

export type LoginResult =
  | ({ ok: true } & IssuedSession)
  | ({ ok: false } & LoginFailure)

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export interface LoginInput {
  email: string
  password: string
  /** The session the request arrived with, if any. Revoked on success. */
  currentToken?: string | null
  /** Pick a specific membership when the user belongs to several. */
  organizationId?: string
  metadata?: RequestMetadata
}

async function countRecentFailures(
  db: AuthDb,
  email: string,
  ip: string | null,
  since: Date,
): Promise<{ byEmail: number; byIp: number }> {
  const [byEmail, byIp] = await Promise.all([
    db.loginAttempt.count({
      where: { email, succeeded: false, createdAt: { gte: since } },
    }),
    ip
      ? db.loginAttempt.count({
          where: { ip, succeeded: false, createdAt: { gte: since } },
        })
      : Promise.resolve(0),
  ])
  return { byEmail, byIp }
}

async function record(
  db: AuthDb,
  email: string,
  succeeded: boolean,
  metadata: RequestMetadata,
): Promise<void> {
  await db.loginAttempt.create({
    data: {
      email,
      succeeded,
      ip: metadata.ip ?? null,
      userAgent: metadata.userAgent ?? null,
    },
  })
}

export async function login(
  db: AuthDb,
  input: LoginInput,
): Promise<LoginResult> {
  const email = normalizeEmail(input.email)
  const metadata = input.metadata ?? {}
  const ip = metadata.ip ?? null
  const since = new Date(Date.now() - RATE_LIMIT.windowMs)

  const failures = await countRecentFailures(db, email, ip, since)
  if (
    failures.byEmail >= RATE_LIMIT.perEmail ||
    failures.byIp >= RATE_LIMIT.perIp
  ) {
    // Recorded, so that hammering a locked account extends the lockout rather
    // than waiting it out for free.
    await record(db, email, false, metadata)
    return {
      ok: false,
      reason: 'rate_limited',
      retryAfterMs: RATE_LIMIT.windowMs,
    }
  }

  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true, isActive: true },
  })

  // A user with no password set (invited, never activated) and a user that
  // does not exist take the same path, at the same cost.
  const hash =
    user?.isActive === true && user.passwordHash ? user.passwordHash : null
  const valid = await verifyPassword(
    input.password,
    hash ?? (await dummyHash()),
  )

  if (!hash || !valid || !user) {
    await record(db, email, false, metadata)
    return { ok: false, reason: 'invalid_credentials' }
  }

  const membership = await resolveMembership(db, user.id, input.organizationId)
  if (!membership) {
    // Correct credentials, no way in. Not a credential failure, and not
    // something a stranger can provoke, so it gets its own answer.
    await record(db, email, false, metadata)
    return { ok: false, reason: 'no_membership' }
  }

  // Rotation. Session fixation only works if the token survives the privilege
  // change; this makes sure it does not.
  if (input.currentToken) {
    await revokeSession(db, input.currentToken)
  }

  // The password was right, so this is the only moment we hold the plaintext
  // and could re-stretch it. Failing to upgrade must never fail the login.
  if (needsRehash(hash)) {
    try {
      await db.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(input.password) },
      })
    } catch {
      // Next time.
    }
  }

  const issued = await createSession(
    db,
    user.id,
    {
      organizationId: membership.organizationId,
      role: membership.role,
      companyScopes: membership.companyScopes,
      permissionOverrides: membership.permissionOverrides,
    },
    metadata,
  )

  await Promise.all([
    record(db, email, true, metadata),
    db.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    }),
  ])

  return { ok: true, ...issued }
}

export async function logout(
  db: AuthDb,
  token: string | null | undefined,
): Promise<void> {
  await revokeSession(db, token)
}

/**
 * Change a password and end every other session.
 *
 * The revocation is the point: if the password is being changed because it
 * leaked, leaving the attacker's session alive makes the change decorative.
 */
export async function changePassword(
  db: AuthDb,
  userId: string,
  newPassword: string,
  options: { keepSessionId?: string } = {},
): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword) },
  })
  await revokeAllSessionsForUser(db, userId, {
    ...(options.keepSessionId
      ? { exceptSessionId: options.keepSessionId }
      : {}),
  })
}

export type ChangeOwnPasswordFailure =
  | 'invalid_current'
  | 'too_short'
  | 'unchanged'

export type ChangeOwnPasswordOutcome =
  | { ok: true }
  | { ok: false; reason: ChangeOwnPasswordFailure }

/**
 * A signed-in user changing their own password.
 *
 * The current password is required and verified here rather than in the route,
 * for the same reason permission is decided in one module: a session is not
 * proof of the person. A borrowed laptop, a stolen cookie, or a shoulder
 * surfer all hold a valid session, and without this check any of them converts
 * that into permanent ownership of the account.
 *
 * Deliberately NOT a `user:update` permission check. That resource governs
 * administering OTHER people; a dispatcher who may not manage users must still
 * be able to change their own password, and conflating the two would take that
 * away.
 */
export async function changeOwnPassword(
  db: AuthDb,
  userId: string,
  currentPassword: string,
  newPassword: string,
  options: { minLength: number; keepSessionId?: string },
): Promise<ChangeOwnPasswordOutcome> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true, isActive: true },
  })
  if (!user?.isActive || !user.passwordHash) {
    return { ok: false, reason: 'invalid_current' }
  }

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    return { ok: false, reason: 'invalid_current' }
  }

  if (newPassword.length < options.minLength) {
    return { ok: false, reason: 'too_short' }
  }
  if (newPassword === currentPassword) {
    // Not security theatre: the whole reason to change a password is that the
    // old one is suspect, and silently accepting a no-op would report success
    // for having done nothing.
    return { ok: false, reason: 'unchanged' }
  }

  await changePassword(db, userId, newPassword, {
    ...(options.keepSessionId ? { keepSessionId: options.keepSessionId } : {}),
  })
  return { ok: true }
}

/**
 * Clear a lockout after an operator verifies the account holder out of band.
 * Deletes the failures rather than the record of success, so the audit trail
 * of what happened survives.
 */
export async function clearLoginFailures(
  db: AuthDb,
  email: string,
): Promise<number> {
  const { count } = await db.loginAttempt.deleteMany({
    where: { email: normalizeEmail(email), succeeded: false },
  })
  return count
}
