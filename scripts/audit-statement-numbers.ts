import { neonConfig } from '@neondatabase/serverless'
import { createPrismaClient } from '@/lib/db'

// ---------------------------------------------------------------------------
// WHICH STATEMENTS CARRY AN INTERNAL ID INSTEAD OF A NUMBER.
//
//   npx tsx -r dotenv/config scripts/audit-statement-numbers.ts
//   npx tsx -r dotenv/config scripts/audit-statement-numbers.ts --production
//
// SELECT ONLY. Owner's ruling, 2026-09-30: "a settlement marked PAID must
// carry a number, not a DRAFT- id". This counts the rows that break it before
// anything is changed, on whichever database is named — because "how many"
// is the question a repair has to answer first, and the answer differs
// between dev and production.
//
// COUNTED PER STATUS, not in total. A DRAFT holding a placeholder is the
// system working as designed; an APPROVED or PAID one is the defect. A single
// number covering both would be the "count the thing you are claiming"
// mistake from AGENTS.md — a superset that hides the row that matters.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket

const PRODUCTION = process.argv.includes('--production')
const url = PRODUCTION
  ? process.env.PROD_DIRECT_DATABASE_URL
  : process.env.DIRECT_DATABASE_URL

if (!url) {
  throw new Error(
    PRODUCTION
      ? 'No PROD_DIRECT_DATABASE_URL in the environment.'
      : 'No DIRECT_DATABASE_URL in the environment.',
  )
}

// THE ALLOWLIST, IN SQL, ONCE. §8 as amended in v10.4: a statement is named
// only if it carries an issued series. This mirrors `isPlaceholderNumber` and
// exists in one string so the two cannot drift — an audit that counted
// `DRAFT-%` while the code checked something else would be an instrument that
// had inherited the belief it was meant to test.
const IS_NAMED = `("settlementNumber" LIKE 'ST-%' OR "settlementNumber" LIKE 'STL-%')`

const db = createPrismaClient(url)

console.log(`Target: ${PRODUCTION ? 'PRODUCTION' : 'DEV'}`)
console.log(`Host:   ${url.split('@')[1]?.split('/')[0] ?? '?'}\n`)

const rows = await db.$queryRawUnsafe<
  { status: string; placeholders: bigint; total: bigint }[]
>(`
  SELECT status,
         COUNT(*) FILTER (WHERE NOT ${IS_NAMED}) AS placeholders,
         COUNT(*) AS total
    FROM "Settlement"
   WHERE "deletedAt" IS NULL
   GROUP BY status
   ORDER BY status
`)

console.log('status      placeholder / total')
for (const row of rows) {
  console.log(
    `  ${row.status.padEnd(10)} ${String(row.placeholders).padStart(5)} / ${row.total}`,
  )
}

const offending = await db.$queryRawUnsafe<
  {
    id: string
    settlementNumber: string
    status: string
    periodStart: Date
    netCents: number
  }[]
>(`
  SELECT id, "settlementNumber", status, "periodStart", "netCents"
    FROM "Settlement"
   WHERE "deletedAt" IS NULL
     AND NOT ${IS_NAMED}
     AND status <> 'DRAFT'
   ORDER BY "periodStart", "settlementNumber"
`)

console.log(`\nNOT A DRAFT AND STILL HOLDING AN ID: ${offending.length}`)
for (const row of offending) {
  console.log(
    `  ${row.status.padEnd(9)} ${row.settlementNumber}  ` +
      `${row.periodStart.toISOString().slice(0, 10)}  ` +
      `net ${(row.netCents / 100).toFixed(2)}`,
  )
}

// ── AND WHAT THE SERIES IS ACTUALLY AT ───────────────────────────────────
//
// A repair allocates the NEXT number, so the numbers already issued and the
// counter behind them are the two facts that say whether the next one will
// collide. Read from the database rather than assumed — the backfill script
// that guessed a series key is why this prints both.
const issued = await db.$queryRawUnsafe<
  { settlementNumber: string; status: string }[]
>(`
  SELECT "settlementNumber", status FROM "Settlement"
   WHERE "deletedAt" IS NULL AND ${IS_NAMED}
   ORDER BY "settlementNumber"
`)
console.log(
  `
ISSUED NUMBERS (${issued.length}): ` +
    (issued.map((r) => `${r.settlementNumber}/${r.status}`).join(', ') ||
      '(none)'),
)

const counters = await db.$queryRawUnsafe<{ key: string; value: number }[]>(`
  SELECT key, value FROM "SeriesCounter" ORDER BY key
`)
// WHICH SETTLEMENTS HAVE NO BATCH. The statement PDF route refuses those with
// a 409, so they are the rows that would have no document at all if the older
// renderer were retired. Counted rather than assumed before anything is
// deleted.
const batchless = await db.$queryRawUnsafe<
  { settlementNumber: string; status: string }[]
>(`
  SELECT "settlementNumber", status FROM "Settlement"
   WHERE "deletedAt" IS NULL AND "batchId" IS NULL
   ORDER BY "settlementNumber"
`)
console.log(
  `
NO BATCH (${batchless.length}): ` +
    (batchless.map((r) => `${r.settlementNumber}/${r.status}`).join(', ') ||
      '(none)'),
)

console.log(
  'SERIES COUNTERS: ' +
    (counters.map((r) => `${r.key}=${r.value}`).join(', ') || '(none)'),
)

await db.$disconnect()
