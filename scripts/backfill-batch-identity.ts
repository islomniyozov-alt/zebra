import { neonConfig } from '@neondatabase/serverless'
import { createPrismaClient } from '@/lib/db'
import {
  BATCH_SERIES,
  batchNumberOf,
  refreshDraft,
  SETTLEMENT_BATCH_TIMEOUT_MS,
} from '@/lib/settlement-batch'
import { checkDateFor } from '@/lib/settlement-week'
import { assertTenancy } from './datatruck-tenancy'

// ---------------------------------------------------------------------------
// GIVE THE EXISTING DRAFTS A NUMBER AND THE RIGHT CHECK DATE.
//
//   npx tsx -r dotenv/config scripts/backfill-batch-identity.ts
//   ... --apply
//
// Owner's rulings 3 and 4, 2026-09-28. Two facts about the same four rows, so
// one pass: a second script would mean reading them twice and refreshing twice.
//
// ── DEV ONLY, BY CONSTRUCTION ─────────────────────────────────────────────
//
// This file does not name the production connection variable at all — not even
// in a comment, because `tests/prod-url-guard.test.ts` reads each script as TEXT
// and a mention is indistinguishable from a read. So production is not reachable
// from here by forgetting a flag or pasting an old command, and this script
// needs no entry in that fence: there is nothing for it to hold.
//
// Ruling 4's own words are why that is safe to assert: dev's replayed drafts are
// "rehearsal rows, not history".
//
// ── NUMBERS GO BY PERIOD, OLDEST FIRST ────────────────────────────────────
//
// Ruling 3. `SB-000001` is the earliest week, so the sequence reads the way the
// weeks ran rather than the way somebody happened to open them — these four were
// all created within a minute of each other by a replay script, so `createdAt`
// would order them arbitrarily.
//
// THE COUNTER IS ADVANCED PAST WHAT IS ASSIGNED. `allocateSeries` is not used
// here — it hands out one at a time and these are being placed in a chosen order
// — so the `SeriesCounter` row is set afterwards to the highest number used. Not
// doing that would have the next `openBatch` hand out `SB-000001` again, to a
// different week, which is the one outcome worse than no number at all.
//
// ── AND THE CHECK DATE IS REDERIVED, NOT TYPED ────────────────────────────
//
// Ruling 4. `checkDateFor` — period end + 13 — the same function `openBatch`
// calls. These four carry 2026-09-04, 08-27, 08-21 and 09-18: three of them are
// period end + 6 or + 5, typed before the derivation existed. The draft is
// refreshed after, because `payoutDate` is computed per driver from this date.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

const APPLY = process.argv.includes('--apply')
const ORGANIZATION_SLUG = 'zebra'

// `BATCH_SERIES` IS IMPORTED, NOT RETYPED. It was written here as
// `'settlement-batch'` and the real key is `'SETTLEMENT_BATCH'` — so the upsert
// would have advanced a counter row nothing reads, left the real one at zero,
// and had the next `openBatch` hand `SB-000001` to a different week. Which is
// the failure the comment below was already warning about, written by the same
// hand that then guessed the key.

class Rehearsal extends Error {}

const day = (at: Date) => at.toISOString().slice(0, 10)

async function main(): Promise<void> {
  const url = process.env.DIRECT_DATABASE_URL
  if (!url) throw new Error('No dev database url.')
  const db = createPrismaClient(url)

  console.log('Target: DEV')
  console.log(
    `Mode:   ${APPLY ? 'APPLY — writes commit' : 'dry run — rolls back'}`,
  )

  try {
    const tenancy = await assertTenancy(db, {
      label: 'DEV',
      host: new URL(url).hostname,
      slug: ORGANIZATION_SLUG,
      expectOrganizationId: null,
    })

    // ── ONE TRANSACTION PER BATCH ──────────────────────────────────────
    //
    // NOT ONE AROUND ALL FOUR, which is what this did first: `refreshDraft`
    // throws away a batch's settlements and recomputes them from the loads and
    // rules as they are now, and four of those took 61 seconds against a 60
    // second interactive limit. It failed on the fourth, having done three.
    //
    // The same reasoning as the bulk status action a few files over: a
    // transaction that spans several runs holds locks for minutes and rolls back
    // work that had already succeeded. Per batch, and the dry run rolls each one
    // back on its own.
    const batches = await db.settlementBatch.findMany({
      where: { organizationId: tenancy.organizationId, deletedAt: null },
      orderBy: { periodStart: 'asc' },
      select: {
        id: true,
        batchNumber: true,
        status: true,
        periodStart: true,
        periodEnd: true,
        checkDate: true,
      },
    })

    console.log(`\n${batches.length} batch(es), oldest first\n`)

    let highest = 0
    for (const [index, batch] of batches.entries()) {
      const period = { start: batch.periodStart, end: batch.periodEnd }
      const correct = checkDateFor(period)
      const number = batch.batchNumber ?? batchNumberOf(index + 1)
      const numeric = Number(number.replace(/\D/g, ''))
      if (Number.isFinite(numeric)) highest = Math.max(highest, numeric)

      const lag = Math.round(
        (batch.checkDate.getTime() - period.end.getTime()) / 86_400_000,
      )
      const dateMoves = batch.checkDate.getTime() !== correct.getTime()

      console.log(
        `${number}  ${day(period.start)} → ${day(period.end)}  ${batch.status}`,
      )
      console.log(`  number     ${batch.batchNumber ?? '(none)'} → ${number}`)
      console.log(
        `  check date ${day(batch.checkDate)} (end + ${lag}) → ${day(correct)}` +
          (dateMoves ? '' : '  (already on the cadence)'),
      )

      // A FINAL OR PAID BATCH KEEPS ITS CHECK DATE. Ruling 4 is about rehearsal
      // drafts; a printed statement is not a rehearsal. The number is safe
      // either way, because it had none.
      const moveDate = dateMoves && batch.status === 'DRAFT'
      if (dateMoves && !moveDate) {
        console.log(
          `  KEPT: the batch is ${batch.status}, and its check date is printed.`,
        )
      }

      await db
        .$transaction(
          async (tx) => {
            await tx.settlementBatch.update({
              where: { id: batch.id },
              data: {
                batchNumber: number,
                ...(moveDate ? { checkDate: correct } : {}),
              },
            })

            if (moveDate) {
              const refreshed = await refreshDraft(tx, batch.id)
              if (!refreshed.ok) {
                throw new Error(
                  `refreshDraft refused for ${number}: ${JSON.stringify(refreshed.reason)}`,
                )
              }
              console.log(
                `  refreshed  ${refreshed.result.settlements.length} settlement(s)`,
              )
            }

            if (!APPLY) throw new Rehearsal()
          },
          { timeout: SETTLEMENT_BATCH_TIMEOUT_MS },
        )
        .catch((error: unknown) => {
          if (!(error instanceof Rehearsal)) throw error
        })
    }

    // ── THE COUNTER, PAST THE HIGHEST PLACED ──────────────────────────────
    //
    // Or the next `openBatch` reissues `SB-000001` to a different week.
    if (APPLY) {
      await db.$executeRaw`
        INSERT INTO "SeriesCounter" ("id", "organizationId", "key", "value", "updatedAt")
        VALUES (gen_random_uuid()::text, ${tenancy.organizationId}, ${BATCH_SERIES}, ${highest}, now())
        ON CONFLICT ("organizationId", "key")
          DO UPDATE SET value = GREATEST("SeriesCounter".value, ${highest}), "updatedAt" = now()
      `
    }
    console.log(`\nseries counter at or above ${highest}`)

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
