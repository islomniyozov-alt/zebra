import { neonConfig } from '@neondatabase/serverless'
import { createPrismaClient } from '@/lib/db'

// ---------------------------------------------------------------------------
// UNDO WHAT THE TRUCKS SEED WROTE ONTO THE WRONG 1024.
//
//   npx tsx -r dotenv/config scripts/repair-1024-plate-and-compliance.ts --production
//   npx tsx -r dotenv/config scripts/repair-1024-plate-and-compliance.ts --production --apply
//
// Production carries two trucks numbered `1024`: the real RAM Haulage Volvo
// (`4V4NC9EH7LN210302`) and a hand-made Dolphins row with `WW2020` where a VIN
// belongs. `seed-datatruck-all-trucks.ts` resolved a unit by taking `[0]` of
// the matches — an order Postgres never promised — and on 2026-09-09 at 19:42
// that was the hand-made row. It received:
//
//   * `plate` and `plateState` copied from the REAL truck's registration,
//     over two columns that were null;
//   * a REGISTRATION compliance item, duplicated two minutes later onto the
//     real truck by the next run.
//
// The seed now refuses an ambiguous unit outright. This undoes the rows that
// were already written, and nothing else.
//
// ── WHY IT IS TARGETED RATHER THAN GENERAL ───────────────────────────────
//
// It names ONE truck by id and ONE item by id. A script that searched for
// "trucks with a plate that matches another truck" would be a rule, and a rule
// invented to describe one accident is a rule nobody can check. Both ids are
// in the report that found them.
//
// ── IT ASSERTS BEFORE IT WRITES ──────────────────────────────────────────
//
// The truck must still be the hand-made one — `WW2020`, Dolphins Transport,
// unit 1024, no loads — and the compliance item must still belong to it. Any
// disagreement refuses: the row may have been corrected by hand since, and
// this script has no business overwriting that.
//
// Dry run by default. `--apply` is a second decision. A second run finds the
// columns already null and the item already gone, and does nothing.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

const APPLY = process.argv.includes('--apply')
const PRODUCTION = process.argv.includes('--production')

/** Stated by the owner who ran the migration ritual, not discovered here. */
const PRODUCTION_ORGANIZATION_ID = 'cmsbsc82y0000nsvsa6yffuyh'

/** The hand-made row, by id. Named in the report that found it. */
const TRUCK_ID = 'cmsduphdg0006psp7ej05vv9b'
const EXPECT_VIN = 'WW2020'
const EXPECT_UNIT = '1024'
const EXPECT_COMPANY = 'Dolphins Transport'

/** The compliance item that run wrote onto it. */
const ITEM_ID = 'cmtui9mg2000awkvs1hk7218i'

function target() {
  const url = PRODUCTION
    ? process.env.PROD_DIRECT_DATABASE_URL
    : process.env.DIRECT_DATABASE_URL
  if (!url) throw new Error('No connection string for that target.')
  return { url, label: PRODUCTION ? 'PRODUCTION' : 'DEV' }
}

async function main(): Promise<void> {
  const where = target()
  const db = createPrismaClient(where.url)
  console.log(`target  ${where.label} (${new URL(where.url).hostname})`)
  console.log(`mode    ${APPLY ? 'APPLY' : 'dry run'}\n`)

  try {
    const truck = await db.truck.findUnique({
      where: { id: TRUCK_ID },
      select: {
        id: true,
        organizationId: true,
        unitNumber: true,
        vin: true,
        plate: true,
        plateState: true,
        company: { select: { name: true } },
        loads: { select: { id: true }, take: 1 },
        complianceItems: {
          where: { deletedAt: null },
          select: { id: true, type: true, expiresAt: true },
        },
      },
    })

    if (!truck) {
      console.log('That truck id is not here. Nothing to do.')
      return
    }

    // ── THE ASSERTIONS, ALL OF THEM, BEFORE ANYTHING IS WRITTEN ─────────
    const problems: string[] = []
    if (PRODUCTION && truck.organizationId !== PRODUCTION_ORGANIZATION_ID) {
      problems.push(`organization is ${truck.organizationId}`)
    }
    if (truck.unitNumber !== EXPECT_UNIT) {
      problems.push(`unit is ${JSON.stringify(truck.unitNumber)}`)
    }
    if (truck.vin !== EXPECT_VIN)
      problems.push(`vin is ${JSON.stringify(truck.vin)}`)
    if (truck.company.name !== EXPECT_COMPANY) {
      problems.push(`company is ${JSON.stringify(truck.company.name)}`)
    }
    if (truck.loads.length > 0) problems.push('it now has loads')

    console.log(`  unit ${truck.unitNumber}  ${truck.company.name}`)
    console.log(`    id          ${truck.id}`)
    console.log(`    vin         ${JSON.stringify(truck.vin)}`)
    console.log(
      `    plate       ${JSON.stringify(truck.plate)} ${truck.plateState ?? ''}`,
    )
    console.log(`    loads       ${truck.loads.length}`)
    for (const item of truck.complianceItems) {
      console.log(
        `    item        ${item.id} ${item.type} ${item.expiresAt.toISOString().slice(0, 10)}`,
      )
    }

    if (problems.length > 0) {
      console.log(`\nREFUSED: ${problems.join('; ')}.`)
      console.log('This is not the row the report described. Nothing written.')
      return
    }

    const clearsPlate = truck.plate !== null || truck.plateState !== null
    const item = truck.complianceItems.find((row) => row.id === ITEM_ID)

    console.log('\n  what this would undo:')
    console.log(
      `    plate/plateState  ${clearsPlate ? `${JSON.stringify(truck.plate)} ${truck.plateState ?? ''} -> null` : 'already null'}`,
    )
    console.log(
      `    compliance item   ${item ? `${ITEM_ID} -> soft-deleted` : 'already gone'}`,
    )

    if (!clearsPlate && !item) {
      console.log('\nNothing to undo. This has already been repaired.')
      return
    }
    if (!APPLY) {
      console.log('\nNothing was written. Re-run with --apply.')
      return
    }

    if (clearsPlate) {
      await db.truck.update({
        where: { id: truck.id },
        data: { plate: null, plateState: null },
      })
      console.log('\n  plate and plateState set back to null')
    }
    if (item) {
      // SOFT, like every other removal in this migration: the row stays and
      // `deletedAt` says it is gone, so a wrong repair is reversible.
      await db.complianceItem.update({
        where: { id: item.id },
        data: { deletedAt: new Date() },
      })
      console.log(`  compliance item ${item.id} soft-deleted`)
    }
  } finally {
    await db.$disconnect()
  }
}

await main()
