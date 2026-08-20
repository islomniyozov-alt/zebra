import { neonConfig, Pool } from '@neondatabase/serverless'
import {
  GRANT_AUDIT_SQL,
  describeGrantDifferences,
  findGrantDifferences,
} from '../src/lib/grant-rule.ts'

// ---------------------------------------------------------------------------
// THE SAME GRANT RULE, ASKED OF PRODUCTION.
//
// FLAG 81: the schema is version-controlled and the grants are not. Two
// databases can pass every other check in this repository while disagreeing
// about who may read what, and until now nothing compared them. On 2026-08-20
// a probe with a non-public `search_path` granted `zebra_app` on
// `public._prisma_migrations` in dev; it was caught by luck, because one test
// happened to assert on that exact table and that exact privilege.
//
// ONE RULE, TWO CALLERS. `src/lib/grant-rule.ts` derives what every table
// should carry from `20260728224900_rls_and_isolation` — four verbs on every
// application table, none on the bookkeeping — and two callers ask two
// databases the same question with it. `tests/structure.test.ts` runs it
// against dev inside `npm run check`. This runs it against production, because
// `PROD_DIRECT_DATABASE_URL` may not be read from the test suite: the fence in
// `tests/prod-url-guard.test.ts` is an allowlist of files by name, and adding
// a reader is meant to be a decision somebody makes on purpose. This is that
// decision, made on purpose, and recorded here.
//
// READ-ONLY, and held to the stricter half of the fence's rule: this runs
// unattended inside `npm run check`, so it may only SELECT. There is no code
// path here that writes anything, and `prod-url-guard.test.ts` asserts that by
// scanning this file for mutating keywords.
//
// QUIET WHEN IT AGREES, QUIET WHEN IT CANNOT ASK, LOUD WHEN IT DISAGREES —
// the same posture as `check:unrouted`. No production URL configured means no
// opinion; `npm run check` must work on a plane. An unreachable database is a
// network fact rather than a finding. A grant that differs from the migration
// is neither, and it says so.
//
// EXITS 0 ON EVERY PATH, INCLUDING THE LOUD ONE. It runs constantly during
// development, and a check that fails the build on a condition somebody may
// have created deliberately at 2am is a check people learn to skip. The
// loudness is the mechanism; `structure.test.ts` is what actually fails, and
// it fails on dev.
// ---------------------------------------------------------------------------

const url = process.env.PROD_DIRECT_DATABASE_URL
if (!url) process.exit(0)

neonConfig.poolQueryViaFetch = false

let rows = []
const pool = new Pool({ connectionString: url, max: 1 })
try {
  const result = await pool.query(GRANT_AUDIT_SQL)
  rows = result.rows
} catch {
  // Unreachable is not a finding.
  await pool.end().catch(() => {})
  process.exit(0)
} finally {
  await pool.end().catch(() => {})
}

// AN EMPTY ANSWER SATISFIES "NO DIFFERENCES" PERFECTLY, which is the shape of
// wrongness this repository has been bitten by twice. A production database
// with no tables is not a production database.
if (rows.length === 0) process.exit(0)

const differences = findGrantDifferences(rows)
if (differences.length === 0) process.exit(0)

console.log('')
console.log('  ' + '='.repeat(70))
console.log('  PRODUCTION GRANTS DIFFER FROM WHAT THE MIGRATION ESTABLISHED.')
console.log('')
console.log(describeGrantDifferences(differences))
console.log('')
console.log('  Nothing else here can see a change made outside a migration —')
console.log('  check:drift compares commits, and a GRANT leaves no commit.')
console.log('  ' + '='.repeat(70))
console.log('')
