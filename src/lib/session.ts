import type { Prisma, PrismaClient, Role } from '@/generated/prisma/client'
import type { AuthorizedSession, PermissionOverrides } from './permissions'
import { runAsUser } from './tenancy'

// ---------------------------------------------------------------------------
// SESSIONS
//
// Rows, not JWTs. §7 is explicit and the reason is operational: when someone
// leaves, access has to end when the row dies, not when a signature expires.
//
// The cookie holds a 256-bit random token. The database holds only its
// SHA-256. Verification hashes what arrives and looks that up, so a dump of
// the Session table is a list of useless digests. This is the same reason
// passwords are not stored either.
//
// Everything here takes an explicit client. Sessions are resolved BEFORE any
// organization is known, so none of it can run inside `withOrg` — and it does
// not need to: User, Session and LoginAttempt are the three tables outside
// row-level security, precisely because authentication has to happen first.
// ---------------------------------------------------------------------------

/**
 * Anything with the model delegates this module uses.
 *
 * `$transaction` is here because reading a membership needs one: the
 * `own_membership` policy is unlocked by a transaction-scoped session
 * variable, and a setting outside a transaction would leak onto the next
 * request sharing the pooled connection.
 */
export type SessionDb = Pick<
  PrismaClient,
  'session' | 'membership' | 'user' | '$transaction'
>

export const SESSION_COOKIE = 'zebra_session'
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000 // one working day

const TOKEN_BYTES = 32

export interface SessionContext extends AuthorizedSession {
  sessionId: string
  expiresAt: Date
}

export interface IssuedSession {
  /** The only copy of the secret. Goes in the cookie and is never stored. */
  token: string
  context: SessionContext
}

export interface RequestMetadata {
  ip?: string | null
  userAgent?: string | null
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function generateSessionToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)))
}

/**
 * SHA-256 of the token, hex. Deterministic and unsalted on purpose: this is a
 * lookup key for a 256-bit random value, not a password. Salting it would make
 * it unlookupable, and stretching it would buy nothing against an input that
 * is already uniformly random.
 */
export async function hashSessionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  )
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Prisma's Json input type wants an index signature, which a closed interface
 * deliberately does not have. The shape is plain data either way — this is the
 * one place that has to say so.
 */
function toJsonInput(
  overrides: PermissionOverrides | null | undefined,
): Prisma.InputJsonValue | undefined {
  return overrides ? (overrides as unknown as Prisma.InputJsonValue) : undefined
}

function parseOverrides(value: unknown): PermissionOverrides | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const record = value as Record<string, unknown>
  const list = (key: string): string[] | undefined => {
    const raw = record[key]
    return Array.isArray(raw)
      ? raw.filter((x): x is string => typeof x === 'string')
      : undefined
  }
  const grant = list('grant')
  const revoke = list('revoke')
  if (!grant && !revoke) return null
  return {
    ...(grant ? { grant: grant as PermissionOverrides['grant'] } : {}),
    ...(revoke ? { revoke: revoke as PermissionOverrides['revoke'] } : {}),
  }
}

/**
 * Which organization, role and authorities a user acts with.
 *
 * Resolved here, at login, and frozen onto the session (§7). Reading it per
 * request is not an option: Membership is behind row-level security, and
 * knowing which organization to unlock is the very thing being looked up.
 */
export async function resolveMembership(
  db: SessionDb,
  userId: string,
  organizationId?: string,
): Promise<{
  organizationId: string
  role: Role
  companyScopes: string[]
  permissionOverrides: PermissionOverrides | null
} | null> {
  // Membership is behind row-level security, and this is the query that
  // decides which tenant the request belongs to — so it runs under
  // `app.current_user_id` rather than `app.current_org_id`. See runAsUser and
  // the own_membership policy.
  const memberships = await runAsUser(db, userId, (tx) =>
    tx.membership.findMany({
      where: { userId, ...(organizationId ? { organizationId } : {}) },
      include: { companyScopes: { select: { companyId: true } } },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    }),
  )

  const membership = memberships[0]
  if (!membership) return null

  return {
    organizationId: membership.organizationId,
    role: membership.role,
    companyScopes: membership.companyScopes.map((scope) => scope.companyId),
    permissionOverrides: parseOverrides(membership.permissionOverrides),
  }
}

