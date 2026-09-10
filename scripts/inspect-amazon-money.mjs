import { neonConfig, Pool } from '@neondatabase/serverless'

// ---------------------------------------------------------------------------
// DOES ANY PRE-CUTOVER AMAZON LOAD ALREADY CARRY ZEBRA MONEY?
//
// ── THE QUESTION BEHIND THE QUESTION ─────────────────────────────────────
//
// The owner's ruling of 2026-09-10: Zebra's revenue starts at the cutover, and
// pre-cutover Amazon money does not enter the books. That ruling is safe only
// if the answer here is zero. If some pre-cutover load ALREADY carries an
// invoice line, a settlement line or a payment application, then excluding its
// remittance leaves a half-entered figure behind — money on one side and
// nothing on the other, which is worse than either whole answer.
//
// ── FOUR WAYS A LOAD CAN CARRY MONEY, ASKED SEPARATELY ───────────────────
//
// `PaymentLoadApplication` — cash applied to it
// `InvoiceLine`            — billed from here
// `SettlementLine`         — a driver paid for it from here
// `LoadAccessorial`        — a charge added here
//
// Counted apart rather than OR-ed into one number, because they mean different
// things and only one of them (a settlement line) would mean somebody has
// already been paid twice.
//
// IT ONLY ASKS. Every statement is a SELECT and the fence in
// tests/prod-url-guard.test.ts holds it to that by name. The prose avoids the
// bare mutating SQL verbs on purpose — that fence scans this file's text.
//
//   node -r dotenv/config scripts/inspect-amazon-money.mjs
//   ZEBRA_TARGET=dev node -r dotenv/config scripts/inspect-amazon-money.mjs
// ---------------------------------------------------------------------------

const dev = process.env.ZEBRA_TARGET === 'dev'
const connectionString = dev
  ? process.env.DIRECT_DATABASE_URL
  : process.env.PROD_DIRECT_DATABASE_URL

if (!connectionString) {
  console.error(
    dev
      ? 'DIRECT_DATABASE_URL is not set.'
      : 'PROD_DIRECT_DATABASE_URL is not set.',
  )
  process.exit(1)
}

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false
const pool = new Pool({ connectionString, max: 1 })
const rows = async (text, values = []) => (await pool.query(text, values)).rows

/** The stated cutover. Never computed here — `loads.ts` owns it. */
const CUTOVER = '2026-08-01'

console.log(`Target: ${dev ? 'dev' : 'PRODUCTION'}`)
console.log(`Cutover: ${CUTOVER}`)

// WHICH LOADS ARE "AMAZON" — by the customer that settles directly, not by a
// name match. `settlesDirectly` is the discriminator the design already uses
// and the one the loads were booked under.
const [customers] = await rows(`
  SELECT COUNT(*)::int AS n,
         COALESCE(STRING_AGG(name, ', ' ORDER BY name), '(none)') AS names
    FROM "Customer"
   WHERE "deletedAt" IS NULL AND "settlesDirectly" = true
`)
console.log(`Direct-settled customers: ${customers.n} — ${customers.names}`)

// A load is PRE-CUTOVER when its first pickup is before the cutover day.
const SCOPE = `
  FROM "Load" l
  JOIN "Customer" cu ON cu.id = l."customerId"
 WHERE l."deletedAt" IS NULL
   AND cu."settlesDirectly" = true
   AND EXISTS (
     SELECT 1 FROM "LoadStop" s
      WHERE s."loadId" = l.id
        AND s.type::text = 'PICKUP'
        AND s."scheduledAt" < $1::timestamptz
   )
`

const [scope] = await rows(
  `SELECT COUNT(*)::int AS n, COALESCE(SUM(l."totalRevenueCents"), 0)::bigint AS cents ${SCOPE}`,
  [CUTOVER],
)
console.log(
  `\nPre-cutover direct-settled loads: ${scope.n}  ($${(Number(scope.cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })})`,
)

const CHECKS = [
  ['payment applications', '"PaymentLoadApplication"'],
  ['invoice lines', '"InvoiceLine"'],
  ['settlement lines', '"SettlementLine"'],
  ['accessorials', '"LoadAccessorial"'],
]

console.log('\nOf those, how many carry Zebra money:')
let worst = 0
for (const [label, table] of CHECKS) {
  const [hit] = await rows(
    `SELECT COUNT(*)::int AS n
       FROM (SELECT l.id ${SCOPE}) scoped
      WHERE EXISTS (SELECT 1 FROM ${table} x WHERE x."loadId" = scoped.id)`,
    [CUTOVER],
  )
  worst = Math.max(worst, hit.n)
  console.log(`  ${label.padEnd(22)} ${hit.n}`)
}

// AND THE SAME QUESTION WITHOUT THE DATE, so "zero before the cutover" is not
// mistaken for "zero anywhere" — the second is a different and larger claim.
console.log('\nFor contrast, every direct-settled load whatever its date:')
for (const [label, table] of CHECKS) {
  const [hit] = await rows(
    `SELECT COUNT(*)::int AS n
       FROM "Load" l
       JOIN "Customer" cu ON cu.id = l."customerId"
      WHERE l."deletedAt" IS NULL
        AND cu."settlesDirectly" = true
        AND EXISTS (SELECT 1 FROM ${table} x WHERE x."loadId" = l.id)`,
  )
  console.log(`  ${label.padEnd(22)} ${hit.n}`)
}

// ── AND WHERE DID THOSE ACCESSORIALS COME FROM? ──────────────────────────
//
// COUNT THE THING BEING CLAIMED. "Carries Zebra money" is not the same as
// "has an accessorial row": the Datatruck loads import wrote one for every
// export row with a `Total other pay` figure, so an accessorial on an IMPORTED
// load is transcribed history rather than money this system moved. Reporting
// them together turns a clean answer into a false alarm — which is what the
// first run of this script did.
const [split] = await rows(
  `SELECT
      COUNT(*) FILTER (WHERE l."externalId" IS NOT NULL)::int AS imported,
      COUNT(*) FILTER (WHERE l."externalId" IS NULL)::int AS own
     FROM "LoadAccessorial" a
     JOIN "Load" l ON l.id = a."loadId"
     JOIN "Customer" cu ON cu.id = l."customerId"
    WHERE l."deletedAt" IS NULL
      AND cu."settlesDirectly" = true
      AND EXISTS (
        SELECT 1 FROM "LoadStop" s
         WHERE s."loadId" = l.id AND s.type::text = 'PICKUP'
           AND s."scheduledAt" < $1::timestamptz
      )`,
  [CUTOVER],
)
console.log('\nPre-cutover accessorial rows, by provenance:')
console.log(`  on imported loads (transcribed history) ${split.imported}`)
console.log(`  on loads Zebra created itself           ${split.own}`)

// THE THREE THAT MEAN THIS SYSTEM MOVED MONEY. An accessorial is a figure
// carried on a load; these are entries in a ledger, and only a ledger entry
// can be left half-made by excluding a remittance.
const ledger = ['payment applications', 'invoice lines', 'settlement lines']
console.log(
  `\nVERDICT: the ledger relations that would be left half-made — ${ledger.join(', ')} — are the ones that matter here.`,
)
console.log(
  `         An accessorial written by the loads import is not one of them.`,
)

await pool.end()
