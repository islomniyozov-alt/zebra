import { neonConfig, Pool } from '@neondatabase/serverless'

// ---------------------------------------------------------------------------
// WHY DOES THE TUESDAY SCREEN SAY THAT?
//
// Three readings reported off production on 2026-09-11:
//
//   1. Midwest Global shows 17 not-ready to file, and it is a retired
//      authority whose freight is meant to be closed history.
//   2. Dolphins gets the no-remittance warning and RAM Haulage does not,
//      though RAM is the Amazon carrier.
//   3. The ready section reads $0.00 where it should say why.
//
// Each is a claim about what the screen's queries return, and each can be
// answered from the rows rather than from the code. This asks the same
// questions the page asks, in SQL, so the answer and the screen can be
// compared instead of one being used to explain the other.
//
// IT ONLY ASKS. Every statement is a SELECT and the fence in
// tests/prod-url-guard.test.ts holds it to that by name.
//
//   node -r dotenv/config scripts/inspect-money-screen.mjs
//   ZEBRA_TARGET=dev node -r dotenv/config scripts/inspect-money-screen.mjs
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

// ── 1. what the factoring counts read ─────────────────────────────────────
//
// `filingStatesForCompanies`, in words: every load of the company that is not
// deleted, not cancelled, whose customer does NOT settle directly, and whose
// billingStatus is not CLOSED_IN_DATATRUCK. Readiness is then decided per load
// from its documents and whether an invoice covers it.
console.log('── 1. loads the factoring section would count, per company')
const factoring = await rows(`
  SELECT c.name,
         COUNT(*)::int AS all_loads,
         COUNT(*) FILTER (WHERE l."billingStatus"::text = 'CLOSED_IN_DATATRUCK')::int AS closed,
         COUNT(*) FILTER (WHERE cu."settlesDirectly")::int AS direct,
         COUNT(*) FILTER (
           WHERE l."deletedAt" IS NULL
             AND l."isCancelled" = false
             AND cu."settlesDirectly" = false
             AND l."billingStatus"::text <> 'CLOSED_IN_DATATRUCK'
         )::int AS counted
    FROM "Load" l
    JOIN "Company" c ON c.id = l."companyId"
    JOIN "Customer" cu ON cu.id = l."customerId"
   GROUP BY c.name
   ORDER BY c.name
`)
console.log(
  '   company                        loads   closed  direct  COUNTED by factoring',
)
for (const row of factoring) {
  console.log(
    `   ${row.name.padEnd(28)} ${String(row.all_loads).padStart(6)} ${String(row.closed).padStart(8)} ${String(row.direct).padStart(7)} ${String(row.counted).padStart(9)}`,
  )
}

// And for anything the factoring section still counts, WHAT STATUS IS IT IN —
// because "every load is closed history" and "17 not ready" cannot both be
// true, and the statuses say which.
console.log('\n   the counted ones, by billing status:')
const statuses = await rows(`
  SELECT c.name, l."billingStatus"::text AS status, COUNT(*)::int AS n
    FROM "Load" l
    JOIN "Company" c ON c.id = l."companyId"
    JOIN "Customer" cu ON cu.id = l."customerId"
   WHERE l."deletedAt" IS NULL
     AND l."isCancelled" = false
     AND cu."settlesDirectly" = false
     AND l."billingStatus"::text <> 'CLOSED_IN_DATATRUCK'
   GROUP BY c.name, l."billingStatus"
   ORDER BY c.name, n DESC
`)
for (const row of statuses) {
  console.log(
    `   ${row.name.padEnd(28)} ${row.status.padEnd(22)} ${String(row.n).padStart(5)}`,
  )
}

// ── 2. what "mix" reads ───────────────────────────────────────────────────
//
// One grouped count: loads of the company, not deleted, whose customer settles
// directly. NOTE WHAT IT DOES NOT SAY — nothing about the period, and nothing
// about closed history. A company whose Amazon freight is entirely historical
// still counts as having direct-settled freight, and so still gets a
// remittance row for a week it will never have a remittance for.
console.log('\n── 2. direct-settled freight per company (what "mix" reads)')
const mix = await rows(`
  SELECT c.name,
         COUNT(*)::int AS direct_all,
         COUNT(*) FILTER (WHERE l."billingStatus"::text <> 'CLOSED_IN_DATATRUCK')::int AS direct_live,
         MAX(s."scheduledAt")::text AS newest_delivery
    FROM "Load" l
    JOIN "Company" c ON c.id = l."companyId"
    JOIN "Customer" cu ON cu.id = l."customerId"
    LEFT JOIN LATERAL (
      SELECT MAX("scheduledAt") AS "scheduledAt"
        FROM "LoadStop" WHERE "loadId" = l.id AND type::text = 'DELIVERY'
    ) s ON true
   WHERE l."deletedAt" IS NULL AND cu."settlesDirectly" = true
   GROUP BY c.name
   ORDER BY c.name
`)
console.log('   company                        direct  live  newest delivery')
for (const row of mix) {
  console.log(
    `   ${row.name.padEnd(28)} ${String(row.direct_all).padStart(6)} ${String(row.direct_live).padStart(5)}  ${row.newest_delivery ?? '—'}`,
  )
}

