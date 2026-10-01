import { neonConfig } from '@neondatabase/serverless'
import { createPrismaClient } from '@/lib/db'
import { runInOrg } from '@/lib/tenancy'
import { unattributed } from '@/lib/audit'

// ---------------------------------------------------------------------------
// TWO LOADS WHOSE `directSettled` IS WRONG. A DATA CORRECTION, NOT A RULE.
//
//   npx tsx -r dotenv/config scripts/correct-direct-settled.ts --production
//   npx tsx -r dotenv/config scripts/correct-direct-settled.ts --production --write
//
// Owner's ruling 2, 2026-10-01.
//
// ── WHAT IS WRONG AND WHY IT IS NOT A PREDICATE CHANGE ───────────────────
//
// Loads 1105 and 1108 are hand-booked Amazon Relay jobs, $850 each, POD
// received, uninvoiced, booked 2026-08-06 under customers "Relay PYYLVJ" and
// "Relay PY2M22". Both carry `directSettled = false` while their customers
// carry `settlesDirectly = true`, so both sit in Ready to invoice — where they
// will stay forever, because Amazon pays by weekly ACH statement and is never
// invoiced.
//
// `Load.directSettled` IS COPIED AT BOOKING AND NEVER RE-READ, deliberately
// and twice in the schema: a customer changing terms next year must not
// rewrite the billing history of freight that has already run. So the queue's
// predicate is RIGHT and must not learn to join the live customer. The ruling
// is that these two ROWS are wrong — the customers were flipped to
// `settlesDirectly` after the loads were booked — and two rows get corrected.
//
// `createLoad` copies the flag correctly today, verified: nothing new will
// arrive in this state from the booking path.
//
// ── PREVIEW IS THE DEFAULT. `--write` IS THE OWNER'S TO RUN ──────────────
//
// Owner's instruction: Islom runs `--write` himself. Without it this reads,
// prints what it would change, and exits — and the preview shows the AFTER
// values rather than only the before, because a diff somebody has to
// reconstruct in their head is one they approve without reading.
//
// ── IT WRITES TO PRODUCTION, WHICH BREAKS A STANDING RULE ON PURPOSE ─────
//
// Every other `--production` mode in `scripts/` is READ ONLY, and
// `repair-migration-checksum.ts` REFUSES the combination of `--production` and
// `--apply` by name. That rule exists because a replay or a seed against
// production is a catastrophe with no undo.
//
// THIS IS THE EXCEPTION AND IT IS NAMED AS ONE, by the owner's ruling of
// 2026-10-01. What makes it acceptable is the shape rather than the intention:
// it touches TWO ROWS selected BY LOAD NUMBER, it sets ONE BOOLEAN, it refuses
// if it finds any count other than exactly those two, it refuses if either row
// already looks corrected, and it prints the organization it is operating on so
// the person running it can see which tenant they are about to change. There is
// no loop, no date range and no predicate — a script that selected these rows
// by `customer.settlesDirectly` could match freight nobody has looked at.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket

const args = process.argv.slice(2)
const PRODUCTION = args.includes('--production')
const WRITE = args.includes('--write')

/** The two rows, by the number a human can read on the screen. */
const LOAD_NUMBERS = ['1105', '1108'] as const

class Rehearsal extends Error {}

const url = PRODUCTION
  ? process.env.PROD_DIRECT_DATABASE_URL
  : process.env.DIRECT_DATABASE_URL
if (!url) {
  throw new Error(
    PRODUCTION
      ? 'No PROD_DIRECT_DATABASE_URL. Refusing to guess one.'
      : 'No DIRECT_DATABASE_URL. Refusing to guess one.',
  )
}
if (!PRODUCTION && /prod/i.test(url)) {
  throw new Error(
    'That url looks like production. Pass --production to say so.',
  )
}

const db = createPrismaClient(url)

console.log(`target   ${PRODUCTION ? 'PRODUCTION' : 'DEV'}`)
console.log(`host     ${new URL(url).hostname}`)
console.log(
  `mode     ${WRITE ? 'WRITE — changes commit' : 'PREVIEW — rolls back'}`,
)

// ── THE ORGANIZATION, NAMED, BEFORE ANYTHING ELSE ──────────────────────────
//
// The ruling asks for it by name. RLS is set per transaction from an org id, so
// a script that found the wrong one would operate confidently on another
// tenant — and on production there is only one today, which is exactly the
// condition under which nobody checks.
const orgs = await db.organization.findMany({
  select: { id: true, name: true, slug: true },
})
if (orgs.length !== 1) {
  throw new Error(
    `Expected exactly one organization, found ${String(orgs.length)}: ` +
      `${orgs.map((o) => o.slug).join(', ')}. Name the one to use by hand.`,
  )
}
const org = orgs[0]!
console.log(`org      ${org.name} (slug ${org.slug})`)
console.log(`         ${org.id}\n`)

