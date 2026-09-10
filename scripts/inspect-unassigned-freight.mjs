import { neonConfig, Pool } from '@neondatabase/serverless'

// ---------------------------------------------------------------------------
// FREIGHT THAT HAPPENED AND HAS NOBODY ATTACHED TO IT.
//
// ── THREE QUESTIONS THAT BLOCK SETTLEMENTS, ASKED OF PRODUCTION ──────────
//
// A settlement pays a driver for the loads they hauled. So a delivered load
// with no driver is money the settlement engine cannot see, and it cannot be
// tested against real freight until somebody says whose freight it was.
//
//   1. Which finished loads carry no driver or no truck, and what money is on
//      them.
//   2. Which drivers ran freight on a truck they are not linked to — and
//      whether the two sit under different authorities, which is why the seed
//      refused to link them.
//   3. What the trucks numbered 1024 actually hold, since one of them carries
//      `WW2020` where a VIN belongs.
//
// ── THE SECOND QUESTION IS ASKED OF THE FREIGHT, NOT OF THE EXPORT ───────
//
// `seed-datatruck-drivers.ts` counts the cross-authority pairs from the
// Datatruck driver export: the row names a unit, the unit exists, and it
// belongs to the other carrier. That is a claim about what the export says.
//
// THIS ASKS WHAT THE LOADS SAY, which is a different and better instrument for
// the same question — the standing rule about building an instrument from the
// artefact rather than from what a file believes. A driver who hauled 40 loads
// on unit 42 is evidence about who drove unit 42; a spreadsheet column is
// evidence about a spreadsheet. Where the two disagree, that is worth knowing
// before anybody links anything.
//
// ── IT ONLY ASKS ─────────────────────────────────────────────────────────
//
// Every statement is a SELECT and the fence in tests/prod-url-guard.test.ts
// holds it to that by name. The prose avoids the bare mutating SQL verbs on
// purpose: that fence scans this file's TEXT and cannot tell a keyword in a
// comment from one in a query. Rewording is the cheap side of the trade.
//
// If something needs changing, a human does it, from a report they have read.
//
//   node -r dotenv/config scripts/inspect-unassigned-freight.mjs
//   ZEBRA_TARGET=dev node -r dotenv/config scripts/inspect-unassigned-freight.mjs
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

const money = (cents) =>
  `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const heading = (text) => {
  console.log('')
  console.log(text)
  console.log('-'.repeat(text.length))
}

console.log(`Target: ${dev ? 'dev' : 'PRODUCTION'}`)

// ── THE FINISHED LOADS NOBODY IS ATTACHED TO ───────────────────────────────
//
// THE COLUMN IS `operationalStatus`. Loads carry two status axes on purpose
// (schema conventions note 4) and the billing one is beside it; asking for a
// bare `status` is how this script failed its first run.
//
// DELIVERED AND POD_RECEIVED ARE THE FINISHED ONES. A load still in transit
// with no driver is a dispatch problem; a DELIVERED one is a settlement
// problem, and only the second blocks what this is being asked for.
//
// COUNTED IN FULL BEFORE ANY ROW IS NAMED. Two loads were reported; whether
// they are the only two is exactly the kind of claim that turns out to be a
// subset of the real number, so the total comes first.
const unattached = await rows(`
  SELECT l."loadNumber", l."referenceNumber", l."externalId",
         l."operationalStatus"::text AS status,
         l."billingStatus"::text AS billing,
         l."totalRevenueCents", l."linehaulCents", l."accessorialsCents",
         l."driverId", l."truckId",
         c.name AS carrier, cu.name AS customer,
         l."bookedAt", l."createdAt"
    FROM "Load" l
    JOIN "Company" c ON c.id = l."companyId"
    JOIN "Customer" cu ON cu.id = l."customerId"
   WHERE l."deletedAt" IS NULL
     AND l."operationalStatus"::text IN ('DELIVERED', 'POD_RECEIVED')
     AND (l."driverId" IS NULL OR l."truckId" IS NULL)
   ORDER BY l."loadNumber"
