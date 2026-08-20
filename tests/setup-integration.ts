import { withDatabase, workerDatabase } from './worker-db'

// ---------------------------------------------------------------------------
// PER-WORKER ROUTING, AND IT BELONGS TO THE INTEGRATION PROJECT ALONE.
//
// This used to live in `tests/setup.ts`, which the NODE project also loads —
// so `integrity.test.ts` and `structure.test.ts` were pointed at
// `zebra_w<slot>` too. They did not fail. They passed, because a worker
// database is a fresh copy of the template: no loads, no invoices, no
// payments, and therefore no drift to find. The integrity backstop was
// answering "is anything inconsistent?" about an empty database and cheerfully
// saying no.
//
// IT SURFACED ONLY BY LUCK. `npm run check` was green immediately after the
// change because a previous integration run had left eight worker databases
// behind. A later run at two workers deleted six of them, and the next check
// asked for `zebra_w5` and got "does not exist" — a loud error standing in for
// a silent wrong answer that had already been reported as proof.
//
// So the routing is its own setup file, listed FIRST in the integration
// project's setupFiles and nowhere else. Order matters: `tests/setup.ts` calls
// `assertSafeDbTarget` on whatever the environment holds by then.
// ---------------------------------------------------------------------------

/**
 * Set so the shared setup can tell a legitimate worker database from a leak.
 *
 * A marker rather than a guess: the shared file cannot see which project it is
 * running under, and inferring it from `VITEST_POOL_ID` would infer wrong —
 * every project sets that.
 */
process.env.ZEBRA_INTEGRATION_WORKER = '1'

// `VITEST_POOL_ID` is the pool SLOT — 1..maxWorkers, reused as files are handed
// to a worker — which is exactly the key a per-worker resource needs. Measured
// rather than assumed: four files across three workers produced pool ids
// 1, 2, 3, 3 under four distinct pids. `VITEST_WORKER_ID` increments globally
// (0, 1, 2, 3) and would have minted a database per FILE.
//
// ONLY THE DATABASE NAME CHANGES. The role, the endpoint and the pooled/direct
// split are all untouched, which is what keeps `src/lib/db.ts`'s guard
// meaningful — the app's URL still authenticates as zebra_app.
//
// NOT A `SET search_path` OR ANY OTHER SESSION STATE. Neon's pooled endpoint is
// transaction-mode, so session-level settings are not reliably still yours on
// the next statement; the database is chosen when the connection is made, and
// there is nothing to lose hold of.
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
// `tests/setup.ts` prints the database this process ASKED for. When
// `ZEBRA_DB_PROBE` names a file, each test file also records what the server
// says it actually reached — the only version of the claim worth anything, and
// the only way to compare several workers in one run, since a single test file
// only ever occupies one of them.
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
    `pool=${process.env.VITEST_POOL_ID} pid=${process.pid} server_says=${row.rows[0].db} user=${row.rows[0].usr}\n`,
  )
  await probe.end()
}
