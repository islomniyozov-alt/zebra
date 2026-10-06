// RATE-SPLIT GAPS — the loads migration 68 could not backfill, listed for GAPS.md.
//
//   node -r dotenv/config scripts/rate-split-gaps.mjs            (dev)
//   node -r dotenv/config scripts/rate-split-gaps.mjs --target=production
//
// §7.6 (owner's ruling 2026-10-06): the rate field is the line haul; migration
// 68 gives every hand-created load whose rate con carries an AGREEING split its
// split, and "loads without one are listed in GAPS, not guessed." This is the
// list. Read-only — BEGIN TRANSACTION READ ONLY, then ROLLBACK — and it prints
// what it finds; it changes nothing on either branch.
//
// Three kinds of row, each named for what a person has to do:
//   NO_LINEHAUL     the rate con printed a total and no line haul — somebody
//                   reads the paper and types the split;
//   DISAGREES       the extraction's parts do not add up to its total — the
//                   document is wrong or the read was, and a person decides;
//   STILL_TOTAL     stored line haul equals the extraction total AFTER 68 ran,
//                   which means 68 has not been applied here yet, or skipped
//                   the row for one of the two reasons above.
//
// On the production fence as an inspection reader: it holds the production
// string only through --target, and it has no statement that writes.
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

const SQL = `
  WITH rc AS (
    SELECT d."loadId", d."extractedJson"->'money' AS money,
           ROW_NUMBER() OVER (PARTITION BY d."loadId" ORDER BY d."uploadedAt" DESC) AS rn
      FROM "Document" d
     WHERE d."type" = 'RATE_CONFIRMATION' AND d."loadId" IS NOT NULL AND d."deletedAt" IS NULL
       AND d."extractedJson" ? 'money')
  SELECT l."loadNumber", l."referenceNumber", c."name" AS authority,
         l."linehaulCents", l."fuelSurchargeCents", l."accessorialsCents", l."totalRevenueCents",
         (rc.money->>'linehaulCents')::int AS rc_linehaul,
         (rc.money->>'fuelSurchargeCents')::int AS rc_fuel,
         (rc.money->>'totalCents')::int AS rc_total,
         rc.money->>'totalAgrees' AS agrees,
         CASE
           WHEN (rc.money->>'linehaulCents') IS NULL THEN 'NO_LINEHAUL'
           WHEN (rc.money->>'totalAgrees') IS DISTINCT FROM 'true' THEN 'DISAGREES'
           WHEN l."linehaulCents" = (rc.money->>'totalCents')::int
                AND l."linehaulCents" <> (rc.money->>'linehaulCents')::int THEN 'STILL_TOTAL'
         END AS kind
    FROM "Load" l
    JOIN rc ON rc."loadId" = l."id" AND rc.rn = 1
    JOIN "Company" c ON c."id" = l."companyId"
   WHERE l."externalId" IS NULL AND l."deletedAt" IS NULL
     AND (
       (rc.money->>'linehaulCents') IS NULL
       OR (rc.money->>'totalAgrees') IS DISTINCT FROM 'true'
       OR (l."linehaulCents" = (rc.money->>'totalCents')::int
           AND l."linehaulCents" <> (rc.money->>'linehaulCents')::int)
     )
   ORDER BY kind, l."loadNumber"
`

const pool = new Pool({ connectionString: url })
try {
  await pool.query('BEGIN TRANSACTION READ ONLY')
  const { rows } = await pool.query(SQL)
  await pool.query('ROLLBACK')
  console.log(`rate-split gaps on ${target}: ${rows.length} load(s)`)
  if (rows.length === 0) {
    console.log(
      '  none — every hand-created load with a rate con has its split.',
    )
  }
  for (const row of rows) {
    const money = (cents) => (cents === null ? '—' : (cents / 100).toFixed(2))
    console.log(
      `  ${row.kind.padEnd(12)} ${row.loadNumber.padEnd(10)} ${String(row.referenceNumber ?? '').padEnd(16)} ${row.authority.padEnd(24)} ` +
        `stored linehaul ${money(row.linehaulCents)} total ${money(row.totalRevenueCents)} · ` +
        `rate con linehaul ${money(row.rc_linehaul)} fuel ${money(row.rc_fuel)} total ${money(row.rc_total)} agrees=${row.agrees ?? 'null'}`,
    )
  }
  console.log(
    `RATE-SPLIT GAPS ON ${target.toUpperCase()}: ${rows.length} — ${rows.length === 0 ? 'OK' : 'LIST THEM'}.`,
  )
} finally {
  await pool.end()
}