`)

// ── CLOSED HISTORY IS NOT A SETTLEMENT PROBLEM ────────────────────────────
//
// `CLOSED_IN_DATATRUCK` means the load was billed, or deliberately not billed,
// in the system that ran it — before this one existed. Nobody is going to be
// settled for it here, so an unattached one is a gap in the record rather than
// money waiting on a decision.
//
// THE TWO ARE COUNTED SEPARATELY AND BOTH ARE PRINTED. Folding them together
// would report a number the freight does not support; dropping the closed ones
// silently would hide 14,000 rows whose driver is unknown, which is a fact
// about the archive somebody may still want.
const live = unattached.filter((row) => row.billing !== 'CLOSED_IN_DATATRUCK')
const closed = unattached.filter((row) => row.billing === 'CLOSED_IN_DATATRUCK')

heading(`FINISHED LOADS WITH NO DRIVER OR NO TRUCK — ${unattached.length}`)
console.log(`  live, and blocking a settlement:   ${live.length}`)
console.log(`  closed in Datatruck, history only: ${closed.length}`)
console.log('')

let attachedToNobody = 0
for (const row of live) {
  attachedToNobody += row.totalRevenueCents
  const missing = [
    row.driverId ? null : 'no driver',
    row.truckId ? null : 'no truck',
  ]
    .filter(Boolean)
    .join(', ')
  console.log(
    `  ${String(row.loadNumber).padEnd(8)} ${row.status.padEnd(13)} ` +
      `${money(row.totalRevenueCents).padStart(12)}  ${missing.padEnd(22)} ` +
      `${row.carrier} / ${row.customer}`,
  )
  console.log(
    `           ref=${row.referenceNumber ?? '—'}  externalId=${row.externalId ?? '—'}  ` +
      `billing=${row.billing}  booked=${row.bookedAt ? row.bookedAt.toISOString().slice(0, 10) : '—'}`,
  )
}
console.log('')
console.log(`  Revenue on the live rows: ${money(attachedToNobody)}`)
console.log(
  `  Revenue on the closed ones: ${money(closed.reduce((sum, row) => sum + row.totalRevenueCents, 0))}`,
)

// THE SAME QUESTION WITHOUT THE STATUS FILTER, so a load that finished under a
// status nobody expected is not silently outside the answer.
const [anyStatus] = await rows(`
  SELECT COUNT(*)::int AS n, COALESCE(SUM("totalRevenueCents"), 0)::bigint AS cents
    FROM "Load"
   WHERE "deletedAt" IS NULL
     AND ("driverId" IS NULL OR "truckId" IS NULL)
`)
console.log(
  `  Across every status: ${anyStatus.n} load(s), ${money(Number(anyStatus.cents))}`,
)

// ── WHO ACTUALLY DROVE WHAT ────────────────────────────────────────────────
//
// The freight's own answer to "which truck is this driver on". Only drivers
// who are not INACTIVE, because a terminated driver's missing link is history
// rather than something to settle.
//
// `bookedAt` IS THE DATE, NOT A DELIVERY ONE. `Load` has no `deliveredAt`
// column — arrival lives on the stops — and reaching for one is what this
// script did on its first run. Booked is the date it honestly has.
const drove = await rows(`
  SELECT d.id AS "driverId",
         d."firstName", d."lastName", d."externalId",
         dc.name AS "driverCarrier",
         t."unitNumber", t.id AS "truckId", tc.name AS "truckCarrier",
         COUNT(*)::int AS loads,
         MAX(l."bookedAt") AS "lastRan"
    FROM "Load" l
    JOIN "Driver" d ON d.id = l."driverId"
    JOIN "Company" dc ON dc.id = d."companyId"
    JOIN "Truck" t ON t.id = l."truckId"
    JOIN "Company" tc ON tc.id = t."companyId"
   WHERE l."deletedAt" IS NULL
     AND d."deletedAt" IS NULL
     AND d."assignedTruckId" IS NULL
     -- ACTIVE IS NOT A DriverStatus. The enum is AVAILABLE / DISPATCHED /
     -- ON_ROUTE / OFF_DUTY / VACATION / INACTIVE, so "still with us" is the
     -- absence of the last one rather than the presence of a first one.
     AND d.status::text <> 'INACTIVE'
   GROUP BY d.id, d."firstName", d."lastName", d."externalId",
            dc.name, t."unitNumber", t.id, tc.name
   ORDER BY d."lastName", d."firstName", COUNT(*) DESC
