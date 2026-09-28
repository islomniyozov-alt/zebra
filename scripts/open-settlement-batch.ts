import { neonConfig } from '@neondatabase/serverless'
import { createPrismaClient } from '@/lib/db'
import {
  SETTLEMENT_BATCH_TIMEOUT_MS,
  openBatch,
  refreshDraft,
} from '@/lib/settlement-batch'
import { checkDateFor } from '@/lib/settlement-week'
import { assertTenancy } from './datatruck-tenancy'

// ---------------------------------------------------------------------------
// OPEN THE WEEK AS A DRAFT AND REFRESH IT. NEVER FINALISE.
//
//   npx tsx -r dotenv/config scripts/open-settlement-batch.ts --production \
//     --week 2026-09-13 --statement 2026-09-22
//   ... --apply
//
// NO `--check`. The check date is period end + 13, derived by `checkDateFor`,
// and passing the flag is REFUSED rather than ignored — this usage line used to
// carry `--check 2026-09-25`, which is six days after a week ending 9/19 and is
// the wrong date batch cmuga82ji0000qkvslwyibodv holds.
//
// Owner's ruling, 2026-09-25: the first real settlement week after the
// operational cutover, opened as DRAFT only.
//
// ── WHY THIS WRITES AND IS STILL SAFE ─────────────────────────────────────
//
// A DRAFT HOLDS NO TRUTH. Every refresh throws its lines away and recomputes
// from the loads, the rules and the charges as they are NOW — which is what
// makes "add the missing pay rule and refresh" something a person can do.
// Nothing here calls `finaliseBatch`, and a FINAL batch is the only thing that
// means somebody was paid.
//
// ── IT REFUSES A SECOND BATCH FOR THE WEEK ────────────────────────────────
//
// `openBatch` enforces one batch per period in code rather than with a unique
// index — a held line confirmed after FINAL has to land somewhere — and hands
// back the existing batch instead of colliding. This reports that and refreshes
// the one that is already there, which is what a re-run should do.
//
// ── WHAT IT PRINTS ────────────────────────────────────────────────────────
//
// Every HELD line and every BLOCKED driver, by name, because those are the two
// ways a draft balances and is wrong: a held line is money the engine could not
// price, and a blocker is a driver who cannot be paid at all. A total that
// agrees with itself while either list is non-empty is the failure this whole
// week has been guarding against.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

const APPLY = process.argv.includes('--apply')
const PRODUCTION = process.argv.includes('--production')

const arg = (name: string): string | null => {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? null : (process.argv[at + 1] ?? null)
}

const day = (value: string | null, label: string): Date => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`--${label} must be a yyyy-mm-dd day. Got: ${value}`)
  }
  const at = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(at.getTime())) throw new Error(`--${label} is not a day.`)
  return at
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

const heading = (text: string) => {
  console.log(`\n${text}`)
  console.log('─'.repeat(Math.max(text.length, 70)))
}

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