try {
  await runInOrg(
    db,
    org.id,
    async (tx) => {
      const found = await tx.load.findMany({
        where: {
          loadNumber: { in: [...LOAD_NUMBERS] },
          deletedAt: null,
        },
        select: {
          id: true,
          loadNumber: true,
          directSettled: true,
          operationalStatus: true,
          billingStatus: true,
          totalRevenueCents: true,
          bookedAt: true,
          customer: { select: { name: true, settlesDirectly: true } },
          invoiceLines: { select: { id: true } },
        },
        orderBy: { loadNumber: 'asc' },
      })

      // EXACTLY TWO, BY NUMBER. A load number is unique per organization, so
      // anything else means this is not the database the ruling was written
      // about — a different tenant, a renamed load, a restored row.
      if (found.length !== LOAD_NUMBERS.length) {
        throw new Error(
          `Expected ${String(LOAD_NUMBERS.length)} loads ` +
            `(${LOAD_NUMBERS.join(', ')}), found ${String(found.length)}: ` +
            `${found.map((row) => row.loadNumber).join(', ') || 'none'}. ` +
            'Refusing to change anything.',
        )
      }

      for (const row of found) {
        console.log(`  ${row.loadNumber}`)
        console.log(`    customer          ${row.customer?.name ?? '—'}`)
        console.log(
          `    settlesDirectly   ${String(row.customer?.settlesDirectly ?? false)}`,
        )
        console.log(
          `    status            ${row.operationalStatus}/${row.billingStatus}`,
        )
        console.log(
          `    revenue           $${(row.totalRevenueCents / 100).toFixed(2)}`,
        )
        console.log(`    invoice lines     ${String(row.invoiceLines.length)}`)
        console.log(
          `    directSettled     ${String(row.directSettled)}  ->  true`,
        )

        // ── FOUR REFUSALS, EACH ABOUT A DIFFERENT WAY TO BE WRONG ──────
        //
        // ALREADY TRUE means somebody has run this, or the row was never
        // broken. Writing again would be harmless and the refusal is not about
        // harm — it is that a script which cannot tell "done" from "to do"
        // cannot be run twice safely by a person who has lost their place.
        if (row.directSettled) {
          throw new Error(
            `${row.loadNumber} already has directSettled = true. ` +
              'Nothing to correct; refusing rather than writing again.',
          )
        }
        // THE CUSTOMER MUST ACTUALLY SETTLE DIRECTLY, or this is not the
        // correction the ruling describes — it would be inventing one.
        if (row.customer?.settlesDirectly !== true) {
          throw new Error(
            `${row.loadNumber}'s customer does not settle directly. ` +
              'This is not the row the ruling is about.',
          )
        }
        // AND IT MUST NOT ALREADY BE ON AN INVOICE. A direct-settled load
        // never becomes an invoice; if one has lines, somebody invoiced it and
        // flipping the flag now would leave a billed load claiming it is paid
        // by statement.
        if (row.invoiceLines.length > 0) {
          throw new Error(
            `${row.loadNumber} is on ${String(row.invoiceLines.length)} ` +
              'invoice line(s). Flipping the flag would contradict a real ' +
              'invoice. Refusing — this one needs a human decision.',
          )
        }
      }

      if (!WRITE) throw new Rehearsal()

      for (const row of found) {
        // ONE BOOLEAN, ONE ROW AT A TIME, BY ID. Not `updateMany` — the audit
        // extension reports `updateMany` as an unfollowable operation, and a
        // correction to billing data with no audit trail behind it is the one
        // thing this script must not leave behind.
        await tx.load.update({
          where: { id: row.id },
          data: { directSettled: true },
        })
      }

      // THE READ-BACK, INSIDE THE TRANSACTION. "2 rows updated" is the
      // driver's opinion; this asks the table.
      const after = await tx.load.findMany({
        where: { id: { in: found.map((row) => row.id) } },
        select: { loadNumber: true, directSettled: true },
        orderBy: { loadNumber: 'asc' },
      })
      console.log('\n  read-back:')
      for (const row of after) {
        console.log(
          `    ${row.loadNumber}  directSettled = ${String(row.directSettled)}`,
        )
      }
      if (after.some((row) => !row.directSettled)) {
        throw new Error('A row did not take the change. Rolling back.')
      }
    },
    {
      timeoutMs: 60_000,
      attribution: unattributed(
        'scripts/correct-direct-settled.ts — owner ruling 2026-10-01: loads ' +
          '1105 and 1108 were booked under Relay customers that were flipped ' +
          'to settlesDirectly afterwards, so they sit in Ready to invoice and ' +
          'can never be invoiced. Correcting the two rows; the predicate is ' +
          'unchanged.',
      ),
    },
  )
  console.log('\nCOMMITTED.')
} catch (error) {
  if (!(error instanceof Rehearsal)) throw error
  console.log('\nROLLED BACK — preview only.')
  console.log('Re-run with --write to commit. Owner runs that step.')
}

await db.$disconnect()