`)

const same = drove.filter((row) => row.driverCarrier === row.truckCarrier)
const cross = drove.filter((row) => row.driverCarrier !== row.truckCarrier)

heading(
  `ACTIVE DRIVERS WITH NO TRUCK LINK, BY THE FREIGHT THEY RAN — ${drove.length} pair(s)`,
)
console.log(`  same carrier on both sides:  ${same.length}`)
console.log(`  driver and truck disagree:   ${cross.length}`)

const show = (label, list) => {
  if (list.length === 0) return
  console.log('')
  console.log(`  ${label}`)
  for (const row of list) {
    console.log(
      `    unit ${String(row.unitNumber).padEnd(6)} ` +
        `${`${row.firstName} ${row.lastName}`.padEnd(26)} ` +
        `${String(row.loads).padStart(4)} load(s)  ` +
        `last ${row.lastRan ? row.lastRan.toISOString().slice(0, 10) : '—'}  ` +
        `driver=${row.driverCarrier} truck=${row.truckCarrier}`,
    )
  }
}
show('SAME CARRIER — the link is simply unmade:', same)
show('DIFFERENT CARRIERS — the export disagreed with itself here:', cross)

// HOW MANY DRIVERS, NOT HOW MANY PAIRS. A driver who ran two trucks is two
// rows above and one person to decide about, and reporting the larger number
// as "drivers" would overstate the work.
const people = new Set(drove.map((row) => row.driverId))
const crossPeople = new Set(cross.map((row) => row.driverId))
console.log('')
console.log(
  `  ${people.size} driver(s) involved, ${crossPeople.size} of them across carriers.`,
)

// ── THE TWO TRUCKS NUMBERED 1024 ───────────────────────────────────────────
const twins = await rows(`
  SELECT t.id, t."unitNumber", t.vin, t.make, t.model, t.year, t.plate,
         t.status::text AS status, t."deletedAt",
         c.name AS carrier,
         (SELECT COUNT(*)::int FROM "Load" l
           WHERE l."truckId" = t.id AND l."deletedAt" IS NULL) AS loads,
         (SELECT COUNT(*)::int FROM "ComplianceItem" ci
           WHERE ci."truckId" = t.id AND ci."deletedAt" IS NULL) AS compliance
    FROM "Truck" t
    JOIN "Company" c ON c.id = t."companyId"
   WHERE t."unitNumber" = '1024'
   ORDER BY c.name
`)

heading(`TRUCKS NUMBERED 1024 — ${twins.length}`)
for (const row of twins) {
  const vin = row.vin ?? '—'
  // A VIN IS 17 CHARACTERS. Anything else is a placeholder somebody typed, and
  // saying which is which is the whole reason this block prints the length.
  const shape = row.vin
    ? row.vin.length === 17
      ? '17 chars'
      : `${row.vin.length} chars — NOT A VIN`
    : 'none'
  console.log(
    `  ${row.carrier.padEnd(20)} vin=${vin.padEnd(20)} (${shape})  ` +
      `${row.year ?? '—'} ${row.make ?? '—'} ${row.model ?? '—'}`,
  )
  console.log(
    `  ${''.padEnd(20)} plate=${row.plate ?? '—'}  status=${row.status}  ` +
      `loads=${row.loads}  compliance=${row.compliance}  ` +
      `${row.deletedAt ? 'REMOVED' : 'live'}  id=${row.id}`,
  )
}

// ── AND EVERY OTHER VIN THAT IS NOT ONE ────────────────────────────────────
//
// COUNT THE THING BEING CLAIMED, NOT ONE INSTANCE OF IT. `WW2020` was reported
// on one truck; whether it is the only malformed VIN on the fleet is a
// different question, and the answer governs whether this is a repair or a
// pattern.
const malformed = await rows(`
  SELECT t."unitNumber", t.vin, c.name AS carrier, t.status::text AS status
    FROM "Truck" t
    JOIN "Company" c ON c.id = t."companyId"
   WHERE t."deletedAt" IS NULL
     AND t.vin IS NOT NULL
     AND LENGTH(t.vin) <> 17
   ORDER BY c.name, t."unitNumber"