async function main(): Promise<void> {
  const weekStart = day(arg('week'), 'week')
  const statementDate = day(arg('statement'), 'statement')

  // ── `--check` IS REFUSED, NOT IGNORED ───────────────────────────────────
  //
  // The check date is derived from the period now (§0 as amended 2026-09-28),
  // and this script is where the wrong one came from: the usage line above used
  // to read `--week 2026-09-13 --statement 2026-09-22 --check 2026-09-25`, which
  // is period end + 6 against a week ending 9/19 and is what batch
  // cmuga82ji0000qkvslwyibodv holds.
  //
  // SO A STALE COMMAND LINE HAS TO FAIL RATHER THAN WORK QUIETLY. That exact
  // string is in this repository, in session notes and in somebody's shell
  // history; accepting and ignoring it would open the batch with the right date
  // while the operator believed the flag had been honoured — a difference
  // nothing on screen would show.
  if (process.argv.includes('--check')) {
    throw new Error(
      '--check is no longer accepted: the check date is period end + 13, ' +
        'derived by checkDateFor. Drop the flag and re-run.',
    )
  }
  // ── THE END IS THE SATURDAY AT MIDNIGHT, NOT THE LAST MILLISECOND ───────
  //
  // DERIVED, never typed: two dates by hand are two chances to ask about six
  // days and report it as seven.
  //
  // AND IT IS start + 6 DAYS EXACTLY, because that is what `isSettlementWeek`
  // requires — `end - start === 6 * DAY`, with the start on a Sunday. The first
  // version of this used `+7 days - 1ms`, the preflight's convention, and
  // `openBatch` refused it as `not_a_week`.
  //
  // The two conventions agree on the freight, which is the part that matters:
  // `settleableForBatch` filters `lte: period.end + 86_399_999`, so a Saturday
  // stored at midnight still collects that whole Saturday. Passing the last
  // millisecond instead would have been a day PAST the end of the week.
  const period = {
    start: weekStart,
    end: new Date(weekStart.getTime() + 6 * 86_400_000),
  }

  const where = target()
  const db = createPrismaClient(where.url)
  console.log(`Target: ${where.label}`)
  console.log(
    `Mode:   ${APPLY ? 'APPLY — writes commit' : 'dry run — rolls back'}`,
  )
  console.log(
    `Week:   ${period.start.toISOString().slice(0, 10)} → ${period.end.toISOString().slice(0, 10)}`,
  )
  console.log(
    `Dates:  statement ${statementDate.toISOString().slice(0, 10)} (typed), ` +
      `check ${checkDateFor(period).toISOString().slice(0, 10)} (derived)`,
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
          const opened = await openBatch(tx, {
            organizationId: tenancy.organizationId,
            period,
            statementDate,
          })

          let batchId: string
          if (opened.ok) {
            batchId = opened.batchId
            console.log(`\nbatch opened: ${batchId}`)
          } else if (opened.reason.kind === 'period_taken') {
            // `openBatch` hands back the batch that already covers the week
            // rather than colliding, so a re-run refreshes it. That is what a
            // re-run should do: a draft is recomputed, not appended to.
            batchId = opened.reason.batchId
            console.log(
              `\nbatch already covers this week: ${batchId}` +
                `  ${opened.reason.batchNumber ?? '(no number)'}` +
                `  status ${opened.reason.status}`,
            )
          } else {
            throw new Error(
              `openBatch refused: ${JSON.stringify(opened.reason)}`,
            )
          }

          const refreshed = await refreshDraft(tx, batchId)
          if (!refreshed.ok) {
            throw new Error(
              `refreshDraft refused: ${JSON.stringify(refreshed.reason)}`,
            )
          }
          const result = refreshed.result

          heading('THE DRAFT')
          console.log(`  settlements     ${result.settlements.length}`)
          const gross = result.settlements.reduce(
            (sum, s) => sum + s.grossCents,
            0,
          )
          const net = result.settlements.reduce((sum, s) => sum + s.netCents, 0)
          console.log(`  gross           ${money(gross)}`)
          console.log(`  net             ${money(net)}`)
          console.log(`  can finalise    ${result.canFinalise}`)

          heading(`BLOCKED DRIVERS — ${result.blockers.length}`)
          if (result.blockers.length === 0) {
            console.log('  None. Every driver in the week can be paid.')
          }
          for (const b of result.blockers) {
            console.log(`  ${b.driverName}  ${JSON.stringify(b.blocker)}`)
          }

          heading(`HELD LINES — ${result.held.length}`)
          if (result.held.length === 0) {
            console.log('  None. Every line in the week could be priced.')
          }
          for (const h of result.held) {
            console.log(`  ${h.driverName}  ${JSON.stringify(h.line)}`)
          }

          if (result.negative.length > 0) {
            heading(`NEGATIVE NET — ${result.negative.length}`)
            for (const n of result.negative) {
              console.log(`  ${n.driverName}  ${money(n.netCents)}`)
            }
          }

          if (!APPLY) throw new Rehearsal('dry run')
        },
        { timeout: SETTLEMENT_BATCH_TIMEOUT_MS * 4 },
      )
      .catch((error: unknown) => {
        if (error instanceof Rehearsal) return
        throw error
      })

    console.log(
      APPLY
        ? '\nWRITTEN as DRAFT. Nothing was finalised; a draft is recomputed on every refresh.'
        : '\nROLLED BACK. The statements above ran and were undone; re-run with --apply.',
    )
  } finally {
    await db.$disconnect()
  }
}

await main()
