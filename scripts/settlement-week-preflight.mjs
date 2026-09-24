import { neonConfig, Pool } from '@neondatabase/serverless'

// ---------------------------------------------------------------------------
// WHAT WOULD BE MISSING FROM A SETTLEMENT WEEK, ASKED BEFORE THE WEEK IS RUN.
//
// A settlement pays a driver for the loads they hauled. Three things make
// freight invisible to that, and all three are silent: the draft BALANCES and
// is short, with nothing on any screen naming what fell out.
//
//   1. A load with nobody in either seat. `settleableWhere` selects on
//      `OR: [{ driverId }, { coDriverId: driverId }]`, so a load attached to
//      nobody is in no driver's settleable set and appears on no statement.
//   2. A truck that hauled the week's freight with no driver linked to it.
//      That is the LEAD for (1): the export names a person against the unit,
//      so a load with a truck and no driver is usually one name away.
//   3. A driver with settleable loads and no pay rule in force. The engine
//      cannot price the load, so the line is held rather than paid.
//
// ── THE RULE QUESTION IS ASKED THE WAY THE ENGINE ASKS IT ────────────────
//
// Not "has this driver a rule this week" — `settlements.ts` picks the rule on
// `load.podReceivedAt ?? periodEnd`, PER LOAD. A driver whose rule starts on
// the Wednesday has a rule for half the week, and asking about the week would
// answer yes while three of their loads went unpriced. So this asks each load
// its own question, against its own POD date, which is the standing rule about
// building the instrument from the artefact rather than from what a summary
// believes.
//
// ── IT ONLY ASKS ─────────────────────────────────────────────────────────
//
// Every statement is a SELECT, and the fence in tests/prod-url-guard.test.ts
// holds this file to that BY NAME — it scans the text and cannot tell a
// keyword in a comment from one in a query, so the prose here avoids the bare
// mutating SQL verbs on purpose. Rewording is the cheap side of that trade.
//
// Nothing here fixes anything. A human reads the report and decides.
//
//   node -r dotenv/config scripts/settlement-week-preflight.mjs
//   ZEBRA_TARGET=dev node -r dotenv/config scripts/settlement-week-preflight.mjs
//   ZEBRA_WEEK=2026-09-13 node -r dotenv/config scripts/settlement-week-preflight.mjs
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

// ── THE WEEK, STATED AND PRINTED ─────────────────────────────────────────
//
// Saturday to Friday, which is this carrier's settlement week. The start is
// given as a day and the end is derived from it — two dates typed by hand are
// two chances to ask about six days and report it as seven.
const startDay = process.env.ZEBRA_WEEK ?? '2026-09-13'
if (!/^\d{4}-\d{2}-\d{2}$/.test(startDay)) {
  console.error(`ZEBRA_WEEK must be a yyyy-mm-dd day. Got: ${startDay}`)
  process.exit(1)
}
const periodStart = new Date(`${startDay}T00:00:00.000Z`)
if (Number.isNaN(periodStart.getTime())) {
  console.error(`ZEBRA_WEEK is not a real day: ${startDay}`)
  process.exit(1)
}
const periodEnd = new Date(periodStart.getTime() + 7 * 86_400_000 - 1)

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false
const pool = new Pool({ connectionString, max: 1 })
const rows = async (text, values = []) => (await pool.query(text, values)).rows

const money = (cents) =>
  `$${(Number(cents) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

const day = (at) => (at ? new Date(at).toISOString().slice(0, 10) : '—')

const heading = (text) => {
  console.log('')
  console.log(text)
  console.log('-'.repeat(text.length))
}

console.log(`Target:  ${dev ? 'dev' : 'PRODUCTION'}`)
console.log(`Week:    ${day(periodStart)} → ${day(periodEnd)}`)

// ── ONE TENANT, ASSERTED RATHER THAN ASSUMED ─────────────────────────────
//
// This connects as the owner role, which carries BYPASSRLS, so the mechanism
// that keeps tenants apart everywhere else in this system is absent here. A
// count that quietly spanned two organizations would be a number nobody could
// act on, so the organizations holding the week's freight are named and more
// than one stops the run.
const orgs = await rows(
  `
  SELECT o.id, o.name, COUNT(l.id)::int AS loads
    FROM "Organization" o
    JOIN "Load" l ON l."organizationId" = o.id
    JOIN "LoadStatusEvent" e ON e."loadId" = l.id
   WHERE e.axis = 'OPERATIONAL'
     AND e."toStatus"::text = 'POD_RECEIVED'
     AND e.outcome::text = 'APPLIED'
     AND e."occurredAt" BETWEEN $1 AND $2
   GROUP BY o.id, o.name
   ORDER BY loads DESC
