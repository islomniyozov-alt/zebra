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

async function appliedFromProduction(url) {
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

export async function check({ confirmed = false } = {}) {
  const local = localMigrations()

  let applied
  let source
  if (process.env.PROD_DIRECT_DATABASE_URL) {
    applied = await appliedFromProduction(process.env.PROD_DIRECT_DATABASE_URL)
    source = 'production database'
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
  console.log('  NOT APPLIED TO PRODUCTION:')
  for (const name of gap) console.log(`    ${name}`)
  console.log('')
  console.log('  Code that reads a column the database does not have fails on')
  console.log('  the first request that touches it, not at deploy. Migrate')
  console.log('  first:')
  console.log('')
  console.log('    NEON_BRANCH=production NODE_ENV=production \\')
  console.log(
    '      ALLOW_PROD_MIGRATION=1 DIRECT_DATABASE_URL=<direct url> \\',
  )
  console.log('      npx prisma migrate deploy')
  console.log('')
  console.log(
    '  Then record it:  node scripts/check-migration-gap.mjs --record',
  )
  console.log('  Or, if this deploy genuinely needs no schema:')
  console.log('    npm run deploy:prod -- --migrations-applied')
  console.log('  ' + '='.repeat(68))

  return { ok: confirmed, gap }
}

/** Record the local set as applied. Run AFTER `prisma migrate deploy`. */
function record() {
  const local = localMigrations()
  const verified = Boolean(process.env.PROD_DIRECT_DATABASE_URL)
  writeFileSync(
    MARKER,
    `${JSON.stringify(
      {
        // Not a high-water mark: the full list, so a migration inserted out of
        // order by a merge cannot hide behind a later timestamp.
        applied: local,
        recordedAt: new Date().toISOString().slice(0, 10),
        // Whether this was read from the production database or taken on
        // somebody's word. A reader is entitled to know which.
        verified,
      },
      null,
      2,
    )}\n`,
  )
  console.log(
    `recorded ${local.length} migrations as applied to production` +
      (verified
        ? ' (verified against the database)'
        : ' (UNVERIFIED — on report)'),
  )
}

if (
  process.argv[1] &&
  import.meta.url ===
    new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href
) {
  if (process.argv.includes('--record')) {
    record()
  } else {
    const result = await check({
      confirmed: process.argv.includes('--migrations-applied'),
    })
    process.exit(result.ok ? 0 : 1)
  }
}
