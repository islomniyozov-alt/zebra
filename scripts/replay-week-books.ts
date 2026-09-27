import { neonConfig } from '@neondatabase/serverless'
import { createPrismaClient } from '@/lib/db'
import { transitionOperational } from '@/lib/load-status'
import { assertTenancy } from './datatruck-tenancy'

// ---------------------------------------------------------------------------
// A PAST WEEK'S CLOSED HISTORY, REOPENED SO ZEBRA CAN SETTLE IT — ON DEV.
//
//   npx tsx -r dotenv/config scripts/replay-week-books.ts --week 2026-08-30
//   npx tsx -r dotenv/config scripts/replay-week-books.ts --week 2026-08-30 --apply
//
// ── DEV ONLY, AND BY CONSTRUCTION TWICE OVER ──────────────────────────────
//
// Owner's ruling, 2026-09-27: "on DEV only, never production."
//
// FIRST, THIS FILE DOES NOT NAME THE PRODUCTION CONNECTION VARIABLE. Production
// is not reachable by forgetting a flag, mistyping one, or pasting a command
// from another session — the string is not here to be read. That is also why
// this script needs no entry in `tests/prod-url-guard.test.ts`.
//
// AND THE VARIABLE IS NOT SPELLED OUT ANYWHERE IN THIS FILE, INCLUDING HERE.
// The fence reads each file as TEXT, so a comment boasting about not reading it
// is indistinguishable from reading it — which is exactly right, and is how the
// first draft of this script ended up on the wrong side of its own claim. Same
// trap as `isolation-coverage` catching a model name inside a comment.
//
// SECOND, THE ORGANISATION ID IS PINNED AND PRODUCTION'S IS NAMED. `assertTenancy`
// resolves the `zebra` slug — which EXISTS ON BOTH DATABASES, so the slug proves
// nothing — and refuses when the id is not dev's. This is not the circular check
// its own comment warns about: the expectation is not "whatever dev happens to
// hold", it is "not production", and the id below would refuse the one target
// the ruling forbids.
//
// ── WHAT "RECLASSIFY TO LIVE" MEANS, EXACTLY ──────────────────────────────
//
// `BOOKS_CUTOVER` is 2026-09-13. Every finished row delivered before it was
// imported as closed history: `DELIVERED` on the operational axis,
// `CLOSED_IN_DATATRUCK` on the billing one, and NO POD event — because Datatruck
// billed that freight and was paid for it, and Zebra was not present.
//
// `SETTLEABLE_LOAD` excludes `CLOSED_IN_DATATRUCK`, and `settleableWhere` wants
// `POD_RECEIVED` plus an APPLIED POD_RECEIVED event dated inside the period. So
// a closed-history week is invisible to every settlement, by design. Three
// things have to change and they are not interchangeable:
//
//   1. the billing axis stops saying another system owns this
//   2. the operational axis reaches POD_RECEIVED
//   3. an APPLIED POD_RECEIVED event exists, DATED AT THE DELIVERY
//
// THE THIRD IS THE ONE THAT DECIDES THE MONEY. The event's `occurredAt` is the
// pay week — nothing else on the load says which week it belongs to. An event
// stamped at the time of this script would put a whole week of freight into the
// week the replay was run, which is the defect the 2026-09-26 POD ruling fixed
// in the trips importer.
//
// ── IT MOVES THE STATUS THROUGH THE ENGINE, NOT BY COLUMN ─────────────────
//
// `transitionOperational` reads the load, writes the event, updates the column
// and recomputes the billing axis. Writing `operationalStatus` by hand would
// produce exactly the silent condition `backfill-direct-pod.mjs` was written to
// repair: a load reading POD Received on every screen and in no driver's
// settleable set, for ever, because the event nothing can see is the one thing
// that is checked.
//
// AND THE BILLING AXIS IS CLEARED FIRST, in that order, because
// `CLOSED_IN_DATATRUCK` is one of the DECIDED statuses — `refreshBillingStatus`
// skips a decided load rather than recomputing it. Clear it after the
// transition and the load keeps saying Datatruck owns it while carrying a POD
// this system stamped.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

/**
 * Dev's `zebra` organisation, and the one id this script will write into.
 *
 * PRODUCTION'S IS `cmsbsc82y0000nsvsa6yffuyh` and is written here so a reader
 * can see at a glance that the two differ. `assertTenancy` refuses anything but
 * the first.
 */
const DEV_ORGANIZATION_ID = 'cms5d2etl0000ncvsjz5bgdh9'
const PRODUCTION_ORGANIZATION_ID = 'cmsbsc82y0000nsvsa6yffuyh'
const ORGANIZATION_SLUG = 'zebra'

/**
 * The note every event this script writes carries.
 *
 * NAMED AND GREPPABLE, because a replay is reversible only if its writes can be
 * found. `datatruck-import` is the importer's note; this is deliberately not
 * that, so a later sweep can tell freight the books always owned from freight a
 * replay reopened.
 */
const REPLAY_EVENT_NOTE = 'books-replay'

