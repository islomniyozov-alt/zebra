import { readFileSync, readdirSync, writeFileSync } from 'node:fs'

// ---------------------------------------------------------------------------
// CODE MUST NOT SHIP AHEAD OF SCHEMA.
//
// Phase 3 step 2 shipped `directSettled` to production before the column
// existed there. Nothing broke, and that is the whole problem: `deploy:prod`
// ships code, not schema, and the window between the two was silent. It closed
// only because no production request had reached the ready-to-invoice path yet.
//
// This lists migrations that exist locally and are not recorded as applied to
// production, and refuses the deploy until somebody says out loud that they
// have been applied.
//
// TWO SOURCES OF TRUTH, IN ORDER OF HONESTY:
//
//   1. PROD_DIRECT_DATABASE_URL, when it is set — `_prisma_migrations` on the
//      production branch is the only authority that cannot be stale.
//   2. prisma/production-migrations.json otherwise — a recorded marker,
//      updated by whoever ran the migration. It CAN go stale, and the file
//      says who recorded it and whether it was verified, so a reader knows
//      which kind of claim they are looking at.
//
// The fallback is not a compromise for its own sake: the production connection
// string deliberately does not live on the machine that deploys, and inventing
// a reason to keep it there would be a worse trade than a recorded marker.
// ---------------------------------------------------------------------------

const MARKER = 'prisma/production-migrations.json'

/** A lone backslash, built rather than escaped — see AGENTS.md on instruments. */
const BACKSLASH = String.fromCharCode(92)

export function localMigrations() {
  return readdirSync('prisma/migrations')
    .filter((entry) => /^\d{14}_/.test(entry))
    .sort()
}

