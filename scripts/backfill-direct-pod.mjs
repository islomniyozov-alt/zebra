import { randomUUID } from 'node:crypto'
import { neonConfig, Pool } from '@neondatabase/serverless'

// ---------------------------------------------------------------------------
// THE LOADS THE RULING CANNOT REACH BY ITSELF.
//
// From 2026-09-03 a direct-settled load carries its POD the moment it is
// delivered: Amazon holds the signed paperwork, drivers upload into Relay, and
// no POD document will ever arrive here for that freight. `podConfirmed` fires
// from `transitionOperational` on the way into DELIVERED.
//
// WHICH DOES NOTHING FOR FREIGHT ALREADY THERE. `transitionOperational` returns
// `unchanged` when `from === to`, BEFORE the follow-on — so re-delivering an
// already-delivered load fires nothing, and re-importing is refused by the
// `isDelivered` guard. Every Amazon load delivered before that deploy is stuck
// outside `settleableWhere`, which selects on POD_RECEIVED: no settlement line,
// in any period, for any driver, forever. It is a silent condition — the load
// reads Delivered on every screen and simply never appears in a pay week.
//
// SO THIS IS A ONE-OFF REPAIR, and it is shaped to be read before it is
// trusted:
//
//   DRY RUN BY DEFAULT. It names every load it would touch and why. Nothing
//   is written without `--apply`, and the owner reads the list first.
//
//   IDEMPOTENT. The selection excludes any load that already carries an
//   APPLIED POD event, so a second run finds nothing. Running it twice is not
//   a way to pay somebody twice.
//
//   THE POD IS STAMPED WHEN THE LOAD WAS DELIVERED, not now. This is the
//   detail that decides whether the repair is correct: `settleableWhere` keys
//   the pay period on the POD event's `occurredAt`, so stamping the clock
//   would sweep a whole summer of freight into this week's settlement and pay
//   it all at once. The time comes from the load's own DELIVERED event.
//
//   IT REFUSES ANYTHING IT CANNOT REASON ABOUT. A load with no APPLIED
//   DELIVERED event to take a time from is listed and skipped, not guessed at.
//
//   node -r dotenv/config scripts/backfill-direct-pod.mjs
//   node -r dotenv/config scripts/backfill-direct-pod.mjs --apply
//   ZEBRA_TARGET=dev node -r dotenv/config scripts/backfill-direct-pod.mjs
//
// See PHASE-6-BRIEF.md flag 90.
// ---------------------------------------------------------------------------

const apply = process.argv.includes('--apply')
const dev = process.env.ZEBRA_TARGET === 'dev'
const connectionString = dev
  ? process.env.DIRECT_DATABASE_URL
  : process.env.PROD_DIRECT_DATABASE_URL

if (!connectionString) {
  console.error(
    dev
      ? 'No DIRECT_DATABASE_URL in the environment.'
      : 'No PROD_DIRECT_DATABASE_URL in the environment.',
  )
  process.exit(1)
}

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false
// ONE CONNECTION, BECAUSE IT NEEDS EXACTLY ONE — not because the branch is
// short of them. An earlier version of this comment claimed "a branch with a
// connection ceiling", which nobody had measured: max_connections on the dev
// branch is 901 (measured 2026-09-04, scripts/measure-neon.mjs) and this suite
// opens single digits. The cap stays — a script needing one connection should
// say one — but the reason is tidiness, not scarcity.
const pool = new Pool({ connectionString, max: 1 })
const rows = async (text, values = []) => (await pool.query(text, values)).rows

const money = (cents) => `$${(cents / 100).toFixed(2)}`
const when = (date) => (date ? new Date(date).toISOString().slice(0, 16) : '—')

