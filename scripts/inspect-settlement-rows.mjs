import { neonConfig, Pool } from '@neondatabase/serverless'

// ---------------------------------------------------------------------------
// IS THERE ANYTHING IN THE PHASE 3 SETTLEMENT TABLES?
//
// ── THE QUESTION BEHIND THE QUESTION ─────────────────────────────────────
//
// MONEY-DESIGN item 3 asks for a batch settlement: `SettlementBatch` over a
// Sunday-Saturday week, `Settlement` per driver beneath it, and two line tables
// in place of the one that exists. `Settlement` and `SettlementLine` ALREADY
// EXIST, from Phase 3, with a per-driver flow, a screen and a PDF route.
//
// Which shape the migration takes depends entirely on what is in them. Rows a
// person generated and approved are money somebody was paid; rows that were
// never created are a table nobody will miss. Those two facts license very
// different migrations, and guessing between them is how a schema change
// becomes a money incident.
//
// So this asks, rather than reasoning from the code. Counts by status, the
// oldest and newest, and the same for the tables item 3 builds on — the pay
// rules, opening balances, recurring deductions and charges — because a batch
// that cannot find a pay rule BLOCKS by ruling, and knowing whether any exist
// decides whether the live path can be walked on production at all.
//
// IT ONLY ASKS. Every statement is a SELECT and the fence in
// tests/prod-url-guard.test.ts holds it to that by name.
//
//   node -r dotenv/config scripts/inspect-settlement-rows.mjs
//   ZEBRA_TARGET=dev node -r dotenv/config scripts/inspect-settlement-rows.mjs
// ---------------------------------------------------------------------------

const dev = process.env.ZEBRA_TARGET === 'dev'
const connectionString = dev
  ? process.env.DIRECT_DATABASE_URL
  : process.env.PROD_DIRECT_DATABASE_URL

if (!connectionString) {
  console.error(
    dev
      ? 'DIRECT_DATABASE_URL is not set.'
      : 'PROD_DIRECT_DATABASE_URL is not set.',
  )
  process.exit(1)
}

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false
const pool = new Pool({ connectionString, max: 1 })
const rows = async (text, values = []) => (await pool.query(text, values)).rows

console.log(`Target: ${dev ? 'dev' : 'PRODUCTION'}\n`)

// ── the tables item 3 would change ────────────────────────────────────────
const [settlements] = await rows(`
  SELECT COUNT(*)::int AS n,
         COUNT(*) FILTER (WHERE "deletedAt" IS NULL)::int AS live,
         COALESCE(MIN("createdAt")::text, '—') AS first,
         COALESCE(MAX("createdAt")::text, '—') AS last
    FROM "Settlement"
`)
console.log(
  `Settlement          ${String(settlements.n).padStart(5)} rows (${String(settlements.live)} live)  ${settlements.first} .. ${settlements.last}`,
)

if (settlements.n > 0) {
  const byStatus = await rows(`
    SELECT status::text AS status, COUNT(*)::int AS n,
           COALESCE(SUM("netCents"), 0)::bigint AS cents
      FROM "Settlement" GROUP BY status ORDER BY status
  `)
  for (const row of byStatus) {
    console.log(
      `  ${row.status.padEnd(10)} ${String(row.n).padStart(4)}  net $${(Number(row.cents) / 100).toFixed(2)}`,
    )
  }
}

const [lines] = await rows(`SELECT COUNT(*)::int AS n FROM "SettlementLine"`)
console.log(`SettlementLine      ${String(lines.n).padStart(5)} rows`)

// ── the tables item 3 reads ───────────────────────────────────────────────
//
// A batch BLOCKS on a driver with settleable loads and no pay rule effective
// in the period, so how many rules exist decides what a live run would do.
const inputs = [
  ['DriverPayRule', '"DriverPayRule"'],
  ['DriverOpeningBalance', '"DriverOpeningBalance"'],
  ['RecurringDeduction', '"RecurringDeduction"'],
  ['SettlementCharge', '"SettlementCharge"'],
  ['Driver', '"Driver"'],
]
console.log('\nWhat a batch would read:')
for (const [label, table] of inputs) {
  const [hit] = await rows(`SELECT COUNT(*)::int AS n FROM ${table}`)
  console.log(`  ${label.padEnd(22)} ${String(hit.n).padStart(5)}`)
}

// DRIVERS WITH A RULE VERSUS DRIVERS WITHOUT, because the second set is the
// set that would block a batch by name.
const [cover] = await rows(`
  SELECT COUNT(*) FILTER (WHERE r.n > 0)::int AS with_rule,
         COUNT(*) FILTER (WHERE r.n = 0)::int AS without_rule
    FROM "Driver" d
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS n FROM "DriverPayRule" p WHERE p."driverId" = d.id
    ) r ON true
   WHERE d."deletedAt" IS NULL
`)
console.log(
  `\nLive drivers with a pay rule: ${cover.with_rule}   without: ${cover.without_rule}`,
)

// ── and the counter, because SB- and ST- draw from one series ─────────────
const counters = await rows(`
  SELECT c.key, c.value, co.name AS company
    FROM "Counter" c
    JOIN "Company" co ON co.id = c."companyId"
   ORDER BY co.name, c.key
`)
console.log(`\nCounter rows: ${counters.length}`)
for (const row of counters) {
  console.log(`  ${String(row.company).padEnd(28)} ${row.key} = ${row.value}`)
}

await pool.end()