export function readMarker() {
  try {
    return JSON.parse(readFileSync(MARKER, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Migrations present locally and not applied to production.
 *
 * `applied` is a list of names, from either source. Comparing sets rather than
 * "everything after the last one" — a migration inserted out of order by a
 * merge would slip through a high-water mark and not through this.
 */
export function migrationGap(local, applied) {
  const seen = new Set(applied)
  return local.filter((name) => !seen.has(name))
}

async function appliedFromDatabase(url) {
  const { neonConfig, Pool } = await import('@neondatabase/serverless')
  neonConfig.webSocketConstructor ??= WebSocket
  neonConfig.poolQueryViaFetch = false
  const pool = new Pool({ connectionString: url })
  try {
    const { rows } = await pool.query(
      'select migration_name from _prisma_migrations where finished_at is not null',
    )
    return rows.map((row) => row.migration_name)
  } finally {
    await pool.end()
  }
}

/**
 * Compare the migrations on disk against those applied to a database.
 *
 * ---------------------------------------------------------------------------
 * IT TAKES THE URL RATHER THAN FINDING ONE, and that is the fix.
 *
 * This used to reach for `process.env.PROD_DIRECT_DATABASE_URL` itself, which
 * meant only ONE database could ever be verified. Production got a live check
 * against `_prisma_migrations`; dev got nothing at all, so `deploy:dev` shipped
 * code onto whatever schema happened to be there. On 2026-08-20 that was
 * current — verified by a `migrate status` run BY HAND because somebody
 * thought to ask, which is not a check, it is a habit.
 *
 * `label` is what the refusal calls the target. A message that says PRODUCTION
 * while refusing a dev deploy sends somebody to migrate the wrong database.
 * ---------------------------------------------------------------------------
 */
export async function check({
  confirmed = false,
  url = process.env.PROD_DIRECT_DATABASE_URL,
  label = 'production',
} = {}) {
  const local = localMigrations()
  // THE NUMBER THE PRODUCTION GATE EXPECTS. `prisma/production-gate.ts` counts
  // the timestamped directories; `localMigrations()` has already filtered to
  // exactly those, so its length is the same arithmetic on the same listing.
  const localCount = local.length

  let applied
  let source
  if (url) {
    applied = await appliedFromDatabase(url)
    source = `${label} database`
  } else if (label !== 'production') {
    // NO MARKER FOR DEV, DELIBERATELY. The marker exists because the
    // production connection string is not meant to live on this machine; the
    // dev one is right there in `.env`. A dev check with no URL is a
    // misconfiguration, not a fallback, and inventing a second marker file
    // would give it somewhere comfortable to hide.
    console.log(`migrations: ${local.length} local, ${label} not checked`)
    console.log(`            no ${label} URL available — nothing verified`)
    return { ok: true, gap: [], checked: false }
  } else {
    const marker = readMarker()
    applied = marker?.applied ?? []
    source = marker
      ? `${MARKER} (recorded ${marker.recordedAt}${marker.verified ? '' : ', UNVERIFIED'})`
      : `${MARKER} — missing`
  }

  const gap = migrationGap(local, applied)

  console.log(`migrations: ${local.length} local, ${applied.length} applied`)
  console.log(`            source: ${source}`)

  if (gap.length === 0) {
    console.log('            no gap — code and schema agree')
    return { ok: true, gap }
  }

  console.log('')
  console.log('  ' + '='.repeat(68))
  console.log(`  NOT APPLIED TO ${label.toUpperCase()}:`)
  for (const name of gap) console.log(`    ${name}`)
  console.log('')
  console.log('  Code that reads a column the database does not have fails on')
  console.log('  the first request that touches it, not at deploy. Migrate')
  console.log('  first:')
  console.log('')

  // THE REMEDIATION DEPENDS ON THE TARGET, and printing the wrong one is worse
  // than printing none. The production ritual sets ALLOW_PROD_MIGRATION to THE
  // MIGRATION NUMBER (owner's ruling 2026-10-05 — `=1` is refused by the gate
  // as a value that stays true forever) and a production DIRECT_DATABASE_URL;
  // showing that to somebody whose DEV
  // schema is behind hands them a loaded gun to fix a paper cut — and the
  // first version of the dev check did exactly that, because the text was
  // written when only production could ever reach it.
  if (label === 'production') {
    console.log('    NEON_BRANCH=production NODE_ENV=production ' + BACKSLASH)
    // THE NUMBER THE GATE WILL ACCEPT, not a placeholder: it is the ordinal of
    // the newest migration directory, which this script has already listed.
    // On 2026-10-06 this line still said `=1` and the gate had been refusing
    // `=1` for a day — a refusal that tells somebody to type the thing it
    // will refuse next is a loop with a human in it.
    console.log(
      `      ALLOW_PROD_MIGRATION=${localCount} DIRECT_DATABASE_URL=<direct url> ` +
        BACKSLASH,
    )
    console.log('      npx prisma migrate deploy')
    console.log('')
    // THE INSTRUCTION ABOVE IS HOW THE INCIDENT HAPPENED. As a one-shot prefix
    // it is safe; `export`ed — or run in a shell that keeps it — the NEXT
    // command inherits a production `DIRECT_DATABASE_URL`, and the next command
    // is `deploy:prod`, whose gate then wrote its fixtures to production.
    //
    // `deploy.mjs` scrubs those three variables before the gate runs, so this
    // warning is belt and braces. It stays, because a ritual that leaves a
    // loaded gun on the table should say so out loud.
    console.log('  A ONE-SHOT PREFIX, NEVER `export`. Those variables must not')
    console.log('  outlive that single command — then deploy from a fresh')
    console.log('  terminal. See the README: "If a test run ever points at')
    console.log('  production".')
    console.log('')
    console.log(
      '  Then record it:  node scripts/check-migration-gap.mjs --record',
    )
    console.log('  Or, if this deploy genuinely needs no schema:')
    console.log('    npm run deploy:prod -- --migrations-applied')
  } else {
    // Dev's connection string is already in `.env`; there is no ritual, no
    // marker to record, and nothing to be careful about.
    console.log('    npx prisma migrate deploy')
    console.log('')
    console.log('  Dev reads its URL from `.env`, so no prefix is needed —')
    console.log('  and there is no marker to record afterwards.')
    console.log('  Or, if this deploy genuinely needs no schema:')
    console.log('    npm run deploy:dev -- --migrations-applied')
  }
  console.log('  ' + '='.repeat(68))

  return { ok: confirmed, gap }
}

/**
 * Record what PRODUCTION says it has applied. Run AFTER `prisma migrate deploy`.
 *
 * ---------------------------------------------------------------------------
 * IT READS PRODUCTION OR IT WRITES NOTHING. Flag 106, and the cardinal
 * instrument rule with the baseline written to disk.
 *
 * This used to be:
 *
 *     const local = localMigrations()
 *     const verified = Boolean(process.env.PROD_DIRECT_DATABASE_URL)
 *
 * — the local `prisma/migrations/` listing, saved into a file named
 * `production-migrations.json` under the key `applied`, having never asked
 * production anything. The marker asserted that production holds whatever this
 * checkout holds, which is the belief the marker exists to check.
 *
 * AND `verified` MEASURED A CREDENTIAL, NOT A READ. `Boolean(url)` is true when
 * the string is merely PRESENT in the environment. The run that exposed this
 * happened to be in a window without it, so it wrote `verified: false` and was
 * honest by accident; with the variable in scope the same code would have
 * stamped `verified: true` over a list it had read from a directory.
 *
 * So the list now comes from `appliedFromDatabase` — the same query `check`
 * runs — and there is no path that writes without it.
 * ---------------------------------------------------------------------------
 */
async function record() {
  const url = process.env.PROD_DIRECT_DATABASE_URL
  if (!url) {
    console.error('REFUSING TO RECORD: no PROD_DIRECT_DATABASE_URL.')
    console.error('')
    console.error('  This file is a claim about production, so it is written')
    console.error('  from production or not at all. Without the URL the only')
    console.error('  list available is this checkout’s own migrations')
    console.error('  folder, which is the belief the marker exists to test.')
    console.error('')
    console.error('  Re-run with the production URL as a ONE-SHOT prefix:')
    console.error('')
    console.error(
      '    PROD_DIRECT_DATABASE_URL=<direct url> ' +
        BACKSLASH +
        '\n      node scripts/check-migration-gap.mjs --record',
    )
    console.error('')
    console.error('  Never `export`. The next command must not inherit it.')
    return false
  }

  // SORTED BEFORE WRITING. `_prisma_migrations` returns rows in whatever order
  // the query planner likes, and the previous implementation was accidentally
  // stable because a directory listing is sorted. Writing production's raw row
  // order re-shuffles all 32 lines on every record, so a real change — one
  // migration appearing — would arrive buried in a diff nobody reads.
  // `migrationGap` compares sets, so order is presentation only.
  const applied = (await appliedFromDatabase(url)).sort()
  const local = localMigrations()
  const gap = migrationGap(local, applied)

  writeFileSync(
    MARKER,
    `${JSON.stringify(
      {
        // PRODUCTION'S list, not this machine's. Not a high-water mark either:
        // the full set, so a migration inserted out of order by a merge cannot
        // hide behind a later timestamp.
        applied,
        recordedAt: new Date().toISOString().slice(0, 10),
        // Now derived from the read having HAPPENED — this line is only
        // reached after `appliedFromDatabase` returned. A `false` in this file
        // can therefore only have come from the old code, which is worth
        // knowing when reading an older marker.
        verified: true,
      },
      null,
      2,
    )}\n`,
  )

  console.log(
    `recorded ${applied.length} migrations, read from the production database`,
  )

  // SAID OUT LOUD RATHER THAN LEFT TO THE NEXT RUN. Recording is honest even
  // when production is behind — the marker describes production, and the gap
  // is recomputed on every check — but somebody who just ran a migration and
  // is told nothing will assume it landed.
  if (gap.length > 0) {
    console.log('')
    console.log(
      `  NOTE: production is still missing ${gap.length} migration(s) that`,
    )
    console.log('  exist locally. The marker is correct; the migration is not')
    console.log('  finished:')
    for (const name of gap) console.log(`    ${name}`)
  }
  return true
}

if (
  process.argv[1] &&
  import.meta.url ===
    new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href
) {
  if (process.argv.includes('--record')) {
    // EXIT CODE FOLLOWS THE REFUSAL. A record step that silently does nothing
    // and returns 0 is how a stale marker outlives the migration it was meant
    // to describe.
    process.exit((await record()) ? 0 : 1)
  } else {
    const result = await check({
      confirmed: process.argv.includes('--migrations-applied'),
    })
    process.exit(result.ok ? 0 : 1)
  }
}