`,
  [periodStart, periodEnd],
)

if (orgs.length === 0) {
  console.log('')
  console.log(
    'No load reached POD_RECEIVED in this week. Nothing to preflight.',
  )
  await pool.end()
  process.exit(0)
}
if (orgs.length > 1) {
  console.error('')
  console.error('More than one organization holds freight in this week:')
  for (const org of orgs)
    console.error(`  ${org.name} (${org.id}) — ${org.loads}`)
  console.error('Refusing: a merged count is not a finding anybody can act on.')
  await pool.end()
  process.exit(1)
}
const org = orgs[0]
console.log(`Tenant:  ${org.name} (${org.id})`)
console.log(`Loads reaching POD_RECEIVED in the week: ${org.loads}`)

// ── 1. LOADS WITH NOBODY IN EITHER SEAT ──────────────────────────────────
//
// The settleable shape, mirrored from `SETTLEABLE_LOAD` and `settleableWhere`:
// live, not cancelled, not closed in Datatruck, POD_RECEIVED, and carrying an
// APPLIED event in the window. Minus the driver, which is the thing being
// counted.
const driverless = await rows(
  `
  SELECT l."loadNumber", l."externalId", l."referenceNumber",
         l."totalRevenueCents", l."truckId",
         t."unitNumber", c.name AS carrier,
         MIN(e."occurredAt") AS pod
    FROM "Load" l
    JOIN "Company" c ON c.id = l."companyId"
    JOIN "LoadStatusEvent" e ON e."loadId" = l.id
    LEFT JOIN "Truck" t ON t.id = l."truckId"
   WHERE l."organizationId" = $3
     AND l."deletedAt" IS NULL
     AND l."isCancelled" = false
     AND l."billingStatus"::text <> 'CLOSED_IN_DATATRUCK'
     AND l."operationalStatus"::text = 'POD_RECEIVED'
     AND l."driverId" IS NULL
     AND l."coDriverId" IS NULL
     AND e.axis = 'OPERATIONAL'
     AND e."toStatus"::text = 'POD_RECEIVED'
     AND e.outcome::text = 'APPLIED'
     AND e."occurredAt" BETWEEN $1 AND $2
   GROUP BY l.id, l."loadNumber", l."externalId", l."referenceNumber",
            l."totalRevenueCents", l."truckId", t."unitNumber", c.name
   ORDER BY l."loadNumber"
`,
  [periodStart, periodEnd, org.id],
)

heading(`1. SETTLEABLE LOADS WITH NOBODY IN EITHER SEAT — ${driverless.length}`)
if (driverless.length === 0) {
  console.log('  None. Every settleable load in the week names a driver.')
} else {
  let lost = 0
  for (const row of driverless) {
    lost += Number(row.totalRevenueCents)
    console.log(
      `  ${String(row.loadNumber).padEnd(12)} ${money(row.totalRevenueCents).padStart(12)}  ` +
        `POD ${day(row.pod)}  unit ${row.unitNumber ?? '— none —'}  ${row.carrier}`,
    )
    console.log(
      `               externalId=${row.externalId ?? '—'}  ref=${row.referenceNumber ?? '—'}`,
    )
  }
  console.log('')
  console.log(`  On no statement this week: ${money(lost)}`)
  console.log(
    '  A load with a unit and no driver is one name away: re-run the loads',
  )
  console.log(
    '  import and the add-missing crew fill will attach whoever the export',
  )
  console.log('  names, where that name lands on exactly one driver.')
}

// ── 2. TRUCKS THAT HAULED THE WEEK WITH NO DRIVER LINKED ─────────────────
//
// The lead for (1), and a finding in its own right: a unit nobody is linked to
// is a unit whose freight has no obvious owner when somebody comes to fix it.
// Asked of the FREIGHT — the trucks that actually ran this week — rather than
// of the fleet, so an idle truck with no driver is not reported as a problem
// with a week it took no part in.
const orphanTrucks = await rows(
  `
  SELECT t."unitNumber", t.id, c.name AS carrier,
         COUNT(DISTINCT l.id)::int AS loads,
         SUM(l."totalRevenueCents")::bigint AS revenue,
         COUNT(DISTINCT l.id) FILTER (
           WHERE l."driverId" IS NULL AND l."coDriverId" IS NULL
         )::int AS "loadsWithNobody"
    FROM "Truck" t
    JOIN "Company" c ON c.id = t."companyId"
    JOIN "Load" l ON l."truckId" = t.id
    JOIN "LoadStatusEvent" e ON e."loadId" = l.id
   WHERE t."organizationId" = $3
     AND t."deletedAt" IS NULL
     AND l."deletedAt" IS NULL
     AND l."isCancelled" = false
     AND l."billingStatus"::text <> 'CLOSED_IN_DATATRUCK'
     AND e.axis = 'OPERATIONAL'
     AND e."toStatus"::text = 'POD_RECEIVED'
     AND e.outcome::text = 'APPLIED'
     AND e."occurredAt" BETWEEN $1 AND $2
     AND NOT EXISTS (
       SELECT 1 FROM "Driver" d
        WHERE d."assignedTruckId" = t.id AND d."deletedAt" IS NULL
     )
   GROUP BY t.id, t."unitNumber", c.name
   ORDER BY revenue DESC
