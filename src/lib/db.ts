import { AsyncLocalStorage } from 'node:async_hooks'
import { cache } from 'react'
import { neonConfig } from '@neondatabase/serverless'
import { PrismaNeon } from '@prisma/adapter-neon'
import { after } from 'next/server'
import { PrismaClient } from '@/generated/prisma/client'
import { auditExtension } from './audit'
import { ensureAuditSink } from './audit-sink'

// ---------------------------------------------------------------------------
// THE RUNTIME DATABASE CLIENT
//
// Three decisions here, each with a failure mode worth naming.
//
// 1. WEBSOCKET, NOT HTTP. `PrismaNeon` speaks the Postgres wire protocol over
//    a WebSocket. Its sibling `PrismaNeonHttp` cannot hold a session across
//    statements, so it cannot run an interactive transaction — and every
//    request in this application runs inside one, because that is the only
//    place `SET LOCAL app.current_org_id` is meaningful. Reaching for the HTTP
//    driver silently removes row-level security. Do not.
//
// 2. NO SINGLETON. A Cloudflare Worker may not carry an I/O object across
//    request boundaries; a module-level client works in `next dev` and throws
//    in production, which is the worst place to find out. React's `cache()`
//    gives one client per request and a fresh one for the next.
//
// 3. A PROXY, NOT A FUNCTION. `cache()` can only be called during a render or
//    request scope, so `getClient()` cannot run at module load. The proxy
//    defers that call to the first property access, which is always inside a
//    request. Call sites still read `prisma.load.findMany()`.
// ---------------------------------------------------------------------------

// workerd and Node 22+ both expose a global WebSocket. Assign rather than
// overwrite so a test harness can install its own first.
neonConfig.webSocketConstructor ??= WebSocket

// The fetch-based query path cannot hold a transaction open. Belt and braces
// against a future default flip.
neonConfig.poolQueryViaFetch = false

/**
 * Build a client against an explicit connection string.
 *
 * Use this in seeds, migrations tooling and tests — anywhere outside a
 * request. Application code wants `prisma` below.
 *
 * The audit extension is attached here rather than at the call sites, so
 * there is no such thing as a client that writes without being audited. It is
 * a query extension and adds nothing to the client's surface, hence the cast
 * back to PrismaClient — the alternative is threading an extended-client type
 * through every module that takes a database handle, for no gain.
 */
export function createPrismaClient(connectionString: string): PrismaClient {
  // Idempotent, and the only place guaranteed to run before an audited write
  // in every runtime we have. See src/lib/audit-sink.ts — a missing binding is
  // a no-op, so this is free under Node and in tests.
  ensureAuditSink()

  const client = new PrismaClient({
    adapter: new PrismaNeon({
      connectionString,
      // THE FLOOR UNDER `after()` (GAPS 31). The pool's default is 10 s, and
      // a pool nobody closed kept its idle WebSocket open that long after the
      // response — OpenNext's `ctx.waitUntil` held the invocation until it
      // dropped: ~10 s of Worker wall on every request, measured. Where no
      // request scope exists to end the client, this is how long it lingers.
      idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
    }),
  })
  return client.$extends(auditExtension) as unknown as PrismaClient
}

/** How long an idle pooled connection is kept before it closes (GAPS 31). */
export const POOL_IDLE_TIMEOUT_MS = 1_000

/**
 * End `client` when the response is finished (GAPS 31, owner's ruling
 * 2026-10-12): `after()` runs once the response is sent — OpenNext hands it
 * to `ctx.waitUntil` — and `$disconnect()` ends the adapter's pool, closing
 * its WebSockets instead of leaving them to the idle timeout.
 *
 * Outside a request (a seed, a script, a test) `after()` throws; there is
 * nothing to end the client with, and the pool's 1 s idle timeout is the
 * floor. Returns whether the end was scheduled, for the tests.
 */
export function endWithResponse(
  client: PrismaClient,
  schedule: (task: () => Promise<void>) => void = after,
): boolean {
  try {
    schedule(async () => {
      await client.$disconnect().catch(() => {})
    })
    return true
  } catch {
    return false
  }
}

function appConnectionString(): string {
  const connectionString = process.env.DATABASE_URL

  if (!connectionString) {
    throw new Error('DATABASE_URL is not set.')
  }

  // Fail loudly rather than quietly running the app with a role that bypasses
  // every policy. See the note in .env — the owner carries BYPASSRLS.
  if (!connectionString.includes('zebra_app')) {
    throw new Error(
      'DATABASE_URL does not authenticate as zebra_app. The application must ' +
        'never connect as the database owner: the owner bypasses row-level ' +
        'security, so every tenant boundary would silently disappear.',
    )
  }

  return connectionString
}

const cachedClient = cache((): PrismaClient => {
  const client = createPrismaClient(appConnectionString())
  endWithResponse(client)
  return client
})

/**
 * A scope that owns one client for its duration.
 *
 * `cache()` memoizes only inside a React request scope, and a Route Handler is
 * not obviously one — outside it, `cache()` is a passthrough and every property
 * access on `prisma` would build a client and a connection pool of its own.
 *
 * The previous note here said that was survivable because every request touches
 * `prisma` exactly once. That was true and was never going to stay true: a
 * request that reads its session and then opens a transaction already touches it
 * twice. An invariant that has to be maintained by everyone who writes a route
 * is not an invariant.
 *
 * So this does not depend on the answer. `withCurrentOrg` opens one of these
 * around the whole request; anything inside gets the same client however many
 * times it asks. Server components with no such scope fall back to `cache()`,
 * which does memoize there.
 */
const requestScope = new AsyncLocalStorage<{ client?: PrismaClient }>()

/**
 * Run `fn` with one client for the whole request.
 *
 * REUSES A SCOPE THAT IS ALREADY OPEN (GAPS 32). This used to open a fresh
 * scope on every call, so every `withCurrentOrg` built its own client — and
 * its own pool, and its own socket: a dashboard render with seven parallel
 * reads built about ten. "One client for the whole request" was the comment
 * above and not the behaviour.
 */
export function withRequestClient<T>(fn: () => Promise<T>): Promise<T> {
  return requestScope.getStore() ? fn() : requestScope.run({}, fn)
}

function getClient(): PrismaClient {
  const scope = requestScope.getStore()
  // SEEDED FROM REACT'S PER-REQUEST CLIENT (GAPS 32): inside a render,
  // `cachedClient()` is the one the session read already used, so a scope
  // opened by `withCurrentOrg` shares it instead of starting another. Outside
  // React's scope (a Route Handler) it builds one, which this scope keeps.
  if (scope) return (scope.client ??= cachedClient())
  return cachedClient()
}

/**
 * The request's client as a concrete handle, for the code that has no tenant
 * and so does not go through `withCurrentOrg`: sign-in, the viewer's own
 * account, the inbound-email store (`auth-db.ts`, `unrouted-email-store.ts`).
 * Same role, same connection string, same client as everything else in the
 * request — never a second one (GAPS 32).
 */
export function requestClient(): PrismaClient {
  return getClient()
}

/**
 * The request-scoped client.
 *
 * Reach for `createPrismaClient` rather than this in any code that is not
 * serving a request — a seed, a script, a test.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getClient()
    const value = Reflect.get(client, property, client)
    // $transaction, $executeRaw and friends lose `this` if handed out bare.
    return typeof value === 'function' ? value.bind(client) : value
  },
})