/**
 * One transaction for the week, and the arithmetic behind the number.
 *
 * ~200ms per round trip to us-east-2, which `SETTLEMENT_BATCH_TIMEOUT_MS`
 * records as measured. `transitionOperational` is a read, an update, an event
 * and a billing recompute — call it eight round trips with `billingFactsFor`
 * inside. At 194 loads that is 194 × 8 × 200ms ≈ 310 SECONDS.
 *
 * ONE TRANSACTION RATHER THAN CHUNKS, unlike the trips importer, and for the
 * opposite reason: this is a rehearsal-then-apply script, and a rehearsal that
 * cannot roll back the whole week is not a rehearsal. A half-reclassified week
 * is also a genuinely bad state — some of a driver's freight settleable and the
 * rest still closed, which produces a statement that looks complete and is
 * short.
 */
const REPLAY_TIMEOUT_MS = 900_000

const APPLY = process.argv.includes('--apply')

const arg = (name: string): string | null => {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? null : (process.argv[at + 1] ?? null)
}

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

const heading = (text: string) => {
  console.log(`\n${text}`)
  console.log('─'.repeat(Math.max(text.length, 78)))
}

class Rehearsal extends Error {}

/** The week as UTC instants, inclusive of the Saturday to its last millisecond. */
function weekBounds(week: string) {
  const start = new Date(`${week}T00:00:00.000Z`)
  if (Number.isNaN(start.getTime())) throw new Error(`Bad --week: ${week}`)
  if (start.getUTCDay() !== 0) {
    throw new Error(
      `--week must be a Sunday; ${week} is day ${start.getUTCDay()}. The ` +
        `settlement week runs Sunday to Saturday — both 8/30 statements print ` +
        `Period Start 8/30/2026 and Period End 9/5/2026.`,
    )
  }
  return { start, end: new Date(start.getTime() + 7 * 86_400_000 - 1) }
}

