import { neonConfig } from '@neondatabase/serverless'
import { createPrismaClient } from '@/lib/db'
import { runInOrg } from '@/lib/tenancy'
import { unattributed } from '@/lib/audit'
import {
  finaliseBatch,
  SETTLEMENT_BATCH_TIMEOUT_MS,
} from '@/lib/settlement-batch'
import { isPlaceholderNumber } from '@/lib/settlement-number'
import { assertTenancy } from './datatruck-tenancy'

// ---------------------------------------------------------------------------
// FINALISE ONE BATCH ON DEV.
//
//   npx tsx -r dotenv/config scripts/finalise-batch.ts --batch SB-000001
//   npx tsx -r dotenv/config scripts/finalise-batch.ts --batch SB-000001 --apply
//
// DEV ONLY. Owner's ruling, 2026-09-30: finalise SB-000001 and verify the
// statement PDF against one finalised and one draft statement.
//
// ── THIS IS NOT A SMALL BUTTON ────────────────────────────────────────────
//
// `finaliseBatch` refreshes the draft, mints a statement number for every
// settlement in it, flips them to APPROVED, and MOVES ESCROW — a
// `DriverEscrowEntry` per driver holding escrow, which is money leaving one
// ledger for another. Thirty-one settlements on SB-000001.
//
// So it runs through the real function rather than a hand-rolled update, the
// dry run is the real path rolled back, and it prints what changed per
// settlement rather than a count. A count would be the same output whether it
// numbered thirty-one statements or the same one thirty-one times.
//
// THE TIMEOUT IS THE BATCH'S OWN. One transaction over thirty-one settlements
// is exactly the shape that timed out at 61 seconds earlier in this project,
// which is why `SETTLEMENT_BATCH_TIMEOUT_MS` exists and is imported rather
// than guessed at here.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket

const args = process.argv.slice(2)
const at = args.indexOf('--batch')
const WANTED = at === -1 ? null : args[at + 1]
const APPLY = args.includes('--apply')

if (!WANTED) {
  console.error('usage: --batch SB-000001 [--apply]')
  process.exit(1)
}

class Rehearsal extends Error {}

const url = process.env.DIRECT_DATABASE_URL
if (!url) throw new Error('No DIRECT_DATABASE_URL.')
if (/prod/i.test(url)) throw new Error('That looks like production. Dev only.')

const db = createPrismaClient(url)
const tenancy = await assertTenancy(db, {
  label: 'DEV',
  host: new URL(url).hostname,
  slug: 'zebra',
  expectOrganizationId: null,
})

console.log('Target: DEV')
console.log(`Batch:  ${WANTED}`)
console.log(
  `Mode:   ${APPLY ? 'APPLY — writes commit' : 'dry run — rolls back'}`,
)

try {
  await runInOrg(
    db,
    tenancy.organizationId,
    async (tx) => {
      const batch = await tx.settlementBatch.findFirst({
        where: { batchNumber: WANTED, deletedAt: null },
        select: { id: true, status: true, periodStart: true, periodEnd: true },
      })
      if (!batch) throw new Error(`No batch numbered ${WANTED} on dev.`)
      console.log(
        `Period: ${batch.periodStart.toISOString().slice(0, 10)} — ` +
          `${batch.periodEnd.toISOString().slice(0, 10)}`,
      )
      console.log(`Status: ${batch.status}\n`)
      if (batch.status !== 'DRAFT') {
        throw new Error(
          `${WANTED} is ${batch.status}, not DRAFT. Nothing to do.`,
        )
      }

      // WHO FINALISED IT, on the batch row. `assertTenancy` names the
      // organization and not a person, so the actor is read here — the seed
      // owner, which is who would have pressed the button.
      const actor = await tx.user.findFirstOrThrow({
        where: { email: process.env.SEED_OWNER_EMAIL ?? undefined },
        select: { id: true, email: true },
      })
      console.log(`Actor:  ${actor.email}
`)

      const escrowBefore = await tx.driverEscrowEntry.count()

      const outcome = await finaliseBatch(tx, batch.id, actor.id)
      if (!outcome.ok) {
        throw new Error(
          `finaliseBatch refused: ${JSON.stringify(outcome.reason)}`,
        )
      }

      const after = await tx.settlement.findMany({
        where: { batchId: batch.id, deletedAt: null },
        orderBy: { settlementNumber: 'asc' },
        select: {
          settlementNumber: true,
          status: true,
          netCents: true,
          driver: { select: { firstName: true, lastName: true } },
        },
      })
      const escrowAfter = await tx.driverEscrowEntry.count()

      const unnamed = after.filter((row) =>
        isPlaceholderNumber(row.settlementNumber),
      )
      const notApproved = after.filter((row) => row.status !== 'APPROVED')

      console.log(`batch      ${outcome.batchNumber} -> FINAL`)
      console.log(`statements ${after.length}`)
      console.log(`  numbered ${after.length - unnamed.length}`)
      console.log(`  still an id ${unnamed.length}`)
      console.log(`  APPROVED ${after.length - notApproved.length}`)
      console.log(`escrow rows ${escrowBefore} -> ${escrowAfter}`)
      console.log('')
      for (const row of after.slice(0, 5)) {
        console.log(
          `  ${row.settlementNumber.padEnd(12)} ${row.status.padEnd(9)} ` +
            `${row.driver.firstName} ${row.driver.lastName}  ` +
            `net ${(row.netCents / 100).toFixed(2)}`,
        )
      }
      if (after.length > 5) console.log(`  ... and ${after.length - 5} more`)

      // THE INVARIANT THIS BATCH EXISTS TO EXERCISE. Owner's ruling of
      // 2026-09-30: nothing out of DRAFT keeps a placeholder.
      if (unnamed.length > 0 || notApproved.length > 0) {
        throw new Error('Some settlement is unnamed or not APPROVED. Refusing.')
      }

      if (!APPLY) throw new Rehearsal()
    },
    {
      timeoutMs: SETTLEMENT_BATCH_TIMEOUT_MS,
      attribution: unattributed(
        'scripts/finalise-batch.ts — owner ruling 2026-09-30, finalise ' +
          'SB-000001 on dev to verify the statement PDF end to end',
      ),
    },
  )
  console.log('\nCOMMITTED.')
} catch (error) {
  if (!(error instanceof Rehearsal)) throw error
  console.log('\nROLLED BACK — dry run. Re-run with --apply to write.')
}

await db.$disconnect()
