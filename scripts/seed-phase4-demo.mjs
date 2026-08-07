import { neonConfig, Pool } from '@neondatabase/serverless'

// ---------------------------------------------------------------------------
// DEMO ROWS FOR THE PHASE 4 SCREENS, on the dev branch.
//
// A screen photographed over zero rows proves only that it compiles. Step 2
// learned that with the compliance panel and seeded four records to shoot it
// properly; this does the same for the four screens Phase 4 added after it —
// maintenance, inspections, claims and the documents browser.
//
// IDEMPOTENT. Every row carries the same fixed ids, so running it twice
// changes nothing. That matters because the screenshot run and the acceptance
// run both want the data there, and neither should have to know whether the
// other went first.
//
// DEV ONLY, and it refuses to run anywhere else: it writes rows that exist to
// be photographed, and production's numbers are the owner's.
//
//   node -r dotenv/config scripts/seed-phase4-demo.mjs
// ---------------------------------------------------------------------------

if (process.env.NEON_BRANCH === 'production') {
  console.error('This seeds demo rows. Not on production.')
  process.exit(1)
}

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false
const pool = new Pool({ connectionString: process.env.DIRECT_DATABASE_URL })

/** Fixed, so a second run is a no-op rather than a second set of rows. */
const ID = {
  trailer: 'cdemotrailer0000000000001',
  trailerPeriod: 'cdemoperiod00000000000001',
  maint1: 'cdemomaint00000000000001a',
  maint2: 'cdemomaint00000000000002b',
  maint3: 'cdemomaint00000000000003c',
  inspClean: 'cdemoinspect000000000001a',
  inspOos: 'cdemoinspect000000000002b',
  viol1: 'cdemoviolation0000000001a',
  viol2: 'cdemoviolation0000000002b',
  dataqs: 'cdemodataqs00000000000001',
  claimCargo: 'cdemoclaim0000000000001a',
  claimWreck: 'cdemoclaim0000000000002b',
  party1: 'cdemoparty0000000000001a',
  party2: 'cdemoparty0000000000002b',
  note1: 'cdemonote00000000000001a',
  note2: 'cdemonote00000000000002b',
  note3: 'cdemonote00000000000003c',
}

const org = (
  await pool.query(
    `select m."organizationId" id from "Membership" m
       join "User" u on u.id = m."userId" where u.email = $1 limit 1`,
    [process.env.SEED_OWNER_EMAIL],
  )
).rows[0]

if (!org) {
  console.error('No organization for SEED_OWNER_EMAIL. Nothing to seed.')
  process.exit(1)
}

// THE TRUCK DECIDES THE AUTHORITY, not the alphabet. Step 2 seeded against the
// alphabetically first company in the whole table — which was the isolation
// counterpart in another organization — and every screenshot came back 404
// with RLS doing exactly its job.
const truck = (
  await pool.query(
    `select t.id, t."companyId" from "Truck" t
      where t."organizationId" = $1 and t."deletedAt" is null
      order by t."createdAt" asc limit 1`,
    [org.id],
  )
).rows[0]

if (!truck) {
  console.error('No truck in this organization. Seed one first.')
  process.exit(1)
}

const driver = (
  await pool.query(
    `select id from "Driver" where "organizationId" = $1 and "companyId" = $2
       and "deletedAt" is null order by "createdAt" asc limit 1`,
    [org.id, truck.companyId],
  )
).rows[0]

const load = (
  await pool.query(
    `select id from "Load" where "organizationId" = $1 and "companyId" = $2
      order by "createdAt" desc limit 1`,
    [org.id, truck.companyId],
  )
).rows[0]

const base = [org.id, truck.companyId]
const done = []

const put = async (label, sql, params) => {
  await pool.query(sql, params)
  done.push(label)
}