async function main(): Promise<void> {
  const week = arg('week')
  if (!week) throw new Error('Name --week (a Sunday, e.g. --week 2026-08-30).')
  const { start, end } = weekBounds(week)

  const url = process.env.DIRECT_DATABASE_URL
  if (!url) throw new Error('DIRECT_DATABASE_URL is not set.')
  const db = createPrismaClient(url)

  console.log('Target: DEV (this script cannot reach production)')
  console.log(`Week:   ${start.toISOString()} .. ${end.toISOString()}`)
  console.log(
    `Mode:   ${APPLY ? 'APPLY — writes commit' : 'REHEARSAL — rolls back'}`,
  )

  const tenancy = await assertTenancy(db, {
    label: 'DEV',
    host: new URL(url).host,
    slug: ORGANIZATION_SLUG,
    expectOrganizationId: DEV_ORGANIZATION_ID,
  })
  if (tenancy.organizationId === PRODUCTION_ORGANIZATION_ID) {
    throw new Error('REFUSING: that is production.')
  }

  const reclassified: string[] = []
  const undated: string[] = []
  const alreadyLive: string[] = []
  const notMoved: string[] = []

  try {
    await db
      .$transaction(
        async (tx) => {
          // ── THE ROWS, CHOSEN BY THE DELIVERY STOP ─────────────────────
          //
          // NOT BY THE POD EVENT, which is what this creates: an instrument
          // that asked the event would find none and report a finished job.
          // NOT BY `externalId` EITHER — a Datatruck id says where the row came
          // from, and the question is what week the freight delivered in.
          const loads = await tx.load.findMany({
            where: {
              organizationId: tenancy.organizationId,
              deletedAt: null,
              isCancelled: false,
              billingStatus: 'CLOSED_IN_DATATRUCK',
              stops: {
                some: {
                  type: 'DELIVERY',
                  scheduledAt: { gte: start, lte: end },
                },
              },
            },
            select: {
              id: true,
              loadNumber: true,
              referenceNumber: true,
              externalId: true,
              operationalStatus: true,
              totalRevenueCents: true,
              driver: { select: { firstName: true, lastName: true } },
              stops: {
                where: { type: 'DELIVERY' },
                select: { scheduledAt: true, arrivedAt: true },
                orderBy: { sequence: 'desc' },
                take: 1,
              },
            },
            orderBy: { loadNumber: 'asc' },
          })

          heading(
            `CLOSED-HISTORY LOADS DELIVERED IN THE WEEK — ${loads.length}`,
          )
          const gross = loads.reduce((sum, l) => sum + l.totalRevenueCents, 0)
          console.log(`  gross ${money(gross)}`)

          // ── THE BILLING AXIS FIRST, AND IN ONE STATEMENT ──────────────
          //
          // `UNINVOICED` rather than a computed status: this is the same value
          // `readStatus` writes for a row the books own, and the recompute
          // inside each transition below is what then decides where it really
          // belongs. Setting the answer here would be a second reader.
          const ids = loads.map((l) => l.id)
          if (ids.length > 0) {
            await tx.load.updateMany({
              where: { id: { in: ids } },
              data: { billingStatus: 'UNINVOICED' },
            })
            // THE AXIS MOVED, SO THE TIMELINE SAYS SO. `refreshBillingStatus`
            // writes its own events; this one is ours, and without it a week of
            // loads would leave closed history with nothing recording that they
            // had ever been in it.
            await tx.loadStatusEvent.createMany({
              data: loads.map((load) => ({
                loadId: load.id,
                organizationId: tenancy.organizationId,
                axis: 'BILLING' as const,
                fromStatus: 'CLOSED_IN_DATATRUCK',
                toStatus: 'UNINVOICED',
                source: 'INTEGRATION' as const,
                note: `${REPLAY_EVENT_NOTE} ${week}`,
              })),
            })
          }

          // ── THEN THE OPERATIONAL AXIS, ONE LOAD AT A TIME ─────────────
          for (const load of loads) {
            const stop = load.stops[0]
            // THE EXPORT'S DELIVERY DATE, which for these rows IS the delivery
            // stop's `scheduledAt` — that is the column the Datatruck seed wrote
            // it into. `arrivedAt` is preferred when a later import filled one,
            // because an actual beats a plan; neither is invented.
            const deliveredAt = stop?.arrivedAt ?? stop?.scheduledAt ?? null
            const name =
              load.driver === null
                ? '(no driver)'
                : `${load.driver.firstName} ${load.driver.lastName}`
            const label = `${load.loadNumber} ${load.referenceNumber ?? load.externalId ?? ''} ${name}`

            if (deliveredAt === null) {
              // NO DATE, NO EVENT. The same posture as `importEventAt`: a load
              // reading POD Received while being invisible to every settlement
              // is worse than one visibly still closed.
              undated.push(label)
              continue
            }

            if (load.operationalStatus === 'POD_RECEIVED') {
              alreadyLive.push(label)
              continue
            }

            const moved = await transitionOperational(
              tx,
              load.id,
              'POD_RECEIVED',
              {
                source: 'INTEGRATION',
                note: `${REPLAY_EVENT_NOTE} ${week}`,
                occurredAt: deliveredAt,
              },
            )
            if (moved.result === 'moved') {
              reclassified.push(
                `${label}  POD ${deliveredAt.toISOString().slice(0, 10)}  ${money(load.totalRevenueCents)}`,
              )
            } else {
              notMoved.push(`${label}  ${moved.result}`)
            }
          }

          // ── READ BACK INSIDE THE TRANSACTION ──────────────────────────
          //
          // "The write returned moved" is not evidence; `settleableWhere`'s four
          // conditions are. This counts the loads that now satisfy the status
          // AND an APPLIED event dated in the week — the same shape the engine
          // asks, against the rows as they stand.
          const settleableNow = await tx.load.count({
            where: {
              organizationId: tenancy.organizationId,
              deletedAt: null,
              isCancelled: false,
              billingStatus: { not: 'CLOSED_IN_DATATRUCK' },
              operationalStatus: 'POD_RECEIVED',
              statusEvents: {
                some: {
                  axis: 'OPERATIONAL',
                  toStatus: 'POD_RECEIVED',
                  outcome: 'APPLIED',
                  occurredAt: { gte: start, lte: end },
                },
              },
            },
          })
          const withSeat = await tx.load.count({
            where: {
              organizationId: tenancy.organizationId,
              deletedAt: null,
              isCancelled: false,
              billingStatus: { not: 'CLOSED_IN_DATATRUCK' },
              operationalStatus: 'POD_RECEIVED',
              OR: [{ driverId: { not: null } }, { coDriverId: { not: null } }],
              statusEvents: {
                some: {
                  axis: 'OPERATIONAL',
                  toStatus: 'POD_RECEIVED',
                  outcome: 'APPLIED',
                  occurredAt: { gte: start, lte: end },
                },
              },
            },
          })

          heading('AFTER THE WRITES, ASKED THE WAY THE ENGINE ASKS')
          console.log(
            `  POD_RECEIVED with an event dated in the week  ${settleableNow}`,
          )
          console.log(
            `  …and somebody in a seat                       ${withSeat}`,
          )

          if (!APPLY) throw new Rehearsal('rehearsal')
        },
        { timeout: REPLAY_TIMEOUT_MS, maxWait: 30_000 },
      )
      .catch((error: unknown) => {
        if (error instanceof Rehearsal) return
        throw error
      })
  } finally {
    await db.$disconnect()
  }

  heading(`RECLASSIFIED — ${reclassified.length}`)
  for (const line of reclassified.slice(0, 20)) console.log(`  ${line}`)
  if (reclassified.length > 20) {
    console.log(`  … and ${reclassified.length - 20} more`)
  }
  if (alreadyLive.length > 0) {
    heading(`ALREADY LIVE, LEFT ALONE — ${alreadyLive.length}`)
    for (const line of alreadyLive) console.log(`  ${line}`)
  }
  if (undated.length > 0) {
    heading(`REFUSED — NO DELIVERY DATE TO STAMP — ${undated.length}`)
    for (const line of undated) console.log(`  ${line}`)
  }
  if (notMoved.length > 0) {
    heading(`REFUSED BY THE ENGINE — ${notMoved.length}`)
    for (const line of notMoved) console.log(`  ${line}`)
  }

  heading(APPLY ? 'COMMITTED' : 'NOTHING COMMITTED — rehearsal rolled back')
}

await main()
