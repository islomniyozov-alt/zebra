import { neonConfig, Pool } from '@neondatabase/serverless'

// ---------------------------------------------------------------------------
// MAIL NOBODY CLAIMS, WHERE A HUMAN WILL SEE IT.
//
// `UnroutedEmail` closed the hole where a delivered message existed nowhere.
// It did not close the next one: the row lands in a table NO ROUTE READS,
// announced by a `console.warn` in a log nobody is tailing. A black box
// recorder nobody opens after the crash (brief flag 67).
//
// SO THE COUNT RIDES ALONG WITH `npm run check`, which runs constantly.
//
// SILENT AT ZERO, which is the entire design. A line that prints "0 unrouted"
// every time teaches the eye to skip the whole block, and the one week it says
// 3 it will be skipped too. It speaks only when there is something to say.
//
// INFORMATIONAL, AND IT EXITS 0 EVEN WHEN IT SHOUTS — the same rule
// `check-deploy-drift.mjs` follows and for the same reason: unrouted mail is a
// thing to look at, not a broken build, and a gate that fails on a
// non-failure is a gate people learn to skip.
//
// QUIET WITHOUT A CONNECTION, AND QUIET ON NETWORK FAILURE. No production URL
// configured, no opinion. `npm run check` must work on a plane.
//
// WHY IT READS PRODUCTION AND NOT DEV: dev's unrouted rows are fixtures and
// noise. The mail that matters arrived at a real address from a real stranger,
// and it only ever arrives in production.
//
// THIS IS THE SECOND READER OF `PROD_DIRECT_DATABASE_URL`, and the owner's
// ruling said that variable is read by `check-migration-gap.mjs` and nothing
// else. That ruling was made before this script existed and the two collide;
// the collision is flagged in the brief rather than resolved by pretending it
// was covered. `tests/prod-url-guard.test.ts` allowlists exactly these two
// files BY NAME, so a third reader is a named test failure rather than a
// habit. This connection is READ-ONLY: one SELECT, no writes, ever.
// ---------------------------------------------------------------------------

const url = process.env.PROD_DIRECT_DATABASE_URL

if (!url) {
  // Not configured is not a fault. The README's parked section explains how to
  // set it, and until then this script has nothing to look at.
  process.exit(0)
}

neonConfig.poolQueryViaFetch = false
const pool = new Pool({ connectionString: url })

try {
  const { rows } = await pool.query(`
    SELECT count(*)::int AS unrouted,
           min("receivedAt") AS oldest
      FROM "UnroutedEmail"
  `)

  const count = rows[0]?.unrouted ?? 0

  if (count > 0) {
    const oldest = rows[0]?.oldest
    const printed = oldest ? new Date(oldest).toISOString().slice(0, 10) : '?'
    console.log('')
    console.log(`  ${'='.repeat(68)}`)
    console.log(
      `  ${count} UNROUTED MESSAGE${count === 1 ? '' : 'S'} in production, oldest ${printed}.`,
    )
    console.log('')
    console.log('  Mail delivered to an address no organization claims. It was')
    console.log('  kept — row and original — but nothing shows it to anybody.')
    console.log('')
    console.log('  Usually this means `Organization.inboundAddress` and the')
    console.log('  address the mail arrived at have drifted apart.')
    console.log(`  ${'='.repeat(68)}`)
    console.log('')
  }
} catch {
  // A missing table, an unreachable database, an expired password: none of
  // them are this script's business to fail on. See the header.
} finally {
  await pool.end().catch(() => {})
}

process.exit(0)
