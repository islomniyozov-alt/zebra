import { randomUUID } from 'node:crypto'
import { neonConfig, Pool } from '@neondatabase/serverless'

// ---------------------------------------------------------------------------
// THE LOADS THAT READ FINISHED AND CARRY NO EVENT SAYING SO.
//
// `settleableWhere` selects on an APPLIED POD_RECEIVED event dated INSIDE the
// period. Until 2026-09-24 the Datatruck loads importer wrote
// `operationalStatus` as a plain column value and no operational event at all —
// so an imported load read "Delivered" on every screen and was in no driver's
// settleable set, in any week, for ever. The draft came out EMPTY and balanced.
//
// The importer transitions properly now. THIS IS FOR THE ROWS IT ALREADY
// WROTE, and it is the same shape as `backfill-direct-pod.mjs`, widened past
// `directSettled` by ruling.
//
// ── WHAT IT WILL NOT TOUCH, AND WHY THAT IS MOST OF THEM ─────────────────
//
// CLOSED HISTORY IS REFUSED. Owner's guard: a load whose billing axis says
// `CLOSED_IN_DATATRUCK` was billed, or deliberately not billed, in the system
// that ran it. Nobody will be settled for it here, and stamping a POD event on
// it would make it look like freight awaiting payment. `SETTLEABLE_LOAD`
// excludes it anyway, so the stamp would buy nothing and cost clarity.
//
// THAT EXCLUSION IS ALSO A FINDING, and the report says so rather than hiding
// it in a filter: `readStatus` maps every finished Datatruck row —
// `delivered`, `invoiced`, `paid` — to `CLOSED_IN_DATATRUCK`. So the freight
// this script is most obviously "for" is precisely the freight it must refuse.
// Both counts are printed.
//
// ── THE DATE COMES FROM THE FREIGHT, NEVER FROM NOW ─────────────────────
//
// Ruling, 2026-09-24: the delivery date. `backfill-direct-pod.mjs` reads it
// from the load's APPLIED DELIVERED event — which these loads do not have,
// which is the whole problem — so this reads the last DELIVERY stop instead:
// its actual arrival if somebody recorded one, else the scheduled time the
// import wrote from the export's own delivery date.
//
// A load with neither is REFUSED rather than stamped at `now()`. An invented
// date decides which pay week somebody's money falls in.
//
// ── IT IS DRY RUN UNTIL TOLD OTHERWISE ──────────────────────────────────
//
//   node -r dotenv/config scripts/repair-missing-pod-events.mjs
//   node -r dotenv/config scripts/repair-missing-pod-events.mjs --apply
//   ZEBRA_TARGET=dev node -r dotenv/config scripts/repair-missing-pod-events.mjs
//
// Every row it would touch is named with its date and its reason. Nothing is
// written without `--apply`, and being on the fence's maintenance list is the
// claim that somebody read the dry run first.
//
// IDEMPOTENT: the selection excludes any load already carrying an APPLIED
// POD_RECEIVED event, so a second run finds nothing. Running it twice is not a
// way to pay anybody twice.
// ---------------------------------------------------------------------------

const apply = process.argv.includes('--apply')
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
  `$${(Number(cents) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
const when = (at) => (at ? new Date(at).toISOString().slice(0, 10) : '—')

console.log(`Target: ${dev ? 'dev' : 'PRODUCTION'}`)
console.log(`Mode:   ${apply ? 'APPLY — rows will be written' : 'dry run'}`)

// ── THE CANDIDATES ──────────────────────────────────────────────────────
//
// Finished on the operational axis, live on the billing one, and carrying no
// APPLIED POD event. The delivery date is read in the order the rest of this
// system reads it: the actual, then the plan.
const candidates = await rows(`
  SELECT l.id,
         l."loadNumber",
         l."externalId",
         l."operationalStatus"::text AS operational,
         l."billingStatus"::text AS billing,
         l."totalRevenueCents",
         l."driverId",
         l."coDriverId",
         l."organizationId",
         c.name AS carrier,
         stop."arrivedAt",
         stop."scheduledAt"
    FROM "Load" l
    JOIN "Company" c ON c.id = l."companyId"
    LEFT JOIN LATERAL (
      SELECT s."arrivedAt", s."scheduledAt"
        FROM "LoadStop" s
       WHERE s."loadId" = l.id AND s."type" = 'DELIVERY'
       ORDER BY s."sequence" DESC
       LIMIT 1
    ) stop ON true
   WHERE l."deletedAt" IS NULL
     AND l."isCancelled" = false
     AND l."operationalStatus"::text IN ('DELIVERED', 'POD_RECEIVED')
     AND NOT EXISTS (
       SELECT 1 FROM "LoadStatusEvent" e
        WHERE e."loadId" = l.id
          AND e.axis = 'OPERATIONAL'
          AND e."toStatus" = 'POD_RECEIVED'
          AND e.outcome = 'APPLIED'
     )
   ORDER BY l."loadNumber"
