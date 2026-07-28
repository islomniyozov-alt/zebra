import { cache } from 'react'
import { neonConfig } from '@neondatabase/serverless'
import { PrismaNeon } from '@prisma/adapter-neon'
import { PrismaClient } from '@/generated/prisma/client'

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

const getClient = cache((): PrismaClient => {
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

  return new PrismaClient({ adapter: new PrismaNeon({ connectionString }) })
})

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getClient()
    const value = Reflect.get(client, property, client)
    // $transaction, $executeRaw and friends lose `this` if handed out bare.
    return typeof value === 'function' ? value.bind(client) : value
  },
})
