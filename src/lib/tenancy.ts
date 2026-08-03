import { prisma } from './db'
import {
  auditScope,
  flushAuditBuffer,
  type AuditCapableTx,
  type AuditScope,
  type WriteAttribution,
} from './audit'
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

export interface TransactionTimeouts {
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

export interface OrgTransactionOptions extends TransactionTimeouts {
  /**
   * Who is doing this, for the audit trail. REQUIRED, and required on purpose.
   *
   * An optional field here was the same shape of bug as the lazy-promise one:
   * correct-looking code, quiet wrong outcome, invisible until someone went
   * looking. Forgetting it produced writes that committed perfectly and were
   * attributed to nobody, and nothing complained.
   *
   * There is still an escape hatch — `unattributed('why')` — but it has to be
   * typed out, it carries its reason into the log, and it is greppable. An
   * audit gap is now a decision, not an oversight.
   *
   * Application routes never write this by hand; `withCurrentOrg` supplies it
   * from the session.
   */
  attribution: WriteAttribution
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
  options: OrgTransactionOptions,
): Promise<T> {
  assertOrgId(orgId)

  return client.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_org_id', ${orgId}, true)`
      // The audit extension is handed the operation but not the client
      // running it, and Prisma will not let a query extension be applied to a
      // transaction client. Async context is how it finds both.
      //
      // The `await` is load-bearing and cost an hour. A PrismaPromise is lazy:
      // `tx.load.update(...)` builds a thenable and executes nothing until it
      // is awaited. Returning `fn(tx)` unawaited ends the async context before
      // the query — and therefore before the extension — ever runs, so the
      // most natural call style in the codebase,
      //
      //     withOrg(orgId, (tx) => tx.load.update({ ... }))
      //
      // would have written no audit row at all, silently, while every test
      // that awaited inside its callback passed.
      const scope: AuditScope = {
        tx: tx as unknown as AuditCapableTx,
        organizationId: orgId,
        attribution: options.attribution,
        buffer: [],
      }

      return await auditScope.run(scope, async () => {
        const result = await fn(tx)
        // Every audit row for this transaction, in one insert behind one
        // savepoint, while the transaction is STILL OPEN. Inside, because a
        // rolled-back write must not leave a row claiming it happened; before
        // the return, because after it there is no transaction left to write
        // in. See `AuditScope.buffer` for the measurement that put it here.
        await flushAuditBuffer(scope)
        return result
      })
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
  options: OrgTransactionOptions,
): Promise<T> {
  return runInOrg(prisma, orgId, fn, options)
}

/**
 * Run `fn` in a transaction that declares WHO is asking, rather than which
 * tenant they are acting as.
 *
 * This unlocks exactly one thing: the `own_membership` policy on Membership
 * and MembershipCompany, which is how login discovers the organizations a user
 * belongs to before it can possibly know which one to scope to. It is FOR
 * SELECT only, so this grants reading and never writing.
 *
 * Not a general-purpose escape hatch. If a query needs tenant data, it belongs
 * in `runInOrg`.
 */
export async function runAsUser<T>(
  client: TransactionCapable,
  userId: string,
  fn: (tx: TxClient) => Promise<T>,
  options: TransactionTimeouts = {},
): Promise<T> {
  assertUserId(userId)

  return client.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`
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

export class InvalidUserIdError extends Error {
  constructor(received: unknown) {
    super(`Not a user id: ${JSON.stringify(received)}.`)
    this.name = 'InvalidUserIdError'
  }
}

export function assertUserId(userId: unknown): asserts userId is string {
  if (typeof userId !== 'string' || !CUID_V1.test(userId)) {
    throw new InvalidUserIdError(userId)
  }
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

/**
 * For any model that BELONGS to an authority — Load, Truck, Driver, Trailer.
 *
 * NOT for `Company` itself: that table's key is `id`, and a `companyId` on it
 * does not exist. Use `companyIdScopeFilter` there. The two are separated
 * because spreading the wrong one is invisible — see the note on it.
 */
export function companyScopeFilter(
  companyScopes: readonly string[],
): CompanyScopeFilter {
  return companyScopes.length === 0
    ? {}
    : { companyId: { in: [...companyScopes] } }
}

export type CompanyIdScopeFilter = { id?: { in: string[] } }

/**
 * The same restriction, expressed against `Company` itself.
 *
 * THIS EXISTS BECAUSE THE OTHER ONE WAS SPREAD INTO A COMPANY QUERY ON SEVEN
 * SCREENS AND NOTHING NOTICED. `{ companyId: { in: [...] } }` is not a valid
 * `CompanyWhereInput`, so Prisma throws at RUNTIME — and TypeScript never
 * objects, because excess-property checking does not apply to a spread into a
 * `where`. It compiles, it passes every test, and then it 500s for the first
 * person whose membership is restricted to one authority.
 *
 * An owner has an empty scope list, so both helpers return `{}` and the fault
 * is invisible to whoever is building the screen. It surfaced when a
 * dispatcher scoped to a single carrier clicked Add load.
 */
export function companyIdScopeFilter(
  companyScopes: readonly string[],
): CompanyIdScopeFilter {
  return companyScopes.length === 0 ? {} : { id: { in: [...companyScopes] } }
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