try {
  console.log(
    `${apply ? 'APPLYING to' : 'Dry run against'} ` +
      `${dev ? 'DEV' : 'PRODUCTION'}.\n`,
  )

  // THE THREE CONDITIONS, STATED AS THEY READ IN THE RULING: the freight
  // settles directly, it is delivered, and it carries no POD. Cancelled and
  // deleted loads are not freight anybody is owed for.
  //
  // The DELIVERED event is joined rather than looked up afterwards, because a
  // load whose status says DELIVERED with no APPLIED event behind it is a load
  // this script has no honest time for — it comes back with a null and is
  // reported as a refusal instead of being stamped with a guess.
  const candidates = await rows(
    `SELECT l.id,
            l."organizationId",
            l."loadNumber",
            l."referenceNumber",
            l."totalRevenueCents",
            l."driverId",
            l."billingStatus",
            c.name AS customer,
            d.at   AS delivered_at,
            COALESCE(p.applied, 0) AS applied_cents
       FROM "Load" l
       JOIN "Customer" c ON c.id = l."customerId"
       LEFT JOIN LATERAL (
         SELECT e."occurredAt" AS at
           FROM "LoadStatusEvent" e
          WHERE e."loadId" = l.id
            AND e.axis = 'OPERATIONAL'
            AND e."toStatus" = 'DELIVERED'
            AND e.outcome = 'APPLIED'
          ORDER BY e."occurredAt" ASC
          LIMIT 1
       ) d ON true
       LEFT JOIN LATERAL (
         SELECT sum(a."amountCents") AS applied
           FROM "PaymentLoadApplication" a
          WHERE a."loadId" = l.id
       ) p ON true
      WHERE l."directSettled" = true
        AND l."operationalStatus" = 'DELIVERED'
        AND l."isCancelled" = false
        AND l."deletedAt" IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM "LoadStatusEvent" e2
           WHERE e2."loadId" = l.id
             AND e2.axis = 'OPERATIONAL'
             AND e2."toStatus" = 'POD_RECEIVED'
             AND e2.outcome = 'APPLIED'
        )
      ORDER BY l."loadNumber"`,
  )

  if (candidates.length === 0) {
    console.log(
      'Nothing to do. No direct-settled load is sitting at Delivered\n' +
        'without a POD — which is also what a second run looks like.',
    )
    process.exit(0)
  }

  const doable = candidates.filter((row) => row.delivered_at !== null)
  const refused = candidates.filter((row) => row.delivered_at === null)

  console.log(`${candidates.length} load(s) match the three conditions:\n`)
  for (const row of candidates) {
    const flags = [
      row.driverId ? null : 'NO DRIVER — will still not settle',
      row.delivered_at ? null : 'NO DELIVERED EVENT — skipped',
      Number(row.applied_cents) > 0 ? 'already part-paid' : null,
    ].filter(Boolean)

    console.log(
      `  ${row.loadNumber.padEnd(10)} ${(row.referenceNumber ?? '—').padEnd(16)} ` +
        `${row.customer.padEnd(14)} delivered ${when(row.delivered_at)} ` +
        `${money(row.totalRevenueCents).padStart(11)}` +
        (flags.length > 0 ? `\n      ${flags.join('; ')}` : ''),
    )
  }

  // THE DRIVERLESS ONES ARE NOT A SIDE NOTE. A settlement selects on
  // `driverId`; a load with none is invisible to a pay week whatever its
  // status says, so stamping a POD on it fixes half a problem and looks like
  // it fixed the whole one.
  const driverless = doable.filter((row) => row.driverId === null)
  console.log(
    `\n${doable.length} would be stamped, ${refused.length} refused for want ` +
      `of a Delivered event.`,
  )
  if (driverless.length > 0) {
    console.log(
      `${driverless.length} of them carry NO DRIVER and will still not reach ` +
        `a settlement.\nAssign a driver on the load detail; the POD is only ` +
        `half of what a pay week needs.`,
    )
  }

  if (!apply) {
    console.log(
      '\nDry run — nothing was written. Re-run with --apply once this list\n' +
        'reads correctly.',
    )
    process.exit(0)
  }

  // ONE TRANSACTION. A half-applied backfill is worse than none: it would pay
  // some drivers and leave the rest looking identical to the ones already done.
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const row of doable) {
      // MIRRORS `podConfirmed`: AUTOMATIC, the message KEY rather than a
      // sentence (the timeline renders it in the reader's locale), and no user
      // — nobody clicked this.
      await client.query(
        `INSERT INTO "LoadStatusEvent"
           (id, "loadId", "organizationId", axis, "fromStatus", "toStatus",
            outcome, source, "changedByUserId", "occurredAt", note)
         VALUES ($1, $2, $3, 'OPERATIONAL', 'DELIVERED', 'POD_RECEIVED',
                 'APPLIED', 'AUTOMATIC', NULL, $4, 'status.note.podConfirmed')`,
        [randomUUID(), row.id, row.organizationId, row.delivered_at],
      )

      // AND THE BILLING CACHE, by the rule in `billingStatusFor`: a
      // direct-settled load with nothing applied goes to READY_TO_INVOICE once
      // the POD is in. A load that already has money against it is PAID or
      // PARTIALLY_PAID and the POD does not move it, so it is left alone
      // rather than recomputed here — this script must not become a second
      // implementation of that function.
      const billing =
        Number(row.applied_cents) > 0
          ? null
          : row.totalRevenueCents > 0
            ? 'READY_TO_INVOICE'
            : 'UNINVOICED'

      await client.query(
        `UPDATE "Load"
            SET "operationalStatus" = 'POD_RECEIVED'
                ${billing ? `, "billingStatus" = '${billing}'` : ''}
          WHERE id = $1`,
        [row.id],
      )
    }
    await client.query('COMMIT')
    console.log(`\nDone. ${doable.length} load(s) stamped.`)
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
} finally {
  await pool.end()
}
