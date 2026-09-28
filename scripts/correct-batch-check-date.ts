import { neonConfig } from '@neondatabase/serverless'
import { createPrismaClient } from '@/lib/db'
import {
  SETTLEMENT_BATCH_TIMEOUT_MS,
  refreshDraft,
} from '@/lib/settlement-batch'
import { checkDateFor } from '@/lib/settlement-week'
import { assertTenancy } from './datatruck-tenancy'

// ---------------------------------------------------------------------------
// PUT AN ALREADY-OPEN BATCH'S CHECK DATE BACK ON THE CADENCE.
//
//   npx tsx -r dotenv/config scripts/correct-batch-check-date.ts \
//     --batch cmuga82ji0000qkvslwyibodv
//   ... --apply
//   ... --production
//
// Owner's ruling, 2026-09-28. `openBatch` derives the check date now, but a
// batch opened before that keeps whatever it was given, and one was given the
// wrong thing: cmuga82ji0000qkvslwyibodv covers Sep 13-19 with a check date of
// 2026-09-25. Period end 9/19 + 13 is 2026-10-02. 9/25 is period end + 6, the
// shape of the Check Date Datatruck PRINTS and MONEY-DESIGN §0 forbids copying.
//
// ── IT TAKES NO DATE ──────────────────────────────────────────────────────
//
// The whole point of the ruling is that this value is not typed. A repair
// script with a `--check` flag would be the deleted field growing back in a
// place nobody looks, so the only input is WHICH batch; the value comes from
// `checkDateFor`, the same function the create calls.
//
// ── AND IT ONLY EVER TOUCHES A DRAFT ──────────────────────────────────────
//
// FINAL freezes the statement, and the check date is printed on it. Changing a
// date somebody has already been handed is not a correction, it is a second
// version of a document that exists on paper — so this REFUSES anything that is
// not DRAFT and says which state it found. A FINAL batch with a wrong check date
// is a conversation, not a script.
//
// ── DRY RUN BY DEFAULT, AND IT REFRESHES ──────────────────────────────────
//
// Without `--apply` the transaction rolls back, having printed the before and
// after. With it, the draft is refreshed afterwards, because `payoutDate` per
// driver is computed from the batch's check date (`payoutDateFor`) and the lines
// already written hold the old one. Changing the column and leaving the
// settlements alone would put two different pay dates in one batch, which is
// worse than the single wrong one it started with.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

const APPLY = process.argv.includes('--apply')
const PRODUCTION = process.argv.includes('--production')

const arg = (name: string): string | null => {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? null : (process.argv[at + 1] ?? null)
}

const ORGANIZATION_SLUG = 'zebra'
const PRODUCTION_ORGANIZATION_ID = 'cmsbsc82y0000nsvsa6yffuyh'

class Rehearsal extends Error {}

function target() {
  const url = PRODUCTION
    ? process.env.PROD_DIRECT_DATABASE_URL
    : process.env.DIRECT_DATABASE_URL
  if (!url) throw new Error('No database url for that target.')
  return {
    url,
    label: PRODUCTION ? 'PRODUCTION' : 'DEV',
    host: new URL(url).hostname,
    expectOrganizationId: PRODUCTION ? PRODUCTION_ORGANIZATION_ID : null,
  }
}

const day = (at: Date) => at.toISOString().slice(0, 10)

async function main(): Promise<void> {
  const batchId = arg('batch')
  if (!batchId) throw new Error('--batch <id> is required.')
  if (process.argv.includes('--check')) {
    throw new Error(
      '--check is not accepted here either. The date comes from the period.',
    )
  }

  const where = target()
  const db = createPrismaClient(where.url)
  console.log(`Target: ${where.label}`)
  console.log(
    `Mode:   ${APPLY ? 'APPLY — writes commit' : 'dry run — rolls back'}`,
  )

  try {
    const tenancy = await assertTenancy(db, {
      label: where.label,
      host: where.host,
      slug: ORGANIZATION_SLUG,
      expectOrganizationId: where.expectOrganizationId,
    })

    await db
      .$transaction(
        async (tx) => {
          const batch = await tx.settlementBatch.findFirst({
            where: {
              id: batchId,
              organizationId: tenancy.organizationId,
              deletedAt: null,
            },
            select: {
              id: true,
              batchNumber: true,
              status: true,
              periodStart: true,
              periodEnd: true,
              statementDate: true,
              checkDate: true,
              _count: { select: { settlements: true } },
            },
          })
          if (!batch) throw new Error(`No such batch here: ${batchId}`)

          const period = { start: batch.periodStart, end: batch.periodEnd }
          const correct = checkDateFor(period)

          console.log(
            `\nbatch ${batch.batchNumber ?? batch.id} — ${batch.status}`,
          )
          console.log(`  period     ${day(period.start)} → ${day(period.end)}`)
          console.log(
            `  statement  ${day(batch.statementDate)} (an input, untouched)`,
          )
          console.log(`  check now  ${day(batch.checkDate)}`)
          console.log(`  derived    ${day(correct)}`)
          console.log(`  drivers    ${batch._count.settlements}`)

          const lagDays = Math.round(
            (batch.checkDate.getTime() - period.end.getTime()) / 86_400_000,
          )
          console.log(`  stored lag period end + ${lagDays} days`)

          if (batch.status !== 'DRAFT') {
            throw new Error(
              `Refusing: the batch is ${batch.status}, not DRAFT. A printed ` +
                'check date is not a script’s to change.',
            )
          }

          if (batch.checkDate.getTime() === correct.getTime()) {
            console.log('\nAlready on the cadence. Nothing to do.')
            if (!APPLY) throw new Rehearsal()
            return
          }

          await tx.settlementBatch.update({
            where: { id: batch.id },
            data: { checkDate: correct },
          })

          // AND THE LINES, because `payoutDate` is computed from this date per
          // driver and the ones already written hold the old one.
          const refreshed = await refreshDraft(tx, batch.id)
          if (!refreshed.ok) {
            throw new Error(
              `refreshDraft refused: ${JSON.stringify(refreshed.reason)}`,
            )
          }
          console.log(
            `\ncheck date ${day(batch.checkDate)} → ${day(correct)}, ` +
              `${refreshed.result.settlements.length} settlement(s) recomputed`,
          )

          if (!APPLY) throw new Rehearsal()
        },
        { timeout: SETTLEMENT_BATCH_TIMEOUT_MS },
      )
      .catch((error: unknown) => {
        if (!(error instanceof Rehearsal)) throw error
      })

    console.log(
      APPLY
        ? '\nAPPLIED.'
        : '\nROLLED BACK. Nothing was written; re-run with --apply.',
    )
  } finally {
    await db.$disconnect()
  }
}

await main()
