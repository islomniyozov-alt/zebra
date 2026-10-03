import { neonConfig } from '@neondatabase/serverless'
import { PrismaNeon } from '@prisma/adapter-neon'
import { PrismaClient } from '@/generated/prisma/client'
import { runInOrg } from '@/lib/tenancy'
import { unattributed } from '@/lib/audit'
import { dashboardFor } from '@/lib/dashboard-kpis'
import {
  PERIODS,
  bucketsIn,
  grainOf,
  isPartialBucket,
  periodWindow,
} from '@/lib/rolling-period'
import { grossByCompany, driverPayByCompany } from '@/lib/by-company'

// ---------------------------------------------------------------------------
// THE DASHBOARD'S QUERY COUNT, MILLISECONDS AND BUCKETS, PER PRESET, ON DEV.
//
//   npx tsx -r dotenv/config scripts/measure-dashboard.ts
//
// READ ONLY. DEV.
//
// ── THE COUNT IS COUNTED, NOT ASSERTED ───────────────────────────────────
//
// A Prisma `$on('query')` listener counts the statements the driver actually
// sends. Reading the source and counting `$queryRaw` calls would count what the
// author MEANT to send, and the point of a budget is that `Promise.all` of four
// readers can become more than four statements once a transaction and a
// `set_config` are involved.
//
// A PLAIN CLIENT, because `createPrismaClient` returns an `$extends`ed one that
// does not expose `$on`. Reads pass through the audit extension untouched.
//
// ── AND IT CHECKS ITEM 7 STILL AGREES ────────────────────────────────────
//
// `dashboard-kpis.ts` copies item 7's gross CASE. A copy tested against its
// original is a cache; one that is not is a second opinion about money.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket

const url = process.env.DIRECT_DATABASE_URL
if (!url) throw new Error('No DIRECT_DATABASE_URL.')
if (/prod/i.test(url)) throw new Error('That looks like production. Dev only.')

const db = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: url }),
  log: [{ emit: 'event', level: 'query' }],
})

let statements = 0
db.$on('query', () => {
  statements++
})

const org = await db.organization.findFirstOrThrow({
  where: { slug: 'zebra' },
  select: { id: true, name: true },
})

const money = (cents: number | null) =>
  cents === null
    ? '—'
    : `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`

console.log(`org       ${org.name}`)
console.log(`host      ${new URL(url).hostname.split('.')[0]}`)

// A FIXED CLOCK, so the numbers in a commit message mean something next week.
const NOW = new Date(Date.UTC(2026, 9, 2))
console.log(`as of     ${NOW.toISOString().slice(0, 10)} (a Friday)\n`)

await runInOrg(
  db,
  org.id,
  async (tx) => {
    console.log(
      `  ${'preset'.padEnd(6)} ${'window'.padEnd(23)} ${'grain'.padEnd(5)} ${'buckets'.padStart(7)} ${'stmts'.padStart(5)} ${'ms'.padStart(6)}  ${'gross'.padStart(12)}  partial`,
    )
    console.log(
      `  ${'-'.repeat(6)} ${'-'.repeat(23)} ${'-'.repeat(5)} ${'-'.repeat(7)} ${'-'.repeat(5)} ${'-'.repeat(6)}  ${'-'.repeat(12)}  -------`,
    )

    for (const key of PERIODS) {
      const window = periodWindow(key, NOW)
      const grain = grainOf(key)
      // WARM UP FIRST, so the first preset does not absorb the connection setup
      // and read as four times slower than the rest.
      await dashboardFor(tx, org.id, null, window, { grain })

      statements = 0
      const started = Date.now()
      const board = await dashboardFor(tx, org.id, null, window, { grain })
      const ms = Date.now() - started

      const last = bucketsIn(window, grain).at(-1)
      const partial =
        last === undefined
          ? '—'
          : isPartialBucket(last, grain, window.to)
            ? 'yes'
            : 'no'

      console.log(
        `  ${key.padEnd(6)} ` +
          `${`${window.from.toISOString().slice(0, 10)}..${window.to.toISOString().slice(0, 10)}`.padEnd(23)} ` +
          `${grain.padEnd(5)} ${String(board.weeks.length).padStart(7)} ` +
          `${String(statements).padStart(5)} ${String(ms).padStart(6)}  ` +
          `${money(board.kpis.grossCents).padStart(12)}  ${partial}`,
      )
    }

    // ── AGREEMENT WITH ITEM 7, OVER ONE OF THE WINDOWS ─────────────────
    const window = periodWindow('w13', NOW)
    const mine = await dashboardFor(tx, org.id, null, window, { grain: 'week' })
    const seven = await grossByCompany(tx, {
      grouping: 'week',
      from: window.from,
      to: window.to,
    })
    const sevenGross = seven.reduce((sum, row) => sum + row.grossCents, 0)
    const pay = await driverPayByCompany(tx, {
      grouping: 'week',
      from: window.from,
      to: window.to,
    })
    const sevenPay = pay.reduce((sum, row) => sum + row.driverPayCents, 0)

    console.log('\n  agreement with item 7, over the w13 window:')
    console.log(`    dashboardFor       ${money(mine.kpis.grossCents)}`)
    console.log(`    grossByCompany     ${money(sevenGross)}`)
    console.log(
      `    ${mine.kpis.grossCents === sevenGross ? 'AGREE to the cent' : 'DISAGREE — investigate'}`,
    )
    console.log(`    driverPayByCompany ${money(sevenPay)}`)
    console.log(
      `    pay known from     ${mine.payKnownFrom?.toISOString().slice(0, 10) ?? 'never'}`,
    )
  },
  {
    timeoutMs: 180_000,
    attribution: unattributed(
      'scripts/measure-dashboard.ts — read-only query-count, timing and bucket ' +
        'measurement for the dashboard, per rolling preset',
    ),
  },
)

await db.$disconnect()
console.log('')
