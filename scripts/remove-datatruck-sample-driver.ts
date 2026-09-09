import { neonConfig } from '@neondatabase/serverless'
import { createPrismaClient } from '@/lib/db'

// ---------------------------------------------------------------------------
// ONE ROW: DATATRUCK'S OWN TEST DRIVER, SOFT-DELETED.
//
//   npx tsx -r dotenv/config scripts/remove-datatruck-sample-driver.ts            (dry run)
//   npx tsx -r dotenv/config scripts/remove-datatruck-sample-driver.ts --production
//   npx tsx -r dotenv/config scripts/remove-datatruck-sample-driver.ts --production --apply
//
// `Sample Driver` — Driver ID 1, AG FREIGHT INC, CDL number "1" — arrived with
// the terminated-driver export and sat on the production driver list until the
// owner spotted it. `TEST_DATA` in `drivers.ts` stops a re-run bringing it
// back; this removes the row that is already there.
//
// ── SOFT, NOT HARD, AND THE DIFFERENCE IS DELIBERATE ─────────────────────
//
// `deletedAt` is reversible, it is the state the driver list already has a
// toggle for, and it leaves `(organizationId, externalId)` occupied — so even
// without the skip table, an import could not recreate the row under the same
// id. A hard delete would leave no residue and no way back; for a row nothing
// references, reversible is the better trade.
//
// ── IT COUNTS BEFORE IT TOUCHES ──────────────────────────────────────────
//
// Every table that can point at a driver is counted first and printed, and a
// non-zero count REFUSES the removal. The row was checked once by hand; a
// script that re-checks is what makes running it later safe, because "it had
// nothing attached last Tuesday" is not a fact about today.
//
// Dry run by default. `--apply` is a second decision. Running it twice changes
// nothing the second time — a row already soft-deleted is reported and left.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

const APPLY = process.argv.includes('--apply')
const PRODUCTION = process.argv.includes('--production')

/** Stated by the owner who ran the migration ritual, not discovered here. */
const PRODUCTION_ORGANIZATION_ID = 'cmsbsc82y0000nsvsa6yffuyh'

/** The pair, matching `TEST_DATA` in `drivers.ts`. Both must agree. */
const EXTERNAL_ID = '1'
const FIRST_NAME = 'Sample'
const LAST_NAME = 'Driver'

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
    const driver = await db.driver.findFirst({
      where: {
        externalId: EXTERNAL_ID,
        firstName: FIRST_NAME,
        lastName: LAST_NAME,
      },
      select: {
        id: true,
        organizationId: true,
        firstName: true,
        lastName: true,
        externalId: true,
        status: true,
        deletedAt: true,
        company: { select: { name: true } },
      },
    })

    if (!driver) {
      console.log('No row matches the stated name AND id. Nothing to do.')
      return
    }
    if (PRODUCTION && driver.organizationId !== PRODUCTION_ORGANIZATION_ID) {
      // The same refusal the seeds make. This connection is the database owner
      // and carries BYPASSRLS, so nothing downstream would catch a wrong tenant.
      throw new Error(
        `Row belongs to organization ${driver.organizationId}, not the expected ${PRODUCTION_ORGANIZATION_ID}.`,
      )
    }

    console.log(`  ${driver.firstName} ${driver.lastName}`)
    console.log(`    id          ${driver.id}`)
    console.log(`    externalId  ${driver.externalId}`)
    console.log(`    company     ${driver.company.name}`)
    console.log(`    status      ${driver.status}`)
    console.log(
      `    deletedAt   ${driver.deletedAt?.toISOString() ?? 'not deleted'}`,
    )

    if (driver.deletedAt) {
      console.log('\nAlready soft-deleted. Nothing to do.')
      return
    }

    // ── EVERY TABLE THAT POINTS AT A DRIVER ─────────────────────────────
    const counts: [string, number][] = [
      ['loads', await db.load.count({ where: { driverId: driver.id } })],
      [
        'load assignments',
        await db.loadAssignment.count({ where: { driverId: driver.id } }),
      ],
      [
        'settlements',
        await db.settlement.count({ where: { driverId: driver.id } }),
      ],
      [
        'pay rules',
        await db.driverPayRule.count({ where: { driverId: driver.id } }),
      ],
      [
        'compliance items',
        await db.complianceItem.count({ where: { driverId: driver.id } }),
      ],
      [
        'asset history',
        await db.assetAssignment.count({ where: { driverId: driver.id } }),
      ],
      [
        'documents',
        await db.document.count({ where: { driverId: driver.id } }),
      ],
      ['expenses', await db.expense.count({ where: { driverId: driver.id } })],
      [
        'fuel transactions',
        await db.fuelTransaction.count({ where: { driverId: driver.id } }),
      ],
      [
        'roadside inspections',
        await db.roadsideInspection.count({ where: { driverId: driver.id } }),
      ],
      ['claims', await db.claim.count({ where: { driverId: driver.id } })],
    ]

    console.log('\n  what points at it:')
    for (const [label, count] of counts) {
      console.log(`    ${label.padEnd(22)} ${count}`)
    }

    const attached = counts.filter(([, count]) => count > 0)
    if (attached.length > 0) {
      console.log(
        `\nREFUSED: ${attached.map(([l, c]) => `${c} ${l}`).join(', ')}.`,
      )
      console.log('This row has history. It is not the test row any more.')
      return
    }

    if (!APPLY) {
      console.log('\nNothing was written. Re-run with --apply to soft-delete.')
      return
    }

    await db.driver.update({
      where: { id: driver.id },
      data: { deletedAt: new Date() },
    })
    console.log('\nSoft-deleted. `deletedAt` set; the row and its id remain.')
  } finally {
    await db.$disconnect()
  }
}

await main()
