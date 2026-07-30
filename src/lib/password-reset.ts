import type { PrismaClient } from '@/generated/prisma/client'
import { hashPassword } from './password'
import {
  generateSessionToken,
  hashSessionToken,
  revokeAllSessionsForUser,
} from './session'
import { normalizeEmail, RATE_LIMIT, type AuthDb } from './auth'

// ---------------------------------------------------------------------------
// PASSWORD RESET (§11.6)
//
// The thing that surfaces the day a real user forgets a password, which is why
// it is owned rather than left implicit.
//
// Four properties, each with a way of going wrong:
//
//   EXPIRING       a link that works forever is a password that never changed.
//   SINGLE USE     redemption is recorded, not deleted, so a replayed link is
//                  refused rather than silently accepted because the row
//                  happened to still be there.
//   HASHED         the database stores SHA-256 of the token, like Session. A
//                  dump opens nothing.
//   RATE LIMITED   the same ledger as login, because "request a reset" is an
//                  unauthenticated endpoint that sends mail and touches the
//                  database, and both are worth spending on someone else's
//                  behalf.
//
// AND IT NEVER SAYS WHETHER THE ACCOUNT EXISTS. Requesting a reset for an
// unknown address returns exactly what a known one returns. Otherwise this
// becomes the account-enumeration oracle that login carefully is not.
// ---------------------------------------------------------------------------

export type ResetDb = AuthDb & Pick<PrismaClient, 'passwordResetToken'>

/** Long enough to reach an inbox and act, short enough to matter. */
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000

/** Below this a password is not worth hashing at 600,000 iterations. */
export const MIN_PASSWORD_LENGTH = 12

export interface ResetRequestOutcome {
  /**
   * The token, when one was issued. NEVER returned to the caller of the HTTP
   * endpoint — this exists so the delivery mechanism can send it, and so tests
   * can assert on it. The user-facing answer is always the same sentence.
   */
  token: string | null
  rateLimited: boolean
}

export async function requestPasswordReset(
  db: ResetDb,
  email: string,
  metadata: { ip?: string | null } = {},
): Promise<ResetRequestOutcome> {
  const normalized = normalizeEmail(email)
  const ip = metadata.ip ?? null
  const since = new Date(Date.now() - RATE_LIMIT.windowMs)

  // Same ledger as login. A reset request is a failed-login-shaped event: it
  // costs a database write and an email, and an attacker can trigger it with
  // nothing but an address.
  const [byEmail, byIp] = await Promise.all([
    db.loginAttempt.count({
      where: { email: normalized, succeeded: false, createdAt: { gte: since } },
    }),
    ip
      ? db.loginAttempt.count({
          where: { ip, succeeded: false, createdAt: { gte: since } },
        })
      : Promise.resolve(0),
  ])

  if (byEmail >= RATE_LIMIT.perEmail || byIp >= RATE_LIMIT.perIp) {
    return { token: null, rateLimited: true }
  }

  await db.loginAttempt.create({
    data: {
      email: normalized,
      succeeded: false,
      ip,
      userAgent: 'password-reset',
    },
  })

  const user = await db.user.findUnique({
    where: { email: normalized },
    select: { id: true, isActive: true },
  })

  // No such user, or a deactivated one. The caller gets the same answer either
  // way; there is simply nothing to send.
  if (!user || !user.isActive) {
    return { token: null, rateLimited: false }
  }

  const token = generateSessionToken()
  await db.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: await hashSessionToken(token),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      requestedIp: ip,
    },
  })

  return { token, rateLimited: false }
}

export type ResetFailure =
  | 'invalid_token'
  | 'expired'
  | 'already_used'
  | 'too_short'

export type ResetOutcome = { ok: true } | { ok: false; reason: ResetFailure }

/**
 * Redeem a token and set a new password.
 *
 * Ends every other session on success, for the same reason `changePassword`
 * does: if the password is being reset because it leaked, leaving the
 * attacker's session alive makes the reset decorative.
 */
export async function resetPassword(
  db: ResetDb,
  token: string,
  newPassword: string,
): Promise<ResetOutcome> {
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, reason: 'too_short' }
  }

  const record = await db.passwordResetToken.findUnique({
    where: { tokenHash: await hashSessionToken(token) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  })

  if (!record) return { ok: false, reason: 'invalid_token' }
  if (record.usedAt !== null) return { ok: false, reason: 'already_used' }
  if (record.expiresAt.getTime() <= Date.now())
    return { ok: false, reason: 'expired' }

  // Mark used FIRST, and only where it is still unused. Two redemptions racing
  // both read usedAt === null above; this is the one that decides, because the
  // second one updates zero rows.
  const claimed = await db.passwordResetToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  })
  if (claimed.count === 0) return { ok: false, reason: 'already_used' }

  await db.user.update({
    where: { id: record.userId },
    data: { passwordHash: await hashPassword(newPassword) },
  })

  await revokeAllSessionsForUser(db, record.userId)

  // Any other outstanding link for this user is now stale. Leaving them live
  // would mean a second forgotten-password email from last week still works.
  await db.passwordResetToken.updateMany({
    where: { userId: record.userId, usedAt: null },
    data: { usedAt: new Date() },
  })

  return { ok: true }
}

/** Housekeeping. Expired and redeemed rows have no further use. */
export async function purgeUsedResetTokens(
  db: ResetDb,
  olderThan: Date = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
): Promise<number> {
  const { count } = await db.passwordResetToken.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: olderThan } }, { usedAt: { lt: olderThan } }],
    },
  })
  return count
}
