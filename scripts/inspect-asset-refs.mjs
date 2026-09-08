import { neonConfig, Pool } from '@neondatabase/serverless'

// ---------------------------------------------------------------------------
// WHAT WOULD BE DESTROYED IF THIS ASSET WERE DELETED?
//
// ── ASKED BEFORE THE ROW IS REMOVED, NOT DISCOVERED AFTER ─────────────────
//
// The Datatruck seed created a second truck numbered 1024 — the export files
// it under RAM Haulage and production already carried a hand-made 1024 under
// Dolphins Transport with `WW2020` in the VIN column, which is not a VIN. The
// owner's ruling was to write the real one and leave the hand-made row alone,
// because a duplicate is visible and fixable and a removal is neither.
//
// WHAT DECIDES ITS FATE IS WHAT POINTS AT IT. A row nothing references can be
// removed; a row a load or a settlement points at is history, and deleting it
// takes something with it. `companies.ts` makes exactly this argument about an
// authority and counts every cascading relation before allowing a removal —
// this is the same question one level down, for a truck or a driver.
//
// THE PROSE HERE AVOIDS THE BARE SQL VERBS ON PURPOSE. The fence in
// tests/prod-url-guard.test.ts holds every unattended reader to "no mutating
// statements" by scanning the file's TEXT, so it cannot tell a keyword in a
// comment from one in a query. Rewording is the cheap side of that trade;
// teaching the guard to parse SQL would be a weaker guard for prettier
// comments.
//
// IT ONLY ASKS. Every statement is a SELECT and the fence in
// tests/prod-url-guard.test.ts holds it to that by name. If something needs
// changing, a human does it.
//
//   node -r dotenv/config scripts/inspect-asset-refs.mjs truck 1024
//   ZEBRA_TARGET=dev node -r dotenv/config scripts/inspect-asset-refs.mjs truck 1024
// ---------------------------------------------------------------------------

const dev = process.env.ZEBRA_TARGET === 'dev'
const connectionString = dev
  ? process.env.DIRECT_DATABASE_URL
  : process.env.PROD_DIRECT_DATABASE_URL

const KIND = (process.argv[2] ?? '').toLowerCase()
const UNIT = process.argv[3]

if (!connectionString || !['truck', 'driver'].includes(KIND) || !UNIT) {
  console.error(
    'Usage: node -r dotenv/config scripts/inspect-asset-refs.mjs <truck|driver> <unit|externalId>',
  )
  process.exit(1)
}

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false
const pool = new Pool({ connectionString, max: 1 })
const rows = async (text, values = []) => (await pool.query(text, values)).rows

/**
 * Every table with a column pointing at this one.
 *
 * WRITTEN OUT RATHER THAN DISCOVERED. A reflective sweep over the catalogue
 * would be shorter and would silently start covering a new table nobody has
 * thought about — the point of this list is that somebody decided each entry
 * matters, the same way `CASCADING` in companies.ts is enumerated by hand.
 */
const TRUCK_REFS = [
  ['Load', 'truckId', 'loads'],
  ['LoadAssignment', 'truckId', 'load assignments'],
  ['AssetAssignment', 'truckId', 'asset-history periods'],
  ['Document', 'truckId', 'documents'],
  ['Expense', 'truckId', 'expenses'],
  ['FuelTransaction', 'truckId', 'fuel transactions'],
  ['MaintenanceRecord', 'truckId', 'maintenance records'],
  ['IftaMileage', 'truckId', 'IFTA mileage rows'],
  ['ComplianceItem', 'truckId', 'compliance items'],
  ['RoadsideInspection', 'truckId', 'roadside inspections'],
  ['Claim', 'truckId', 'claims'],
  ['Driver', 'assignedTruckId', 'drivers assigned to it'],
]

const DRIVER_REFS = [
  ['Load', 'driverId', 'loads'],
  ['LoadAssignment', 'driverId', 'load assignments'],
  ['AssetAssignment', 'driverId', 'asset-history periods'],
  ['Settlement', 'driverId', 'settlements'],
  ['DriverPayRule', 'driverId', 'pay rules'],
  ['Document', 'driverId', 'documents'],
  ['Expense', 'driverId', 'expenses'],
  ['FuelTransaction', 'driverId', 'fuel transactions'],
  ['ComplianceItem', 'driverId', 'compliance items'],
  ['RoadsideInspection', 'driverId', 'roadside inspections'],
  ['Claim', 'driverId', 'claims'],
  ['Communication', 'driverId', 'communications'],
]

try {
  console.log(`Reading ${dev ? 'DEV' : 'PRODUCTION'}.\n`)

  const found =
    KIND === 'truck'
      ? await rows(
          `select t.id, t."unitNumber" as label, t.vin, t.make, t.model, t.year,
                  t.status::text as status, t."deletedAt", c.name as company
             from "Truck" t join "Company" c on c.id = t."companyId"
            where t."unitNumber" = $1
            order by c.name`,
          [UNIT],
        )
      : await rows(
          `select d.id, d."firstName" || ' ' || d."lastName" as label,
                  d."externalId", d."deletedAt", c.name as company
             from "Driver" d join "Company" c on c.id = d."companyId"
            where d."externalId" = $1
            order by c.name`,
          [UNIT],
        )

  if (found.length === 0) {
    console.log(`No ${KIND} matching ${JSON.stringify(UNIT)}.`)
    process.exit(0)
  }

  console.log(`${found.length} ${KIND}(s) matching ${JSON.stringify(UNIT)}:`)
  console.table(found)

  const refs = KIND === 'truck' ? TRUCK_REFS : DRIVER_REFS

  for (const asset of found) {
    console.log(`\n── ${asset.company} · ${asset.label} · ${asset.id}`)
    let total = 0
    const held = []
    for (const [table, column, what] of refs) {
      const [{ n }] = await rows(
        `select count(*)::int as n from "${table}" where "${column}" = $1`,
        [asset.id],
      )
      total += n
      if (n > 0) held.push(`${n} ${what}`)
    }
    console.log(
      total === 0
        ? '   NOTHING REFERENCES IT. Deleting this row destroys no history.'
        : `   ${total} reference(s): ${held.join(', ')}`,
    )
    if (total > 0) {
      console.log(
        '   Deleting it would take those with it. Correcting the row —' +
          ' or moving what points at it — keeps them.',
      )
    }
  }
} finally {
  await pool.end().catch(() => {})
}
