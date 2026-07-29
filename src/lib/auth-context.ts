import 'server-only'
import { cache } from 'react'
import { cookies, headers } from 'next/headers'
import { prisma } from './db'
import { can, type Action, type Resource } from './permissions'
import { withOrg, type TransactionTimeouts, type TxClient } from './tenancy'
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  resolveSession,
  type RequestMetadata,
  type SessionContext,
} from './session'

// ---------------------------------------------------------------------------
// THE REQUEST'S SESSION
//
// The only place a session is read from a cookie, and the only place a route
// should get one. Everything below is `server-only`: importing it from a
// client component is a build error rather than a runtime surprise, which
// matters because the session carries the role and the company scopes.
//
// §7: never send data to the client and hide it. That rule starts here — the
// session object never crosses to the client, and what does cross is whatever
// a server component chose to send after asking `can`.
// ---------------------------------------------------------------------------

export class UnauthenticatedError extends Error {
  constructor() {
    super('No session.')
    this.name = 'UnauthenticatedError'
  }
}

export class ForbiddenError extends Error {
  readonly action: Action
  readonly resource: Resource

  constructor(action: Action, resource: Resource) {
    super(`Not permitted: ${resource}:${action}`)
    this.name = 'ForbiddenError'
    this.action = action
    this.resource = resource
  }
}

/** Cached per request: one session lookup however many times it is asked for. */
export const getSession = cache(async (): Promise<SessionContext | null> => {
  const store = await cookies()
  return resolveSession(prisma, store.get(SESSION_COOKIE)?.value)
})

export async function requireSession(): Promise<SessionContext> {
  const session = await getSession()
  if (!session) throw new UnauthenticatedError()
  return session
}

/**
 * The gate every route and server action calls.
 *
 * Returns the session so the caller has it in hand, which removes the reason
 * to fetch it separately and then forget to check it.
 */
export async function requirePermission(
  action: Action,
  resource: Resource,
): Promise<SessionContext> {
  const session = await requireSession()
  if (!can(session, action, resource)) {
    throw new ForbiddenError(action, resource)
  }
  return session
}

/** `can` against the current request's session. */
export async function currentUserCan(
  action: Action,
  resource: Resource,
): Promise<boolean> {
  return can(await getSession(), action, resource)
}

/**
 * The shape a route should reach for: the request's tenant, its permission
 * check, and its audit identity, all resolved together.
 *
 * Calling `withOrg` directly works and skips none of the tenancy guarantees,
 * but it also arrives with no acting user — so every write inside it is
 * recorded as an audit gap rather than an audit row. This is the version that
 * knows who is asking.
 */
export async function withCurrentOrg<T>(
  action: Action,
  resource: Resource,
  fn: (tx: TxClient) => Promise<T>,
  options: TransactionTimeouts = {},
): Promise<T> {
  const session = await requirePermission(action, resource)
  const metadata = await requestMetadata()

  return withOrg(session.organizationId, fn, {
    ...options,
    attribution: {
      userId: session.userId,
      ip: metadata.ip ?? null,
      userAgent: metadata.userAgent ?? null,
    },
  })
}

export async function requestMetadata(): Promise<RequestMetadata> {
  const list = await headers()
  return {
    // Cloudflare sets CF-Connecting-IP on every request it proxies, and
    // unlike X-Forwarded-For it cannot be spoofed by the client.
    ip:
      list.get('cf-connecting-ip') ??
      list.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      null,
    userAgent: list.get('user-agent'),
  }
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    // No JS can read it, no cross-site request carries it, and it never
    // travels in the clear off localhost.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  })
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
}
