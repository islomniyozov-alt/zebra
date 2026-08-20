import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { neonConfig } from '@neondatabase/serverless'
import { assertSafeDbTarget } from './db-target'

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
// WHICH DATABASE, ASSERTED BY NAME RATHER THAN BY EXCLUSION.
//
// The first version of this refused a database matching `zebra_w<n>`, which
// only catches the misrouting somebody already thought of. The lesson of
// zebra_w5 is the opposite one: the dangerous misrouting is the one nobody
// anticipated, and a rule written against a known-bad name is silent for every
// other destination — a template, a copy, a colleague's branch, an empty
// database with the right shape and no rows.
//
// So this states what the database MUST be. The integration project supplies
// its own expectation because it legitimately runs somewhere else; everything
// else must be on the shared dev database named in `.env`.
const database = new URL(
  process.env.DIRECT_DATABASE_URL ?? 'postgres://x/y',
).pathname.slice(1)

/**
 * The database `.env` names — read from the FILE, not from `process.env`.
 *
 * Independence is the whole point. `tests/setup-integration.ts` rewrites the
 * environment variable, so comparing the variable against itself would agree
 * with any value it had been given, including a wrong one. `.env` on disk is
 * the thing that cannot have been rewritten by a setup file.
 */
const expected = (() => {
  const line = /^\s*DIRECT_DATABASE_URL\s*=\s*(.*)$/m.exec(
    readFileSync('.env', 'utf8'),
  )
  const raw = line?.[1]?.trim().replace(/^["']|["']$/g, '')
  return raw ? new URL(raw).pathname.slice(1) : ''
})()

if (process.env.ZEBRA_INTEGRATION_WORKER) {
  // The integration project routes to its own database and says so. Its own
  // expectation is asserted in tests/integration/worker-isolation.test.ts,
  // against the SERVER's answer rather than against this string.
  if (!/^zebra_w\d+$/.test(database)) {
    throw new Error(
      `The integration project is on "${database}", which is not a per-worker ` +
        'database. tests/setup-integration.ts did not route this process, so ' +
        'these tests would share one database and interfere with each other.',
    )
  }
} else if (database !== expected) {
  throw new Error(
    `This project is pointed at "${database}" but belongs on "${expected}".
` +
      'Only the integration project may run anywhere else. A database with ' +
      'the right shape and no rows passes almost every assertion in this ' +
      'repository — see integrity.test.ts, which reported no drift while ' +
      'connected to an empty copy of the template.',
  )
}

const endpoint = assertSafeDbTarget(process.env)
console.log(`[integration] writing to ${endpoint} db=${database}`)
