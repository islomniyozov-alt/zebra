// DRIVER-TYPE GAPS — the drivers migration 70 could not seed from the export,
// listed for GAPS.md.
//
//   node -r dotenv/config scripts/driver-type-gaps.mjs            (dev)
//   node -r dotenv/config scripts/driver-type-gaps.mjs --target=production
//
// Owner's ruling 2026-10-06: `driverType` is seeded from the Datatruck export's
// own `Driver Type` column where the export knows the driver, from the old
// `employmentType` only where it does not, "and lists the rest in GAPS". This
// is the list. THE EXPORT'S ID LIST IS READ BACK OUT OF THE MIGRATION FILE —
// the one place it is committed — so there is one source and this cannot
// disagree with what 70 did.
//
// Read-only — BEGIN TRANSACTION READ ONLY, then ROLLBACK. On the production
// fence as an inspection reader: it holds the production string only through
// --target, and it has no statement that writes.
import { readFileSync } from 'node:fs'
import { neonConfig, Pool } from '@neondatabase/serverless'

neonConfig.webSocketConstructor ??= WebSocket

const target = process.argv.includes('--target=production')
  ? 'production'
  : 'dev'
const url =
  target === 'production'
    ? process.env.PROD_DIRECT_DATABASE_URL
    : process.env.DIRECT_DATABASE_URL
if (!url) {
  console.error(
    target === 'production'
      ? 'PROD_DIRECT_DATABASE_URL is not set. Run this from a shell that holds it for one command.'
      : 'DIRECT_DATABASE_URL is not set.',
  )
  process.exit(1)
}

const migration = readFileSync(
  'prisma/migrations/20261006180000_migration_70/migration.sql',
  'utf8',
)
const known = new Set(
  [
    ...migration.matchAll(
      /^\s+\('(\d+)', '(?:COMPANY_DRIVER|OWNER_OPERATOR)'\)/gm,
    ),
  ].map((m) => m[1]),
)
if (known.size === 0) {
  console.error('could not read the export id list out of migration 70')
  process.exit(1)
}

const pool = new Pool({ connectionString: url })
try {
  await pool.query('BEGIN TRANSACTION READ ONLY')
  const { rows } = await pool.query(`
    SELECT d."externalId", d."firstName", d."lastName", d."driverType"::text AS "driverType",
           d."status"::text AS status, c."name" AS authority
      FROM "Driver" d JOIN "Company" c ON c."id" = d."companyId"
     WHERE d."deletedAt" IS NULL
     ORDER BY d."lastName", d."firstName"`)
  await pool.query('ROLLBACK')
  const unknown = rows.filter(
    (row) => !row.externalId || !known.has(row.externalId),
  )
  console.log(
    `driver-type gaps on ${target}: ${unknown.length} of ${rows.length} driver(s) the export does not know (${known.size} ids in migration 70)`,
  )
  for (const row of unknown) {
    console.log(
      `  ${`${row.firstName} ${row.lastName}`.padEnd(30)} id=${String(row.externalId ?? 'none').padEnd(6)} ${row.driverType.padEnd(15)} ${row.status.padEnd(10)} ${row.authority}`,
    )
  }
  console.log(
    `DRIVER-TYPE GAPS ON ${target.toUpperCase()}: ${unknown.length} — ${unknown.length === 0 ? 'OK' : 'LIST THEM'}.`,
  )
} finally {
  await pool.end()
}
