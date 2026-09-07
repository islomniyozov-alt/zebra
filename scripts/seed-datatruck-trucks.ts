import { neonConfig } from '@neondatabase/serverless'
import { readFileSync } from 'node:fs'
import { createPrismaClient } from '@/lib/db'
import { asRecords, readXlsx } from '@/lib/datatruck/xlsx'
import { planTrucks, type PlannedTruck } from '@/lib/datatruck/trucks'
import { openFirstPeriod } from '@/lib/asset-transfer'
import type { TxClient } from '@/lib/tenancy'
import type { PrismaClient } from '../src/generated/prisma/client'

// ---------------------------------------------------------------------------
// 49 REAL TRUCKS, OUT OF DATATRUCK AND INTO ZEBRA.
//
//   npx tsx -r dotenv/config scripts/seed-datatruck-trucks.ts            (preview)
//   npx tsx -r dotenv/config scripts/seed-datatruck-trucks.ts --write    (writes)
//
// PREVIEW IS THE DEFAULT AND WRITING TAKES A FLAG. Everything this seed does
// to a value — a make spelled out, a state name resolved, a keyboard-walk VIN
// dropped — prints in the preview with the unit number beside it, so the list
// of rewrites is read and agreed to before any of them lands. A seed whose
// only output is "49 trucks created" has hidden exactly the part worth
// checking.
//
// IT READS THE RAW EXPORT. Not a cleaned CSV: a hand-cleaned intermediate is a
// second artefact that drifts from the file it came from, and this session
// already spent a turn on a summary that disagreed with its source. The reader
// is `src/lib/datatruck/xlsx.ts` and it carries no dependency.
//
// IDEMPOTENT ON (company, unit number), which is the partial unique index the
// schema already enforces — `truck_unit_per_company`, WHERE deletedAt IS NULL.
// Re-running updates the fields it manages and creates nothing twice. It is
// NOT expressed as a Prisma upsert because Prisma cannot address a partial
// index; the lookup is explicit and filters `deletedAt: null` itself.
//
// FIELDS A HUMAN MAY HAVE EDITED SINCE ARE NOT OVERWRITTEN BLIND. A re-run
// reports what it would change and changes only what is still empty, unless
// --overwrite says otherwise. The export is a starting point, not a master:
// once a dispatcher fixes a VIN in Zebra, the next run of this script must not
// put the keyboard walk back.
//
// RUNS AS THE DATABASE OWNER over DIRECT_DATABASE_URL, like `prisma/seed.ts`,
// because it writes for an organization it is not a member of. That role
// bypasses row-level security, which is why this is a script a human runs at a
// named branch and never anything the application calls.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

const DEFAULT_EXPORT = 'corpus/datatruck/trucks_2026_09_04_15_56_32.xlsx'

const WRITE = process.argv.includes('--write')
const OVERWRITE = process.argv.includes('--overwrite')
const FILE =
  process.argv.find((argument) => argument.endsWith('.xlsx')) ?? DEFAULT_EXPORT

const ORGANIZATION_SLUG = 'zebra'

/**
 * When this fleet's recorded history begins in Zebra.
 *
 * THE SAME STATED DATE THE DRIVER PAY RULES USE, and for the same reason: a
 * fixed date somebody decided, never the moment the script happened to run.
 * Re-running the seed a month from now must not move the fleet's history.
 */
const ASSET_HISTORY_FROM = new Date('2026-08-01T00:00:00.000Z')

/** The columns this seed owns. Anything else on a Truck row is left alone. */
const MANAGED = ['vin', 'make', 'model', 'year', 'plate', 'plateState'] as const
type Managed = (typeof MANAGED)[number]

function heading(text: string): void {
  console.log(`\n${text}`)
  console.log('─'.repeat(Math.max(text.length, 60)))
}