export async function createSession(
  db: SessionDb,
  userId: string,
  context: {
    organizationId: string
    role: Role
    companyScopes: string[]
    permissionOverrides?: PermissionOverrides | null
  },
  metadata: RequestMetadata = {},
): Promise<IssuedSession> {
  const token = generateSessionToken()
  const tokenHash = await hashSessionToken(token)
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)

  const session = await db.session.create({
    data: {
      userId,
      tokenHash,
      activeOrganizationId: context.organizationId,
      role: context.role,
      companyScopes: context.companyScopes,
      permissionOverrides: toJsonInput(context.permissionOverrides),
      expiresAt,
      ip: metadata.ip ?? null,
      userAgent: metadata.userAgent ?? null,
    },
    select: { id: true },
  })

  return {
    token,
    context: {
      sessionId: session.id,
      userId,
      organizationId: context.organizationId,
      role: context.role,
      companyScopes: context.companyScopes,
      permissionOverrides: context.permissionOverrides ?? null,
      expiresAt,
    },
  }
}

/**
 * Resolve a token to a session, or null.
 *
 * Null for every reason: no such session, expired, revoked, or the user has
 * since been deactivated. The caller cannot tell which, and does not need to.
 */
export async function resolveSession(
  db: SessionDb,
  token: string | null | undefined,
): Promise<SessionContext | null> {
  if (!token) return null

  const session = await db.session.findUnique({
    where: { tokenHash: await hashSessionToken(token) },
    select: {
      id: true,
      userId: true,
      activeOrganizationId: true,
      role: true,
      companyScopes: true,
      permissionOverrides: true,
      expiresAt: true,
      revokedAt: true,
      user: { select: { isActive: true } },
    },
  })

  if (!session) return null
  if (session.revokedAt !== null) return null
  if (session.expiresAt.getTime() <= Date.now()) return null
  if (!session.user.isActive) return null

  return {
    sessionId: session.id,
    userId: session.userId,
    organizationId: session.activeOrganizationId,
    role: session.role,
    companyScopes: session.companyScopes,
    permissionOverrides: parseOverrides(session.permissionOverrides),
    expiresAt: session.expiresAt,
  }
}

/** Revoke one session. Idempotent: revoking an unknown token is not an error. */
export async function revokeSession(
  db: SessionDb,
  token: string | null | undefined,
): Promise<void> {
  if (!token) return
  await db.session.updateMany({
    where: { tokenHash: await hashSessionToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

export async function revokeSessionById(
  db: SessionDb,
  sessionId: string,
): Promise<void> {
  await db.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

/**
 * Revoke every session a user holds. What a password change, a role removal or
 * a "sign out everywhere" does.
 */
export async function revokeAllSessionsForUser(
  db: SessionDb,
  userId: string,
  options: { exceptSessionId?: string } = {},
): Promise<number> {
  const { count } = await db.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(options.exceptSessionId
        ? { id: { not: options.exceptSessionId } }
        : {}),
    },
    data: { revokedAt: new Date() },
  })
  return count
}

/**
 * Push the current membership onto a user's live sessions (§7: "refreshed on
 * membership change").
 *
 * Sessions whose membership has disappeared are revoked instead — a removed
 * member should not keep working until their session happens to expire.
 */
export async function refreshSessionsForUser(
  db: SessionDb,
  userId: string,
  organizationId: string,
): Promise<{ refreshed: number; revoked: number }> {
  const membership = await resolveMembership(db, userId, organizationId)

  if (!membership) {
    const { count } = await db.session.updateMany({
      where: { userId, activeOrganizationId: organizationId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    return { refreshed: 0, revoked: count }
  }

  const { count } = await db.session.updateMany({
    where: { userId, activeOrganizationId: organizationId, revokedAt: null },
    data: {
      role: membership.role,
      companyScopes: membership.companyScopes,
      permissionOverrides: toJsonInput(membership.permissionOverrides),
    },
  })
  return { refreshed: count, revoked: 0 }
}

/** Housekeeping. Rows that are revoked or long expired have no further use. */
export async function purgeDeadSessions(
  db: SessionDb,
  olderThan: Date = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
): Promise<number> {
  const { count } = await db.session.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: olderThan } }, { revokedAt: { lt: olderThan } }],
    },
  })
  return count
}
