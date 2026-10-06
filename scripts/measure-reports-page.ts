import { neonConfig } from '@neondatabase/serverless'
import { PrismaNeon } from '@prisma/adapter-neon'
import { PrismaClient } from '@/generated/prisma/client'
import { runInOrg } from '@/lib/tenancy'
import { unattributed } from '@/lib/audit'
import { DEFAULT_PERIOD, grainOf, periodWindow } from '@/lib/rolling-period'
import {
  deductionsByCategory,
  receivablesSeries,
  scopeSql,
  settlementsPaidSeries,
} from '@/lib/accounting-reports'
import { agingSums } from '@/lib/factoring'
import {
  driverPayByCompany,
  salaryByDriverWeek,
  firstSettledPeriodStart,
  grossByCompany,
} from '@/lib/by-company'

// ---------------------------------------------------------------------------
// WHAT /accounting/reports COSTS, READ BY READ, ON DEV.
//
//   npx tsx -r dotenv/config scripts/measure-reports-page.ts
//
// READ ONLY. DEV.
//
// The same instrument as `measure-dashboard-page.ts` and for the same reason:
// §6.2.7 asks for the query count and the milliseconds, and a count obtained by
// reading the source counts what the author MEANT to send. A `$on('query')`
// listener counts what went down the socket.
//
// ── TWO TOTALS, BECAUSE THE SCREEN HAS THREE CUTS ────────────────────────
//
// The charts answer for the window and the authority, which the tabs do not
// change, so they are read once for every cut. The driver cut then adds its own
// list read and the column preference; the two matrix cuts add item 7's three.
// Adding every row would report a page nobody loads.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket

// THE FILE'S VALUE, NOT THE SHELL'S. `DIRECT_DATABASE_URL` is exactly the
// variable a stray `$env:` assignment shadows — it happened on 2026-10-02 and
// pointed a dev tool at production. The host is printed; the string never is.
const url = process.env.DIRECT_DATABASE_URL
if (!url) throw new Error('No DIRECT_DATABASE_URL.')

const db = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: url }),
  log: [{ emit: 'event', level: 'query' }],
})

let statements = 0
db.$on('query', (event) => {
  // `set_config` and the transaction frame are the RLS tax, not work the page
  // asked for. Counted apart so the quoted number is the one the budget means.
  if (!/set_config|^BEGIN|^COMMIT|^DEALLOCATE/i.test(event.query.trim())) {
    statements++
  }
})

const org = await db.organization.findFirstOrThrow({
  where: { slug: 'zebra' },
  select: { id: true, name: true },
})

// A FIXED CLOCK, so a number in a commit message still means something next
// week. The same Friday the dashboard census uses.
const NOW = new Date(Date.UTC(2026, 9, 2))
const period = DEFAULT_PERIOD
const grain = grainOf(period)
const window = periodWindow(period, NOW)

console.log(`org       ${org.name}`)
console.log(`host      ${new URL(url).hostname.split('.')[0]}`)
console.log(`as of     ${NOW.toISOString().slice(0, 10)}`)
console.log(`period    ${period} (${grain})\n`)

type Read = {
  name: string
  who: ('charts' | 'matrix' | 'driver')[]
  run: () => Promise<unknown>
}

await runInOrg(
  db,
  org.id,
  async (tx) => {
    const reads: Read[] = [
      {
        name: 'receivablesSeries (invoiced / factored / collected)',
        who: ['charts'],
        run: () => receivablesSeries(tx, [], window, grain),
      },
      {
        name: 'settlementsPaidSeries (gross vs net)',
        who: ['charts'],
        run: () => settlementsPaidSeries(tx, [], window, grain),
      },
      {
        name: 'deductionsByCategory (the donut)',
        who: ['charts'],
        run: () => deductionsByCategory(tx, [], window),
      },
      {
        name: 'agingSums (shared with the Cash panel)',
        who: ['charts'],
        run: () => agingSums(tx, scopeSql('i', []), NOW),
      },
      {
        name: 'company.findMany (the chips)',
        who: ['charts'],
        run: () =>
          tx.company.findMany({
            where: { isActive: true },
            orderBy: { name: 'asc' },
            select: { id: true, name: true },
          }),
      },
      {
        name: 'grossByCompany (item 7)',
        who: ['matrix'],
        run: () =>
          grossByCompany(tx, {
            grouping: 'week',
            from: window.from,
            to: window.to,
          }),
      },
      {
        name: 'driverPayByCompany (item 7)',
        who: ['matrix'],
        run: () =>
          driverPayByCompany(tx, {
            grouping: 'week',
            from: window.from,
            to: window.to,
          }),
      },
      {
        name: 'firstSettledPeriodStart (the em-dash rule)',
        who: ['matrix'],
        run: () => firstSettledPeriodStart(tx),
      },
      {
        name: 'salaryByDriverWeek (the driver cut)',
        who: ['driver'],
        run: () =>
          salaryByDriverWeek(tx, {
            from: window.from,
            to: window.to,
            companyId: null,
          }),
      },
    ]

    console.log(
      `  ${'read'.padEnd(52)} ${'cut'.padEnd(8)} ${'stmts'.padStart(5)} ${'ms'.padStart(6)}`,
    )
    console.log(
      `  ${'-'.repeat(52)} ${'-'.repeat(8)} ${'-'.repeat(5)} ${'-'.repeat(6)}`,
    )

    const totals = { charts: 0, matrix: 0, driver: 0 }
    const times = { charts: 0, matrix: 0, driver: 0 }
    for (const read of reads) {
      // WARM UP FIRST, so the first read does not absorb connection setup and
      // read as four times slower than the rest.
      await read.run()
      statements = 0
      const started = Date.now()
      await read.run()
      const ms = Date.now() - started
      for (const who of read.who) {
        totals[who] += statements
        times[who] += ms
      }
      console.log(
        `  ${read.name.padEnd(52)} ${read.who[0]!.padEnd(8)} ${String(statements).padStart(5)} ${String(ms).padStart(6)}`,
      )
    }

    console.log(
      `  ${'-'.repeat(52)} ${'-'.repeat(8)} ${'-'.repeat(5)} ${'-'.repeat(6)}`,
    )
    console.log(
      `  ${'CHARTS, on every cut'.padEnd(52)} ${''.padEnd(8)} ${String(totals.charts).padStart(5)} ${String(times.charts).padStart(6)}`,
    )
    console.log(
      `  ${'+ the company / week matrix'.padEnd(52)} ${''.padEnd(8)} ${String(totals.matrix).padStart(5)} ${String(times.matrix).padStart(6)}`,
    )
    console.log(
      `  ${'+ the driver cut, plus readGridColumns'.padEnd(52)} ${''.padEnd(8)} ${String(totals.driver + 1).padStart(5)} ${String(times.driver).padStart(6)}`,
    )
    console.log(
      `\n  SO: ${String(totals.charts + totals.matrix)} statements on a matrix cut, ` +
        `${String(totals.charts + totals.driver + 1)} on the driver cut.`,
    )
    console.log(
      `  readGridColumns is counted as 1 and not measured: it reads one\n` +
        `  preference row and only the driver cut asks for it.`,
    )
  },
  {
    timeoutMs: 300_000,
    attribution: unattributed(
      'scripts/measure-reports-page.ts — read-only statement and timing ' +
        'census of every read /accounting/reports issues',
    ),
  },
)

await db.$disconnect()
console.log('')