`,
  [periodStart, periodEnd, org.id],
)

heading(
  `2. TRUCKS THAT HAULED THIS WEEK WITH NO DRIVER LINKED — ${orphanTrucks.length}`,
)
if (orphanTrucks.length === 0) {
  console.log('  None. Every unit that ran this week has a driver linked.')
} else {
  for (const row of orphanTrucks) {
    console.log(
      `  unit ${String(row.unitNumber).padEnd(8)} ${String(row.loads).padStart(3)} load(s) ` +
        `${money(row.revenue).padStart(12)}  ${row.loadsWithNobody} with nobody in either seat  ${row.carrier}`,
    )
  }
  console.log('')
  console.log(
    '  A link is not required to settle — the load names the driver, not the',
  )
  console.log(
    '  truck — so this is a lead and a data gap rather than a blocked week.',
  )
}

// ── 3. DRIVERS WITH SETTLEABLE LOADS AND NO RULE IN FORCE ────────────────
//
// PER LOAD, ON ITS OWN POD DATE, because that is what `settlements.ts` does:
// `ruleInForce(rules, load.podReceivedAt ?? periodEnd)`. A driver whose rule
// starts mid-week has a rule for part of it, and a question asked about the
// week would answer yes while the earlier loads went unpriced.
//
// `effectiveTo IS NULL` is an open rule, matching `ruleInForce` exactly.
const unpriced = await rows(
  `
  WITH settleable AS (
    SELECT l.id,
           l."loadNumber",
           l."totalRevenueCents",
           COALESCE(d.id, cd.id) AS "driverId",
           COALESCE(d."lastName" || ', ' || d."firstName",
                    cd."lastName" || ', ' || cd."firstName") AS "driverName",
           MIN(e."occurredAt") AS pod
      FROM "Load" l
      LEFT JOIN "Driver" d ON d.id = l."driverId"
      LEFT JOIN "Driver" cd ON cd.id = l."coDriverId"
      JOIN "LoadStatusEvent" e ON e."loadId" = l.id
     WHERE l."organizationId" = $3
       AND l."deletedAt" IS NULL
       AND l."isCancelled" = false
       AND l."billingStatus"::text <> 'CLOSED_IN_DATATRUCK'
       AND l."operationalStatus"::text = 'POD_RECEIVED'
       AND (l."driverId" IS NOT NULL OR l."coDriverId" IS NOT NULL)
       AND e.axis = 'OPERATIONAL'
       AND e."toStatus"::text = 'POD_RECEIVED'
       AND e.outcome::text = 'APPLIED'
       AND e."occurredAt" BETWEEN $1 AND $2
     GROUP BY l.id, l."loadNumber", l."totalRevenueCents", d.id, cd.id,
              d."lastName", d."firstName", cd."lastName", cd."firstName"
  )
  SELECT s."driverName", s."driverId",
         COUNT(*)::int AS loads,
         SUM(s."totalRevenueCents")::bigint AS revenue,
         MIN(s.pod) AS "firstPod",
         MAX(s.pod) AS "lastPod"
    FROM settleable s
   WHERE NOT EXISTS (
     SELECT 1 FROM "DriverPayRule" r
      WHERE r."driverId" = s."driverId"
        AND r."effectiveFrom" <= s.pod
        AND (r."effectiveTo" IS NULL OR r."effectiveTo" >= s.pod)
   )
   GROUP BY s."driverName", s."driverId"
   ORDER BY revenue DESC
`,
  [periodStart, periodEnd, org.id],
)

heading(
  `3. DRIVERS WITH SETTLEABLE LOADS AND NO RULE IN FORCE — ${unpriced.length}`,
)
if (unpriced.length === 0) {
  console.log('  None. Every settleable load in the week can be priced.')
} else {
  let held = 0
  for (const row of unpriced) {
    held += Number(row.revenue)
    console.log(
      `  ${String(row.driverName).padEnd(28)} ${String(row.loads).padStart(3)} load(s) ` +
        `${money(row.revenue).padStart(12)}  POD ${day(row.firstPod)} → ${day(row.lastPod)}`,
    )
  }
  console.log('')
  console.log(`  Gross the engine cannot price: ${money(held)}`)
  console.log(
    '  These lines are HELD rather than dropped — the draft names them.',
  )
}

// ── THE VERDICT, IN ONE LINE ─────────────────────────────────────────────
//
// Printed last and unconditionally. A report whose answer has to be assembled
// by the reader from three sections is a report whose answer gets assembled
// differently by two readers.
heading('VERDICT')
const blocking = driverless.length + unpriced.length
if (blocking === 0) {
  console.log('  CLEAR — every settleable load in the week has a driver and a')
  console.log('  rule to price it. Item 2 of the trucks list is a data gap.')
} else {
  console.log(
    `  NOT CLEAR — ${driverless.length} load(s) on no statement, ` +
      `${unpriced.length} driver(s) with nothing to price by.`,
  )
  console.log('  Fix these before the draft is trusted: a settlement that')
  console.log('  cannot see freight balances anyway.')
}

await pool.end()