function preview(planned: readonly PlannedTruck[]): void {
  heading('COUNTS')
  const byAuthority = new Map<string, number>()
  for (const truck of planned) {
    byAuthority.set(
      truck.authority,
      (byAuthority.get(truck.authority) ?? 0) + 1,
    )
  }
  for (const [authority, count] of [...byAuthority].sort()) {
    console.log(`  ${String(count).padStart(3)}  ${authority}`)
  }
  console.log(`  ${String(planned.length).padStart(3)}  total to seed`)

  const missing = (key: Managed) =>
    planned.filter((truck) => truck[key] === null).length
  console.log('')
  for (const key of MANAGED) {
    const absent = missing(key)
    console.log(
      `  ${key.padEnd(12)} present on ${String(planned.length - absent).padStart(2)}/${planned.length}` +
        (absent ? `, null on ${absent}` : ''),
    )
  }

  const corrected = planned.filter((truck) => truck.corrections.length > 0)
  heading(`REWRITES — ${corrected.length} rows, every one of them`)
  for (const truck of corrected) {
    for (const note of truck.corrections) {
      console.log(`  unit ${truck.unitNumber.padEnd(6)} ${note}`)
    }
  }
}

/**
 * What a re-run would change on a row somebody may have edited.
 *
 * NULL IN THE PLAN NEVER CLEARS A VALUE. The export's blanks are absences, not
 * instructions — a VIN typed into Zebra after the export was taken is better
 * data than the export has, and a seed that pushed null over it would delete
 * the correction every time it ran.
 */
function changesFor(
  existing: Record<string, unknown>,
  planned: PlannedTruck,
): Partial<Pick<PlannedTruck, Managed>> {
  // Keyed off `PlannedTruck` rather than a widened value type, so `year` stays
  // a number and `vin` a string all the way into `truck.update`. A
  // `string | number` union here type-checks against nothing downstream.
  const changes: Partial<Pick<PlannedTruck, Managed>> = {}
  for (const key of MANAGED) {
    const next = planned[key]
    if (next === null) continue
    const current = existing[key] ?? null
    if (current === next) continue
    if (current !== null && !OVERWRITE) continue
    Object.assign(changes, { [key]: next })
  }
  return changes
}

async function write(db: PrismaClient, plan: PlannedTruck[]): Promise<void> {
  const organization = await db.organization.findUnique({
    where: { slug: ORGANIZATION_SLUG },
    select: { id: true },
  })
  if (!organization) {
    throw new Error(
      `No organization with slug ${ORGANIZATION_SLUG}. Run \`npm run db:seed\` first.`,
    )
  }

  const companies = await db.company.findMany({
    where: { organizationId: organization.id },
    select: { id: true, name: true },
  })
  const companyByName = new Map(companies.map((c) => [c.name, c.id]))

  // NAMED BEFORE ANY WRITE. An authority the plan expects and the database
  // does not have would otherwise fail on the first row and leave the rest of
  // the fleet half-seeded.
  const unknown = [...new Set(plan.map((truck) => truck.authority))].filter(
    (name) => !companyByName.has(name),
  )
  if (unknown.length > 0) {
    throw new Error(
      `These authorities are not in the database: ${unknown.join(', ')}. ` +
        `It holds: ${companies.map((c) => c.name).join(', ')}.`,
    )
  }

  let created = 0
  let updated = 0
  let unchanged = 0
  let periodsOpened = 0

  for (const truck of plan) {
    const companyId = companyByName.get(truck.authority)!

    const existing = await db.truck.findFirst({
      where: { companyId, unitNumber: truck.unitNumber, deletedAt: null },
    })

    if (!existing) {
      const row = await db.truck.create({
        data: {
          organizationId: organization.id,
          companyId,
          unitNumber: truck.unitNumber,
          vin: truck.vin,
          make: truck.make,
          model: truck.model,
          year: truck.year,
          plate: truck.plate,
          plateState: truck.plateState,
          // STATUS IS NOT IMPORTED. The export says 9 trucks are in_transit;
          // Zebra's TruckStatus is what dispatch sets, and a truck seeded
          // IN_TRANSIT with no load behind it is a vehicle the board claims is
          // moving while nothing moves it. Every truck arrives AVAILABLE — the
          // schema default — and the nine are named in the report so a
          // dispatcher can set them from the freight that is actually running.
          //
          // OWNERSHIP IS NOT IMPORTED EITHER: `Owner name` is blank on all 49,
          // so there is nothing to read, and OWNED is the schema's default.
        },
      })

      // ── THE HISTORY HAS TO START WHERE THE ASSET DOES ───────────────────
      //
      // A truck with a `companyId` and no open `AssetAssignment` is drift by
      // the definition in `asset-transfer.ts`, and `findAuthorityDrift` says
      // so: a missing period means somebody wrote a row around the service
      // layer, which is exactly what a seed doing a bare `truck.create` is.
      //
      // The first run of this script did precisely that and `npm run check`
      // caught all 46 — which is the whole reason that backstop exists.
      //
      // DATED `ASSET_HISTORY_FROM`, NOT NOW. These trucks did not start
      // working the afternoon the import ran. Dating them by the seed's own
      // clock would make "which authority ran unit 105 in August" answer with
      // the import date, forever.
      await openFirstPeriod(
        db as unknown as TxClient,
        organization.id,
        companyId,
        { truckId: row.id },
        null,
        ASSET_HISTORY_FROM,
      )

      created++
      console.log(`  created  unit ${truck.unitNumber}  ${truck.authority}`)
      continue
    }

    // A TRUCK THAT EXISTS BUT HAS NO OPEN PERIOD IS REPAIRED, NOT SKIPPED.
    // The first run of this seed created 46 trucks without one; this is what
    // makes the second run fix them rather than needing a separate script.
    // Idempotent by the same partial unique index that governs the truck.
    const open = await db.assetAssignment.findFirst({
      where: { truckId: existing.id, effectiveTo: null },
      select: { id: true },
    })
    if (!open) {
      await openFirstPeriod(
        db as unknown as TxClient,
        organization.id,
        companyId,
        { truckId: existing.id },
        null,
        ASSET_HISTORY_FROM,
      )
      periodsOpened++
      console.log(`  history  unit ${truck.unitNumber}  opened from 2026-08-01`)
    }

    const changes = changesFor(
      existing as unknown as Record<string, unknown>,
      truck,
    )
    if (Object.keys(changes).length === 0) {
      unchanged++
      continue
    }
    await db.truck.update({ where: { id: existing.id }, data: changes })
    updated++
    console.log(
      `  updated  unit ${truck.unitNumber}  ${Object.entries(changes)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join(' ')}`,
    )
  }

  heading('WRITTEN')
  console.log(
    `  ${created} created, ${updated} updated, ${unchanged} unchanged`,
  )
  console.log(
    `  ${created + periodsOpened} asset-history periods opened from 2026-08-01` +
      (periodsOpened ? ` (${periodsOpened} repairing an existing row)` : ''),
  )
}

