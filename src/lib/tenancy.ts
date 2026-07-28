import { prisma } from './db'
import type { Prisma, PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE TENANT BOUNDARY, APPLICATION SIDE
//
// The wall itself is in Postgres: every table carrying an organizationId has
// row-level security enabled and forced, with a policy comparing that column
// to `app.current_org_id`. See the rls_and_isolation migration.
//
// This file does exactly one thing — set that variable, for the duration of
// one transaction, from a value the session vouched for. Nothing here decides
// what a user may see. It decides which tenant the database believes it is
// talking to, and Postgres does the rest.
// ---------------------------------------------------------------------------

/** A Prisma client scoped to an open transaction: no nested `$transaction`. */
export type TxClient = Prisma.TransactionClient

/**
 * Anything that can open an interactive transaction — the request-scoped
 * client in the application, a directly constructed one in tests and scripts.
 */
type TransactionCapable = Pick<PrismaClient, '$transaction'>

/**
 * cuid v1, as emitted by `@default(cuid())`: a leading `c` and 24 more
 * lowercase alphanumerics.
 *
 * The regex is not the safety mechanism — `set_config` below is parameterised,
 * so the value never reaches the SQL text. It is here to catch a caller
 * threading through something that is not an organization id at all, which is
 * a bug worth failing on rather than quietly returning an empty screen.
 */
const CUID_V1 = /^c[a-z0-9]{24}$/

export class InvalidOrgIdError extends Error {
  constructor(received: unknown) {
    super(
      `Not an organization id: ${JSON.stringify(received)}. This value must ` +
        'come from the session, never from a request parameter or body.',
    )
    this.name = 'InvalidOrgIdError'
  }
}

export function assertOrgId(orgId: unknown): asserts orgId is string {
  if (typeof orgId !== 'string' || !CUID_V1.test(orgId)) {
    throw new InvalidOrgIdError(orgId)
  }
}

export interface OrgTransactionOptions {
  /**
   * Prisma aborts an interactive transaction after 5 seconds by default, and
   * the abort surfaces as an opaque "expired transaction" error rather than as
   * a slow query. Work that legitimately runs long — generating a settlement
   * across a pay period, invoicing a batch of loads — has to say so, out loud,
   * at the call site.
   */
  timeoutMs?: number
  /** How long to wait for a connection from the pool before giving up. */
  maxWaitMs?: number
}

/**
 * Run `fn` inside one interactive transaction with `app.current_org_id` set to
 * `orgId`, so that every statement it issues is filtered by row-level
 * security to that organization.
 *
 * `set_config(name, value, is_local => true)` is `SET LOCAL` in function form.
 * Transaction-scoped is the whole point: connections are pooled, and a setting
 * that outlived its transaction would hand one request's tenant to the next.
 * Unlike `SET LOCAL` it takes a bind parameter, so the id is never
 * concatenated into SQL.
 *
 * Interactive transactions are also why this application uses the Neon
 * WebSocket driver. The HTTP driver cannot hold a session across statements,
 * so the setting and the query would land on different connections and the
 * query would see nothing.
 */
export async function runInOrg<T>(
  client: TransactionCapable,
  orgId: string,
  fn: (tx: TxClient) => Promise<T>,
  options: OrgTransactionOptions = {},
): Promise<T> {
  assertOrgId(orgId)

  return client.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_org_id', ${orgId}, true)`
      return fn(tx)
    },
    {
      ...(options.timeoutMs === undefined
        ? {}
        : { timeout: options.timeoutMs }),
      ...(options.maxWaitMs === undefined
        ? {}
        : { maxWait: options.maxWaitMs }),
    },
  )
}

/**
 * `runInOrg` against the request-scoped client. This is what routes and server
 * actions call; `orgId` comes from the session and from nowhere else.
 */
export function withOrg<T>(
  orgId: string,
  fn: (tx: TxClient) => Promise<T>,
  options: OrgTransactionOptions = {},
): Promise<T> {
  return runInOrg(prisma, orgId, fn, options)
}

// ---------------------------------------------------------------------------
// COMPANY SCOPING — A DIFFERENT THING, DELIBERATELY
//
// The operating authority is a business filter, not a security boundary. Its
// failure mode is a user seeing their own other carrier's loads; the org
// boundary's failure mode is a data breach. Keeping them in separate
// mechanisms is what stops the second from being weakened to make the first
// convenient.
//
// An empty scope list means every authority in the organization. Populated,
// it restricts.
// ---------------------------------------------------------------------------

export type CompanyScopeFilter = { companyId?: { in: string[] } }

export function companyScopeFilter(
  companyScopes: readonly string[],
): CompanyScopeFilter {
  return companyScopes.length === 0
    ? {}
    : { companyId: { in: [...companyScopes] } }
}

/**
 * Whether a membership may act on one specific authority. An empty scope list
 * is unrestricted, matching `companyScopeFilter`.
 */
export function isCompanyInScope(
  companyScopes: readonly string[],
  companyId: string,
): boolean {
  return companyScopes.length === 0 || companyScopes.includes(companyId)
}
