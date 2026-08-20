import 'dotenv/config'
import { neonConfig } from '@neondatabase/serverless'
import { assertSafeDbTarget } from './db-target'
import { withDatabase, workerDatabase } from './worker-db'

// Node exposes a global WebSocket from 22 onwards, as does workerd. Matching
// src/lib/db.ts exactly: the tests must exercise the driver the app uses, not
// a more forgiving one.
neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

// WHERE THIS IS ABOUT TO WRITE, checked against the connection strings rather
// than against a label. See tests/db-target.ts for the incident that made the
// old `NEON_BRANCH === 'production'` check insufficient — it was checking a
// sticker on the box while the box was addressed somewhere else.
//
// Printed, always. The whole incident was somebody not knowing which database
// their terminal pointed at, and one line of output is the cheapest cure.
// ---------------------------------------------------------------------------
// EACH WORKER, POINTED AT ITS OWN DATABASE.
//
// `VITEST_POOL_ID` is the pool SLOT — 1..maxWorkers, reused as files are handed
// to a worker — which is exactly the key a per-worker resource needs. Measured
// rather than assumed: four files across three workers produced pool ids
// 1, 2, 3, 3 under four distinct pids. `VITEST_WORKER_ID` increments globally
// (0, 1, 2, 3) and would have minted a database per FILE.
//
// ONLY THE DATABASE NAME CHANGES. The role, the endpoint and the pooled/direct
// split are all untouched, which is what keeps `src/lib/db.ts`'s guard
// meaningful — the app's URL still authenticates as zebra_app, and a URL that
// did not would still be refused there.
//
// NOT A `SET search_path` OR ANY OTHER SESSION STATE. Neon's pooled endpoint is
// transaction-mode, so session-level settings are not reliably still yours on
// the next statement; the database is chosen when the connection is made, and
// there is nothing to lose hold of.
// ---------------------------------------------------------------------------
const poolId = process.env.VITEST_POOL_ID
if (poolId) {
  const database = workerDatabase(poolId)
  for (const key of ['DATABASE_URL', 'DIRECT_DATABASE_URL'] as const) {
    const current = process.env[key]
    if (current) process.env[key] = withDatabase(current, database)
  }
}

// AN OPT-IN, SERVER-SIDE ANSWER TO "WHICH DATABASE AM I IN".
//
// The line below prints the database this process ASKED for. When
// `ZEBRA_DB_PROBE` names a file, each test file also records what the server
// says it actually reached — which is the only version of the claim worth
// anything, and the only way to compare several workers in one run, since a
// single test file only ever occupies one of them.
//
// Off by default and free when off: no connection is opened unless asked for.
if (process.env.ZEBRA_DB_PROBE) {
  const { Pool } = await import('@neondatabase/serverless')
  const { appendFileSync } = await import('node:fs')
  const probe = new Pool({
    connectionString: process.env.DIRECT_DATABASE_URL,
    max: 1,
  })
  const row = await probe.query(
    'select current_database()::text as db, current_user::text as usr',
  )
  appendFileSync(
    process.env.ZEBRA_DB_PROBE,
    `pool=${process.env.VITEST_POOL_ID} pid=${process.pid} server_says=${row.rows[0].db} user=${row.rows[0].usr}
`,
  )
  await probe.end()
}

const endpoint = assertSafeDbTarget(process.env)
console.log(
  `[integration] writing to ${endpoint}` +
    (poolId ? ` db=${workerDatabase(poolId)}` : ''),
)