async function main(): Promise<void> {
  const branch = process.env.NEON_BRANCH ?? '(unnamed)'
  const bytes = new Uint8Array(readFileSync(FILE))
  const records = asRecords(await readXlsx(bytes))
  const plan = planTrucks(records)

  console.log(`export  ${FILE} (${bytes.length} bytes, ${plan.read} data rows)`)
  console.log(`branch  ${branch}`)
  console.log(`mode    ${WRITE ? 'WRITE' : 'preview only'}`)

  preview(plan.planned)

  heading(`HELD — ${plan.held.length} rows this seed will not write`)
  for (const truck of plan.held) {
    console.log(`  unit ${truck.unitNumber.padEnd(6)} ${truck.reason}`)
    console.log(`         ${truck.detail}`)
  }

  heading('NOT IMPORTED, ON PURPOSE')
  console.log('  Odometer      47 of 49 rows read 0; the other two read 385.99')
  console.log('                and 136.2. The column holds nothing.')
  console.log('  Status        9 rows say in_transit. Zebra sets truck status')
  console.log(
    '                from dispatch; seeding it invents a moving truck.',
  )
  console.log(
    '  Warnings      expired registration and insurance dates, derived',
  )
  console.log(
    '                by Datatruck. Real, and only ever listing what is',
  )
  console.log(
    '                ALREADY expired — seeding compliance from it would',
  )
  console.log('                build a table whose every row is a breach.')
  console.log('  Owner name    blank on all 49.')
  console.log('  Trailer       blank on all 49. The operation is power-only.')
  console.log('  Operator      not a person on every row ("TJK logistic" is a')
  console.log(
    '                company); driver links come from the drivers seed.',
  )

  if (!WRITE) {
    heading('NOTHING WAS WRITTEN')
    console.log('  Re-run with --write once the rewrites above are agreed.')
    return
  }

  const url = process.env.DIRECT_DATABASE_URL
  if (!url) throw new Error('DIRECT_DATABASE_URL is not set.')
  const db = createPrismaClient(url)
  try {
    await write(db, plan.planned)
  } finally {
    await db.$disconnect()
  }
}

await main()
