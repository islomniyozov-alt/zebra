import { neonConfig, Pool } from '@neondatabase/serverless'

// ---------------------------------------------------------------------------
// HOW MUCH FREIGHT IS FINISHED, BILLABLE, AND ATTACHED TO NOBODY?
//
// A load at POD_RECEIVED with no driver is freight that will never appear on a
// settlement. `settleableWhere(driverId, …)` filters on `driverId` as an
// equality, so a null driver matches NO driver's query — the load is not
// refused, it is simply never found. Nobody is paid and nothing says so.
//
// Load 1015 is one. Every direct-settled import since Delivered began firing
// the POD automatically could be another, because that path never looks at
// assignment. This counts them BEFORE `isReady` learns to check, so the
// reclassification lands on a known number rather than a surprise.
//
// IT ASKS, AND ONLY ASKS. Every statement here is a SELECT; the fence in
// tests/prod-url-guard.test.ts holds it to that by name. If something needs
// changing, the owner runs it — this prints and stops.
//
//   node -r dotenv/config scripts/inspect-unassigned-pod.mjs            # prod
//   ZEBRA_TARGET=dev node -r dotenv/config scripts/inspect-unassigned-pod.mjs
// ---------------------------------------------------------------------------

const dev = process.env.ZEBRA_TARGET === 'dev'
const connectionString = dev
  ? process.env.DIRECT_DATABASE_URL
  : process.env.PROD_DIRECT_DATABASE_URL

if (!connectionString) {
  console.error(
    dev
      ? 'No DIRECT_DATABASE_URL in the environment.'
      : 'No PROD_DIRECT_DATABASE_URL in the environment. Nothing to ask.',
  )
  process.exit(1)
}

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false
const pool = new Pool({ connectionString, max: 1 })
const rows = async (text, values = []) => (await pool.query(text, values)).rows

try {
  console.log(`Reading ${dev ? 'DEV' : 'PRODUCTION'}.`)

  // THE WHOLE POPULATION FIRST, so the affected count has a denominator. A
  // bare "9 loads" is a number nobody can size.
  const [totals] = await rows(`
    select
      count(*)::int                                                as pod_received,
      count(*) filter (where "driverId" is null)::int              as no_driver,
      count(*) filter (where "truckId" is null)::int               as no_truck,
      count(*) filter (where "driverId" is null or "truckId" is null)::int as either_missing,
      count(*) filter (where "driverId" is null and "totalRevenueCents" > 0)::int as no_driver_with_money
    from "Load"
    where "deletedAt" is null
      and "isCancelled" = false
      and "operationalStatus" = 'POD_RECEIVED'
  `)
  console.log('\nAt POD_RECEIVED, not cancelled, not deleted:')
  console.table(totals)

  // THE ONES THAT WOULD RECLASSIFY. `isReady` today is POD_RECEIVED plus
  // revenue; adding assignment moves exactly these off READY_TO_INVOICE.
  const [reclass] = await rows(`
    select count(*)::int as would_reclassify
    from "Load"
    where "deletedAt" is null
      and "isCancelled" = false
      and "operationalStatus" = 'POD_RECEIVED'
      and "totalRevenueCents" > 0
      and ("driverId" is null or "truckId" is null)
      and "billingStatus" in ('READY_TO_INVOICE')
  `)
  console.log('\nWould change billingStatus when isReady learns to check:')
  console.table(reclass)

  // AND WHETHER THE MONEY HAS ALREADY MOVED ON ANY OF THEM, which decides
  // whether this is a display problem or a paid-wrong problem.
  const settled = await rows(`
    select l."loadNumber", l."directSettled", l."totalRevenueCents",
           count(sl.id)::int as settlement_lines
    from "Load" l
    left join "SettlementLine" sl on sl."loadId" = l.id
    where l."deletedAt" is null
      and l."isCancelled" = false
      and l."operationalStatus" = 'POD_RECEIVED'
      and l."driverId" is null
    group by l.id, l."loadNumber", l."directSettled", l."totalRevenueCents"
    order by l."loadNumber"
    limit 50
  `)
  console.log(`\nDriverless POD loads (first ${settled.length}):`)
  console.table(settled)

  const paid = settled.filter((row) => row.settlement_lines > 0)
  console.log(
    paid.length === 0
      ? '\nNone of them is on a settlement — consistent with the accidental gate.'
      : `\n${paid.length} ARE on a settlement, which the driverId filter should have made impossible. Bring this to the owner.`,
  )
} finally {
  await pool.end().catch(() => {})
}
