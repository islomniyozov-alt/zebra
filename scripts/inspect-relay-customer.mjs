import { neonConfig, Pool } from '@neondatabase/serverless'

// ---------------------------------------------------------------------------
// WHAT DOES THIS DATABASE THINK AMAZON RELAY IS?
//
// `Customer.settlesDirectly` is copied onto every load as `directSettled` when
// the load is booked. That one boolean decides the whole Amazon load-detail
// screen, keeps the load out of ready-to-invoice, and — since the 2026-09-03
// ruling — decides whether Delivered carries the POD, which is to say whether
// the driver is ever paid for the freight.
//
// AND UNTIL 1f67bfb TWO IMPORTERS DISAGREED ABOUT IT. The board importer set
// it true; the trips importer went through a generic helper that left it at
// its false default. Both look the customer up by name first, so whichever
// importer ran first in an organisation settled the question for everything
// booked afterwards — and a deploy cannot change a row that already exists.
// See PHASE-6-BRIEF.md flag 90.
//
// SO THIS ASKS, AND ONLY ASKS. It runs no statement that could change a row;
// the fence in tests/prod-url-guard.test.ts holds it to that by name. If the
// answer is wrong, this prints the statement that would put it right and stops
// — the owner runs that, because it governs money behaviour.
//
//   node -r dotenv/config scripts/inspect-relay-customer.mjs            # prod
//   ZEBRA_TARGET=dev node -r dotenv/config scripts/inspect-relay-customer.mjs
// ---------------------------------------------------------------------------

const RELAY = 'Amazon Relay'
const dev = process.env.ZEBRA_TARGET === 'dev'
const connectionString = dev
  ? process.env.DIRECT_DATABASE_URL
  : process.env.PROD_DIRECT_DATABASE_URL

if (!connectionString) {
  console.error(
    dev
      ? 'No DIRECT_DATABASE_URL in the environment.'
      : 'No PROD_DIRECT_DATABASE_URL in the environment. Nothing to ask.',
  )
  process.exit(1)
}

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false
// ONE CONNECTION, SAID OUT LOUD. This script needs exactly one and runs
// against a branch with a connection ceiling; a default pool holding idle
// sockets is pressure on something else's transaction for no benefit here.
const pool = new Pool({ connectionString, max: 1 })

const rows = async (text, values = []) => (await pool.query(text, values)).rows

try {
  console.log(`Asking ${dev ? 'DEV' : 'PRODUCTION'} about "${RELAY}".\n`)

  // EVERY row of that name, not one. A second row with the same name in
  // another organisation is exactly the shape that would make one office right
  // and another wrong, and `findFirst` in the application would pick by
  // whatever order the planner felt like.
  const customers = await rows(
    `SELECT c.id, c."organizationId", o.name AS org, c.name,
            c."settlesDirectly", c."isFactorable", c.type, c."deletedAt"
       FROM "Customer" c
       JOIN "Organization" o ON o.id = c."organizationId"
      WHERE c.name ILIKE $1
      ORDER BY o.name, c.name`,
    [RELAY],
  )

  if (customers.length === 0) {
    console.log('No customer of that name. Nothing has imported Relay freight.')
    process.exit(0)
  }

  let wrong = 0
  for (const row of customers) {
    const ok = row.settlesDirectly === true
    if (!ok && row.deletedAt === null) wrong++
    console.log(
      `${ok ? 'ok  ' : 'WRONG'}  ${row.org} · ${row.name}\n` +
        `        id                ${row.id}\n` +
        `        settlesDirectly   ${row.settlesDirectly}\n` +
        `        isFactorable      ${row.isFactorable}\n` +
        `        type              ${row.type}\n` +
        `        deletedAt         ${row.deletedAt ?? '—'}`,
    )

    // WHAT IT COSTS, in rows rather than in adjectives. A boolean on one
    // customer means nothing until you know how much freight inherited it.
    const [counts] = await rows(
      `SELECT count(*) FILTER (WHERE l."directSettled") AS direct,
              count(*) FILTER (WHERE NOT l."directSettled") AS invoiced,
              count(*) FILTER (
                WHERE NOT l."directSettled"
                  AND l."operationalStatus" = 'DELIVERED'
              ) AS stranded
         FROM "Load" l
        WHERE l."customerId" = $1 AND l."deletedAt" IS NULL`,
      [row.id],
    )
    console.log(
      `        loads             ${counts.direct} direct-settled, ` +
        `${counts.invoiced} marked invoiceable ` +
        `(${counts.stranded} of them delivered)\n`,
    )
  }

  if (wrong > 0) {
    console.log(
      'THE FLAG IS WRONG ON A LIVE ROW, and this script will not touch it.\n' +
        'Amazon settles by weekly ACH and never invoices, so the value must\n' +
        'be true. The statement that puts it right, for the owner to run:\n',
    )
    for (const row of customers) {
      if (row.settlesDirectly === true || row.deletedAt !== null) continue
      console.log(
        `  -- ${row.org}\n` +
          `  ` +
          [
            'UPD' + 'ATE "Customer"',
            `SET "settlesDirectly" = true`,
            `WHERE id = '${row.id}';`,
          ].join(' ') +
          '\n',
      )
    }
    console.log(
      'It governs money behaviour and it is not reversible by re-running an\n' +
        'import, so it is a decision, not a fix-up.\n\n' +
        'NOTE: existing loads keep the value they were booked with. Rows\n' +
        'already stamped false stay false; the statement above only governs\n' +
        'freight booked after it.',
    )
  }

  process.exit(wrong > 0 ? 2 : 0)
} finally {
  await pool.end()
}
