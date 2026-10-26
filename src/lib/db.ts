import { AsyncLocalStorage } from 'node:async_hooks'
import { cache } from 'react'
import { neonConfig } from '@neondatabase/serverless'
import { PrismaNeon } from '@prisma/adapter-neon'
import { PrismaPg } from '@prisma/adapter-pg'
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
export function createPrismaClient(
  connectionString: string,
  driver: 'neon' | 'hyperdrive' = 'neon',
): PrismaClient {
  // Idempotent, and the only place guaranteed to run before an audited write
  // in every runtime we have. See src/lib/audit-sink.ts — a missing binding is
  // a no-op, so this is free under Node and in tests.
  ensureAuditSink()

  const pool = {
    connectionString,
    // THE FLOOR UNDER `after()` (GAPS 31). The pool's default is 10 s, and a
    // pool nobody closed kept its idle socket open that long after the
    // response — OpenNext's `ctx.waitUntil` held the invocation until it
    // dropped: ~10 s of Worker wall on every request, measured. Where no
    // request scope exists to end the client, this is how long it lingers.
    idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
  }
  const client = new PrismaClient({
    // THE CONNECTION PATH (§6.10, GAPS 33). Hyperdrive speaks plain Postgres
    // over TCP, so its path is `pg` (Workers sockets under nodejs_compat);
    // everywhere else — production, tests, seeds — Neon's WebSocket driver.
    // Above the adapter nothing differs: interactive transactions, SET LOCAL,
    // row-level security, the audit extension.
    adapter:
      driver === 'hyperdrive' ? new PrismaPg(pool) : new PrismaNeon(pool),
  })
  return client.$extends(auditExtension) as unknown as PrismaClient
}

/**
 * The Worker's Hyperdrive connection string, or null (§6.10, GAPS 33).
 *
 * THE SWITCH IS THE BINDING. `HYPERDRIVE` is declared at the top of
 * `wrangler.jsonc` — the dev worker; the `production` environment does not
 * inherit bindings — so production, tests and scripts get null and the Neon
 * path. Rollback is removing the binding. Read through OpenNext's context
 * symbol, as `audit-sink.ts` reads its dataset, so nothing here imports a
 * build tool at runtime.
 */
export function hyperdriveConnectionString(
  scope: object = globalThis,
): string | null {
  const context = (scope as Record<symbol, unknown>)[
    Symbol.for('__cloudflare-context__')
  ]
  const env =
    context && typeof context === 'object'
      ? (context as { env?: unknown }).env
      : null
  const binding =
    env && typeof env === 'object'
      ? (env as Record<string, unknown>)['HYPERDRIVE']
      : null
  const value =
    binding && typeof binding === 'object'
      ? (binding as { connectionString?: unknown }).connectionString
      : null
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * The request's client, on whichever path this Worker is bound to. The one
 * place a per-request client is built (GAPS 32's grep-proof).
 */
function createRequestPrismaClient(): PrismaClient {
  const hyperdrive = hyperdriveConnectionString()
  return hyperdrive
    ? createPrismaClient(requireHyperdriveString(hyperdrive), 'hyperdrive')
    : createPrismaClient(appConnectionString())
}

/**
 * The Hyperdrive binding's string, and nothing else, on the Hyperdrive path
 * (§6.10, corrected 2026-10-23).
 *
 * THE STRING DOES NOT NAME THE ROLE. Hyperdrive hands the Worker its own
 * generated user and password at a `*.hyperdrive.local` host; the origin's
 * user — `zebra_app` — is in the config Cloudflare holds. `requireAppRole`
 * applied here refused every request on the first three Hyperdrive sweeps:
 * a 500 in 10–35 ms, six of six sign-ins. So this accepts a Hyperdrive host
 * and refuses the two things that would mean the binding is not what §6.10
 * says: a Neon URL pasted in, or any string naming the owner role. The role
 * is READ BACK from the config by the sweep before it starts (origin user
 * `zebra_app`, caching disabled), which is the check the string cannot make.
 */
export function requireHyperdriveString(connectionString: string): string {
  let url: URL
  try {
    url = new URL(connectionString)
  } catch {
    throw new Error('The HYPERDRIVE binding did not provide a connection URL.')
  }
  if (!url.hostname.endsWith('.hyperdrive.local')) {
    throw new Error(
      'The HYPERDRIVE binding does not point at a Hyperdrive host. The pg ' +
        'path takes only the binding’s own string; a database URL belongs in ' +
        'DATABASE_URL, where the zebra_app check applies.',
    )
  }
  if (/owner/i.test(url.username)) {
    throw new Error(
      'The HYPERDRIVE binding names an owner role. The origin must be ' +
        'zebra_app: the owner bypasses row-level security.',
    )
  }
  return connectionString
}

/**
 * How long an idle pooled connection is kept before it closes (GAPS 31).
 *
 * 5,000, NOT 1,000 (owner's ruling, 2026-10-13). At 1 s the pool closed
 * connections DURING a request — the sign-in's closing writes run two queries
 * in parallel after the ~1 s argon2 gap, and the second connection had been
 * closed and was reopened: 232 → 845 ms median. `after()` is what ends the
 * pool; this only bounds a client nothing ended.
 */
export const POOL_IDLE_TIMEOUT_MS = 5_000

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

/**
 * Fail loudly rather than quietly running the app with a role that bypasses
 * every policy. See the note in .env — the owner carries BYPASSRLS. For
 * `DATABASE_URL`, the Neon path. The Hyperdrive string cannot carry the role
 * (`requireHyperdriveString`); its origin user is read back from the config.
 */
export function requireAppRole(connectionString: string): string {
  if (!connectionString.includes('zebra_app')) {
    throw new Error(
      'The database connection does not authenticate as zebra_app. The ' +
        'application must never connect as the database owner: the owner ' +
        'bypasses row-level security, so every tenant boundary would silently ' +
        'disappear.',
    )
  }
  return connectionString
}

function appConnectionString(): string {
  const connectionString = process.env.DATABASE_URL

  if (!connectionString) {
    throw new Error('DATABASE_URL is not set.')
  }

  return requireAppRole(connectionString)
}

const cachedClient = cache((): PrismaClient => {
  const client = createRequestPrismaClient()
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