// --- a trailer to service ----------------------------------------------------
await put(
  'trailer R-2214',
  `insert into "Trailer" (id, "organizationId", "companyId", "unitNumber", type, year, "updatedAt")
     values ($3, $1, $2, 'R-2214', 'REEFER', 2019, now())
   on conflict (id) do nothing`,
  [...base, ID.trailer],
)

// AND ITS OPEN AUTHORITY PERIOD. A live asset with a `companyId` and no open
// AssetAssignment is precisely the disagreement `findAuthorityDrift` exists to
// catch, and `npm run check` fails on it — which is what this script did on its
// first run. The verify scripts already carry this note; a seed needs it too.
await put(
  'trailer authority period',
  `insert into "AssetAssignment" (id, "organizationId", "companyId", "trailerId", "effectiveFrom")
     values ($3, $1, $2, $4, now() - interval '400 days')
   on conflict (id) do nothing`,
  [...base, ID.trailerPeriod, ID.trailer],
)

// --- work orders, with odometers so the per-mile figure has a span ----------
const workOrder = (id, days, category, description, vendor, odometer, cents) =>
  put(
    `work order ${category}`,
    `insert into "MaintenanceRecord"
       (id, "organizationId", "companyId", "truckId", "servicedAt", category,
        description, "vendorName", odometer, "costCents", "updatedAt")
       values ($3, $1, $2, $4, now() - ($5 || ' days')::interval, $6, $7, $8, $9, $10, now())
     on conflict (id) do nothing`,
    [
      ...base,
      id,
      truck.id,
      String(days),
      category,
      description,
      vendor,
      odometer,
      cents,
    ],
  )

await workOrder(
  ID.maint1,
  96,
  'PREVENTIVE',
  'PM A — oil, filters, chassis lube',
  'Gary Truck Service',
  400_000,
  42_950,
)
await workOrder(
  ID.maint2,
  41,
  'TIRES',
  'Two steer tires, mount and balance',
  'Loves Tire Care',
  406_500,
  118_000,
)
await workOrder(
  ID.maint3,
  4,
  'BRAKES',
  'Steer axle brake job, drums and shoes',
  'Gary Truck Service',
  412_000,
  184_000,
)

// --- inspections -------------------------------------------------------------
await put(
  'clean inspection',
  `insert into "RoadsideInspection"
     (id, "organizationId", "companyId", "truckId", "driverId", "inspectedAt",
      level, state, "reportNumber", location, "updatedAt")
     values ($3, $1, $2, $4, $5, now() - interval '58 days', 'LEVEL_2', 'OH',
             'OH2600881204', 'Ohio Turnpike, milepost 142', now())
   on conflict (id) do nothing`,
  [...base, ID.inspClean, truck.id, driver?.id ?? null],
)

await put(
  'out-of-service inspection',
  `insert into "RoadsideInspection"
     (id, "organizationId", "companyId", "truckId", "driverId", "inspectedAt",
      level, state, "reportNumber", location, "inspectorName", "updatedAt")
     values ($3, $1, $2, $4, $5, now() - interval '12 days', 'LEVEL_1', 'IN',
             'IN2601447733', 'Gary weigh station', 'Insp. R. Meyers', now())
   on conflict (id) do nothing`,
  [...base, ID.inspOos, truck.id, driver?.id ?? null],
)

const violation = (id, code, description, unit, oos, weight) =>
  put(
    `violation ${code}`,
    `insert into "InspectionViolation"
       (id, "organizationId", "inspectionId", code, description, unit,
        "outOfService", "severityWeight", "updatedAt")
       values ($2, $1, $3, $4, $5, $6, $7, $8, now())
     on conflict (id) do nothing`,
    [org.id, id, ID.inspOos, code, description, unit, oos, weight],
  )

await violation(
  ID.viol1,
  '393.75A3',
  'Tire — flat or audible air leak',
  'VEHICLE',
  true,
  8,
)
await violation(
  ID.viol2,
  '392.2C',
  'Failure to obey traffic control device',
  'DRIVER',
  false,
  5,
)