`)

heading(`VIN VALUES THAT ARE NOT 17 CHARACTERS — ${malformed.length}`)
for (const row of malformed) {
  console.log(
    `  unit ${String(row.unitNumber).padEnd(6)} ${String(row.vin).padEnd(20)} ` +
      `(${row.vin.length}) ${row.carrier}  ${row.status}`,
  )
}

// ── LOADS SOMEBODY NAMED, WHATEVER STATE THEY ARE IN ──────────────────────
//
// COUNT THE THING BEING CLAIMED. A report that two particular loads are
// unattached is checkable, and the check is worth more than the summary above:
// if they are not in that list, either they are attached, or they are not
// finished, or the numbers name something else. All three are findings and
// only silence is not.
//
// `loadNumber` IS NOT UNIQUE ACROSS CARRIERS — it comes off a Counter, and
// production carries two loads numbered 1001 under different authorities. So
// this prints every match rather than the first.
const named = process.argv.slice(2).filter((arg) => !arg.startsWith('-'))
if (named.length > 0) {
  const found = await rows(
    `
    SELECT l."loadNumber", l."referenceNumber", l."externalId",
           l."operationalStatus"::text AS status,
           l."billingStatus"::text AS billing,
           l."totalRevenueCents", l."isCancelled",
           c.name AS carrier, cu.name AS customer,
           l."bookedAt",
           d."firstName", d."lastName", t."unitNumber"
      FROM "Load" l
      JOIN "Company" c ON c.id = l."companyId"
      JOIN "Customer" cu ON cu.id = l."customerId"
      LEFT JOIN "Driver" d ON d.id = l."driverId"
      LEFT JOIN "Truck" t ON t.id = l."truckId"
     WHERE l."deletedAt" IS NULL
       AND (l."loadNumber" = ANY($1) OR l."referenceNumber" = ANY($1)
            OR l."externalId" = ANY($1))
     ORDER BY l."loadNumber", c.name
  `,
    [named],
  )

  heading(`LOADS NAMED ON THE COMMAND LINE — ${found.length} match(es)`)
  let total = 0
  for (const row of found) {
    total += row.totalRevenueCents
    console.log(
      `  ${String(row.loadNumber).padEnd(8)} ${row.status.padEnd(13)} ` +
        `${money(row.totalRevenueCents).padStart(12)}  ${row.carrier} / ${row.customer}`,
    )
    console.log(
      `           driver=${row.firstName ? `${row.firstName} ${row.lastName}` : 'NONE'}  ` +
        `truck=${row.unitNumber ?? 'NONE'}  externalId=${row.externalId ?? '—'}  ` +
        `billing=${row.billing}  ` +
        `${row.isCancelled ? 'CANCELLED  ' : ''}booked=${row.bookedAt ? row.bookedAt.toISOString().slice(0, 10) : '—'}`,
    )
  }
  if (found.length > 0)
    console.log(`
  Together: ${money(total)}`)
  for (const want of named) {
    if (!found.some((row) => String(row.loadNumber) === want)) {
      console.log(`  no load numbered ${want}`)
    }
  }
}

const [fleet] = await rows(`
  SELECT COUNT(*)::int AS total,
         COUNT(vin)::int AS "withVin"
    FROM "Truck"
   WHERE "deletedAt" IS NULL
`)
console.log('')
console.log(`  Live trucks: ${fleet.total}, carrying a VIN: ${fleet.withVin}`)

await pool.end()
