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

/**
 * HOW LONG IT TAKES TO PROVE THE PER-IP LIMIT THROUGH THE REAL LOGIN PATH.
 *
 * Every attempt pays a full argon2 verification, including the ones against
 * addresses that do not exist: `login` below feeds `dummyHash()` to
 * `verifyPassword` when it finds no user, precisely so an unknown email costs
 * the same as a known one and enumeration by timing gets nothing. That is
 * correct and must stay, so the floor on proving `perIp` is `perIp + 2`
 * sequential hashes plus their round trips to Neon.
 *
 * MEASURED, NOT GUESSED: 49.8s on a developer machine for the 32 attempts
 * `perIp: 30` implies — about 1.5s each. CI is slower than that and ran past
 * the integration project's 120s default on 2026-09-24, failing a production
 * dispatch on a suite that had nothing to do with the commit in flight.
 *
 * DERIVED FROM `perIp` RATHER THAN WRITTEN AS A NUMBER. The comment above
 * explains why an office might need a higher ceiling, so the day somebody
 * raises it a literal budget would re-create this exact failure — a test that
 * times out for a reason nobody connects to the line they changed.
 */
export const RATE_LIMIT_PROBE_BUDGET_MS = (RATE_LIMIT.perIp + 2) * 6_000

export type LoginFailure =
  | { reason: 'invalid_credentials' }
  | { reason: 'rate_limited'; retryAfterMs: number }
  | { reason: 'no_membership' }

export type LoginResult =
  | ({ ok: true; locale: string | null } & IssuedSession)
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

/**
 * Failures that still count, per email and per address.
 *
 * ── THE EMAIL'S COUNT STARTS AT ITS LAST SUCCESS ─────────────────────────
 *
 * Owner's ruling, 2026-10-04, reversing the delete that shipped hours earlier.
 * The lockout has to end when the right password is typed — otherwise five
 * wrong tries leave a CORRECT password refused for the rest of the window,
 * which is the reported bug — and the first fix achieved that by DELETING the
 * failed rows. That worked and cost the audit trail: "five failures then a
 * success, one address, one window" is the signature of a guess that worked,
 * and it read afterwards as one clean sign-in.
 *
 * SO THE ROWS STAY AND THE COUNTER MOVES. One extra clause: only failures AFTER
 * this email's most recent success are counted. Same outcome for the person at
 * the keyboard, whole history kept, and no migration — the ordering column was
 * already there.
 *
 * THE PER-IP COUNT IS UNCHANGED, deliberately. It is the coarse fence, six
 * times the per-email threshold because an office shares an address, and it must
 * NOT reset on somebody else's success: a guesser who lands one account would
 * otherwise clear the floor's count by signing in as the account they just took.
 * That was a side effect of the delete; it is not reproduced here.
 */
async function countRecentFailures(
  db: AuthDb,
  email: string,
  ip: string | null,
  since: Date,
): Promise<{ byEmail: number; byIp: number }> {
  const lastSuccess = await db.loginAttempt.findFirst({
    where: { email, succeeded: true, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })

  // THE LATER OF THE TWO BOUNDS. The window still applies — a success older
  // than the window cannot extend the counting backwards past it.
  const from =
    lastSuccess !== null && lastSuccess.createdAt > since
      ? lastSuccess.createdAt
      : since

  const [byEmail, byIp] = await Promise.all([
    db.loginAttempt.count({
      // `gt`, NOT `gte`: the success row itself is not a failure, and a bound of
      // `gte` on its own timestamp would include any failure written in the same
      // millisecond — which is the ordering nobody can reason about.
      where: { email, succeeded: false, createdAt: { gt: from } },
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
    // THE LOCALE COMES BACK WITH THE CREDENTIAL CHECK, in this query, because
    // §7.5.1 forbids anything fallible after the cookie is set. The action used
    // to read it in a SECOND query AFTER `createSession` and
    // `setSessionCookie`: a dropped socket there threw, the form showed nothing,
    // and the person was signed in anyway — one defect producing two complaints
    // that sounded unrelated. One column on a query that already runs.
    select: {
      id: true,
      passwordHash: true,
      isActive: true,
      locale: true,
    },
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

  // THE LOCALE TRAVELS WITH THE RESULT so the caller needs no second read. See
  // the `select` above.
  return { ok: true, locale: user.locale, ...issued }
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

/** The bound on a display name. Long enough for any real one, short enough
 * that the topbar truncates rather than the database refusing. */
export const MAX_NAME_LENGTH = 120

export type SetOwnNameOutcome =
  | { ok: true; name: string }
  | { ok: false; reason: 'empty' | 'too_long' | 'no_user' }

/**
 * Change your own display name.
 *
 * ── WHY THIS EXISTS, WHICH IS NOT "PROFILES ARE NICE" ──────────────────────
 *
 * Production, read 2026-09-06: four of five users were called `Owner`,
 * `Dispatch`, `Accounting` and `Disptach` — job labels rather than people, one
 * of them a typo of a job label. The owner's own row said `Owner`, straight
 * from `prisma/seed.ts`.
 *
 * They had been wrong since the day each account was made, and NOBODY COULD
 * HAVE FIXED THEM: no screen displayed a name, and no screen edited one. They
 * surfaced the moment the topbar started showing the name instead of a
 * hardcoded "OW", and the first thing it showed was "Owner".
 *
 * A FACT NOBODY RENDERS IS A FACT NOBODY CORRECTS. That is the whole reason
 * this is a field rather than a migration: these are real people's names and
 * only they know what they should say. Rewriting them centrally would be
 * guessing, twice — once about the name and once about who it belongs to.
 *
 * NO VALIDATION BEYOND LENGTH. A name is not an identifier here; it is what a
 * person calls themselves, and every rule beyond "not blank" is a rule about
 * whose names count as names. `User.email` remains the identity.
 *
 * OUTSIDE RLS, like every other `User` write, and emphatically NOT
 * `user:update` — that permission is about administering OTHER people. See
 * `src/lib/auth-db.ts`.
 */
export async function setOwnName(
  db: AuthDb,
  userId: string,
  raw: string,
): Promise<SetOwnNameOutcome> {
  const name = raw.trim()
  if (name === '') return { ok: false, reason: 'empty' }
  if (name.length > MAX_NAME_LENGTH) return { ok: false, reason: 'too_long' }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { isActive: true },
  })
  if (!user?.isActive) return { ok: false, reason: 'no_user' }

  await db.user.update({ where: { id: userId }, data: { name } })
  return { ok: true, name }
}