// --- a DataQs challenge, filed and waiting -----------------------------------
await put(
  'DataQs challenge',
  `insert into "DataQsChallenge"
     (id, "organizationId", "companyId", "inspectionId", "violationId", status,
      basis, "referenceNumber", "submittedAt", "updatedAt")
     values ($3, $1, $2, $4, $5, 'UNDER_REVIEW',
             'The tire was on a trailer we had already dropped at the consignee. Photographs and the interchange receipt attached.',
             'RDR-2026-114882', now() - interval '9 days', now())
   on conflict (id) do nothing`,
  [...base, ID.dataqs, ID.inspOos, ID.viol1],
)

// --- claims ------------------------------------------------------------------
await put(
  'cargo claim',
  `insert into "Claim"
     (id, "organizationId", "companyId", "loadId", type, "claimNumber",
      "claimantName", status, "incidentAt", "amountClaimedCents", description,
      "updatedAt")
     values ($3, $1, $2, $4, 'CARGO_DAMAGE', 'MW-88213', 'Midwest Grocers',
             'DISPUTED', now() - interval '23 days', 412500,
             'Two pallets crushed against the trailer wall. Consignee refused them and noted the damage on the delivery receipt.',
             now())
   on conflict (id) do nothing`,
  [...base, ID.claimCargo, load?.id ?? null],
)

// The one that shows §6 flag 15's columns doing their job.
await put(
  'accident claim',
  `insert into "Claim"
     (id, "organizationId", "companyId", "truckId", "driverId", type,
      "claimantName", status, "incidentAt", "amountClaimedCents",
      "amountPaidCents", description, resolution, "updatedAt")
     values ($3, $1, $2, $4, $5, 'ACCIDENT', 'Ohio Turnpike Commission',
             'RESOLVED', now() - interval '71 days', 285000, 285000,
             'Backed into a dock plate while empty. No injuries, no third party.',
             'Paid in full from the physical damage policy.', now())
   on conflict (id) do nothing`,
  [...base, ID.claimWreck, truck.id, driver?.id ?? null],
)

const party = (id, role, name, phone, reference) =>
  put(
    `party ${role}`,
    `insert into "ClaimParty" (id, "organizationId", "claimId", role, name, phone, reference, "updatedAt")
       values ($2, $1, $3, $4, $5, $6, $7, now())
     on conflict (id) do nothing`,
    [org.id, id, ID.claimCargo, role, name, phone, reference],
  )

await party(
  ID.party1,
  'CLAIMANT',
  'Midwest Grocers',
  '312-555-0117',
  'MW-88213',
)
await party(
  ID.party2,
  'ADJUSTER',
  'Sentry Claims — J. Whitfield',
  '800-555-0142',
  'SEN-4471902',
)

const note = (id, days, body, from, to) =>
  put(
    'timeline row',
    `insert into "ClaimNote" (id, "organizationId", "claimId", body, "fromStatus", "toStatus", "createdAt")
       values ($2, $1, $3, $4, $5, $6, now() - ($7 || ' days')::interval)
     on conflict (id) do nothing`,
    [org.id, id, ID.claimCargo, body, from, to, String(days)],
  )

await note(
  ID.note1,
  23,
  'Two pallets crushed against the trailer wall. Consignee refused them and noted the damage on the delivery receipt.',
  null,
  'OPEN',
)
await note(
  ID.note2,
  16,
  'Photographs and the signed delivery receipt sent to the adjuster.',
  null,
  null,
)
await note(
  ID.note3,
  9,
  'They say the load was not blocked and braced. The rate confirmation says driver-loaded, sealed.',
  'OPEN',
  'DISPUTED',
)

console.log(`seeded ${done.length} rows on truck ${truck.id}`)
console.log(`  authority ${truck.companyId}`)
console.log(`  driver    ${driver?.id ?? '(none)'}`)
console.log(`  inspection ${ID.inspOos}`)
console.log(`  claim      ${ID.claimCargo}`)

await pool.end()