`)

// ── THE GUARD, APPLIED HERE AND NOT IN THE QUERY ─────────────────────────
//
// Closed history is filtered in JavaScript on purpose: the count of what was
// refused is a finding this report has to be able to print. A `WHERE` clause
// would make the refusal invisible, which is how "it did nothing" and "there
// was nothing to do" become indistinguishable.
const closed = candidates.filter((row) => row.billing === 'CLOSED_IN_DATATRUCK')
const live = candidates.filter((row) => row.billing !== 'CLOSED_IN_DATATRUCK')

const dateFor = (row) => row.arrivedAt ?? row.scheduledAt ?? null
const doable = live.filter((row) => dateFor(row) !== null)
const undated = live.filter((row) => dateFor(row) === null)

console.log('')
console.log(`Finished loads with no POD event: ${candidates.length}`)
console.log(`  closed in Datatruck — REFUSED by ruling: ${closed.length}`)
console.log(`  live, and in scope:                      ${live.length}`)
console.log(`    of those, carrying a delivery date:    ${doable.length}`)
console.log(`    of those, with no date to stamp:       ${undated.length}`)

if (closed.length > 0) {
  console.log('')
  console.log(
    'THE REFUSED SET IS THE FINDING. `readStatus` maps every finished Datatruck',
  )
  console.log('row — delivered, invoiced, paid — to CLOSED_IN_DATATRUCK, and')
  console.log(
    '`SETTLEABLE_LOAD` excludes that outright. Stamping a POD on these would',
  )
  console.log(
    'make history look like freight awaiting payment and would settle nothing.',
  )
}

if (live.length === 0) {
  console.log('')
  console.log('Nothing in scope. Which is also what a second run looks like.')
  await pool.end()
  process.exit(0)
}

console.log('')
for (const row of live) {
  const at = dateFor(row)
  const flags = [
    at ? null : 'NO DELIVERY DATE — skipped',
    row.driverId || row.coDriverId ? null : 'NO DRIVER — will still not settle',
    row.arrivedAt ? null : at ? 'planned time, no actual recorded' : null,
  ].filter(Boolean)

  console.log(
    `  ${String(row.loadNumber).padEnd(12)} ${row.operational.padEnd(13)} ` +
      `${money(row.totalRevenueCents).padStart(12)}  POD would read ${when(at)}  ${row.carrier}` +
      `${flags.length > 0 ? `\n               ${flags.join(' · ')}` : ''}`,
  )
}

if (!apply) {
  console.log('')
  console.log(
    `Dry run. ${doable.length} load(s) would gain a POD event dated from their`,
  )
  console.log(
    'delivery stop. Re-run with --apply once the list above reads right.',
  )
  await pool.end()
  process.exit(0)
}

// ── THE WRITE ───────────────────────────────────────────────────────────
//
// One event and one column per load, in a transaction each, so a failure
// halfway leaves no load carrying an event whose column disagrees with it.
//
// `outcome` is APPLIED and `source` is INTEGRATION with the note that names
// which integration — the same pair the importer writes, so one query finds
// events from either and a human reading the timeline can tell this was not a
// click.
let written = 0
for (const row of live) {
  const at = dateFor(row)
  if (at === null) continue

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO "LoadStatusEvent"
         (id, "loadId", "organizationId", axis, "fromStatus", "toStatus",
          outcome, source, "occurredAt", note)
       VALUES ($1, $2, $3, 'OPERATIONAL', $4, 'POD_RECEIVED',
               'APPLIED', 'INTEGRATION', $5, $6)`,
      [
        randomUUID(),
        row.id,
        row.organizationId,
        row.operational,
        at,
        'datatruck-import repair',
      ],
    )
    if (row.operational !== 'POD_RECEIVED') {
      await client.query(
        `UPDATE "Load" SET "operationalStatus" = 'POD_RECEIVED', "updatedAt" = now()
          WHERE id = $1`,
        [row.id],
      )
    }
    await client.query('COMMIT')
    written++
  } catch (error) {
    await client.query('ROLLBACK')
    console.error(`  ${row.loadNumber}: ${error.message}`)
  } finally {
    client.release()
  }
}

console.log('')
console.log(`${written} load(s) now carry a POD event dated by their freight.`)
console.log('Re-run the settlement week preflight to see what changed.')

await pool.end()