console.log('\n   customers that settle directly:')
const directCustomers = await rows(`
  SELECT cu.name, COUNT(l.id)::int AS loads
    FROM "Customer" cu
    LEFT JOIN "Load" l ON l."customerId" = cu.id AND l."deletedAt" IS NULL
   WHERE cu."deletedAt" IS NULL AND cu."settlesDirectly" = true
   GROUP BY cu.name ORDER BY cu.name
`)
for (const row of directCustomers) {
  console.log(`   ${row.name.padEnd(34)} ${String(row.loads).padStart(6)}`)
}

// ── 3. what the ready section would find for the period in question ───────
console.log(
  '\n── 3. the period the screen is about, and what is settleable in it',
)
const [period] = await rows(`
  SELECT (date_trunc('week', now() AT TIME ZONE 'UTC' + interval '1 day')::date
          - interval '1 day' - interval '7 days')::date AS start
`)
const start = period.start.toISOString().slice(0, 10)
console.log(`   period start (Sunday, two weeks back): ${start}`)

const ready = await rows(
  `
  SELECT c.name,
         COUNT(*)::int AS delivered_in_period,
         COUNT(*) FILTER (WHERE l."billingStatus"::text = 'CLOSED_IN_DATATRUCK')::int AS closed,
         COUNT(*) FILTER (
           WHERE l."deletedAt" IS NULL AND l."isCancelled" = false
             AND l."billingStatus"::text <> 'CLOSED_IN_DATATRUCK'
             AND l."driverId" IS NOT NULL
         )::int AS settleable
    FROM "Load" l
    JOIN "Company" c ON c.id = l."companyId"
   WHERE EXISTS (
     SELECT 1 FROM "LoadStop" s
      WHERE s."loadId" = l.id AND s.type::text = 'DELIVERY'
        AND s."scheduledAt" >= $1::timestamptz
        AND s."scheduledAt" < ($1::timestamptz + interval '7 days')
   )
   GROUP BY c.name ORDER BY c.name
`,
  [start],
)
console.log('   company                        delivered  closed  SETTLEABLE')
if (ready.length === 0) console.log('   (no deliveries in that period at all)')
for (const row of ready) {
  console.log(
    `   ${row.name.padEnd(28)} ${String(row.delivered_in_period).padStart(9)} ${String(row.closed).padStart(7)} ${String(row.settleable).padStart(11)}`,
  )
}

// ── 4. the 17, hunted ─────────────────────────────────────────────────────
//
// The screen reported 17 not-ready on Midwest Global; the count above says the
// factoring section can see exactly one of its loads. Both cannot be true, so
// this asks what a 17 could be made of — every non-direct load of that
// authority, by status and cancellation, with nothing filtered out.
console.log('')
console.log('── 4. Midwest Global: every non-direct load, nothing filtered')
for (const row of await rows(`
  SELECT l."billingStatus"::text AS status, l."isCancelled" AS cancelled,
         (l."deletedAt" IS NOT NULL) AS deleted, COUNT(*)::int AS n
    FROM "Load" l
    JOIN "Company" c ON c.id = l."companyId"
    JOIN "Customer" cu ON cu.id = l."customerId"
   WHERE c.name LIKE 'Midwest%' AND cu."settlesDirectly" = false
   GROUP BY 1, 2, 3 ORDER BY n DESC
`)) {
  console.log(
    `   ${row.status.padEnd(24)} cancelled=${String(row.cancelled).padEnd(5)} deleted=${String(row.deleted).padEnd(5)} ${String(row.n).padStart(5)}`,
  )
}

// ── 5. where the remittances actually landed ──────────────────────────────
//
// The no-remittance warning appears on a company that HAS direct-settled
// freight and no matching payment. Which company each remittance was imported
// against decides which one gets warned.
console.log('')
console.log('── 5. remittance payments, by company and declared period')
for (const row of await rows(`
  SELECT c.name, p."remittanceKey",
         p."periodStart"::date::text AS ps,
         p."receivedAt"::date::text AS received
    FROM "Payment" p
    JOIN "Company" c ON c.id = p."companyId"
   WHERE p."remittanceKey" IS NOT NULL AND p."deletedAt" IS NULL
   ORDER BY p."receivedAt" DESC LIMIT 12
`)) {
  console.log(
    `   ${row.name.padEnd(24)} ${String(row.remittanceKey).slice(0, 18).padEnd(20)} period=${row.ps ?? '(none)'}  received=${row.received}`,
  )
}
const [remits] = await rows(
  `SELECT COUNT(*)::int AS n FROM "Payment" WHERE "remittanceKey" IS NOT NULL AND "deletedAt" IS NULL`,
)
console.log(`   total remittance payments: ${remits.n}`)

// ── 6. which companies the screen lists at all ────────────────────────────
console.log('')
console.log('── 6. active companies (the screen lists exactly these)')
for (const row of await rows(
  `SELECT name, "isActive" FROM "Company" ORDER BY name`,
)) {
  console.log(`   ${row.name.padEnd(34)} active=${row.isActive}`)
}

await pool.end()
