import { neonConfig } from '@neondatabase/serverless'
import { PrismaNeon } from '@prisma/adapter-neon'
import { PrismaClient } from '@/generated/prisma/client'
import { runInOrg, companyScopeFilter } from '@/lib/tenancy'
import { unattributed } from '@/lib/audit'
import type { AuthorizedSession } from '@/lib/permissions'
import { actionQueue } from '@/lib/dashboard'
import {
  dqfSplit,
  panelFigures,
  topDriversByGross,
} from '@/lib/dashboard-counts'
import { dashboardFor } from '@/lib/dashboard-kpis'
import { DEFAULT_PERIOD, grainOf, periodWindow } from '@/lib/rolling-period'

// ---------------------------------------------------------------------------
// WHAT THE DASHBOARD COSTS, READ BY READ, ON DEV.
//
//   npx tsx -r dotenv/config scripts/measure-dashboard-page.ts
//
// READ ONLY. DEV.
//
// ── WHY THIS EXISTS BESIDE `measure-dashboard.ts` ────────────────────────
//
// That one measures `dashboardFor`. This one measures THE PAGE: all six reads
// the server component fires in one `Promise.all`, which is the thing the
// budget is actually about.
//
// IT EXISTS BECAUSE THE BUDGET WAS WRONG TWICE, both times by addition rather
// than by measurement. `dashboard-counts.ts` says the page is "4 + 1 + 1 + 1 =
// SEVEN" and part 3's brief inherited that seven. It was nine before part 3:
// `complianceCount` is THREE statements, not one, because `complianceQueue`
// builds rows out of three reads. Nobody had asked the driver.
//
// AGENTS.md: never supply the baseline you are testing. A statement budget
// computed by reading source counts what the author MEANT to send. This counts
// what went down the socket.
//
// ── THE UNIT IS NAMED, BECAUSE TWO HONEST ANSWERS DIFFER BY SIX ──────────
//
// Every `withCurrentOrg` opens a transaction and sets `app.current_org_id`, so
// six reads carry six `set_config` statements plus their BEGIN/COMMIT. Those
// are RLS overhead, not work the page asked for, and the historical figures (4
// for `dashboardFor`, 7 for the page) never counted them. So both numbers are
// printed and the budget one is named: READER STATEMENTS.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket

// THE FILE IS THE AUTHORITY, NOT THE SHELL. `DIRECT_DATABASE_URL` is exactly
// the variable a stray `$env:` assignment shadows — it happened on 2026-10-02
// and pointed a dev tool at production. `dotenv` does not override an
// already-set variable, so a shadowed shell would have measured the carrier's
// live database. The host is printed; the string never is.
const url = process.env.DIRECT_DATABASE_URL
if (!url) throw new Error('No DIRECT_DATABASE_URL.')

const db = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: url }),
  log: [{ emit: 'event', level: 'query' }],
})

let statements = 0
let overhead = 0
db.$on('query', (event) => {
  // `set_config` and the transaction frame are the RLS tax; everything else is
  // the page's own work. Counted apart rather than lumped in, so the number
  // that gets quoted in a commit message is the one the budget means.
  if (/set_config|^BEGIN|^COMMIT|^DEALLOCATE/i.test(event.query.trim())) {
    overhead++
  } else {
    statements++
  }
})

const org = await db.organization.findFirstOrThrow({
  where: { slug: 'zebra' },
  select: { id: true, name: true },
})

// AN OWNER, because the owner is the role that sees every panel — the money
// reads do not run at all for a dispatcher, so measuring as one would report a
// budget nobody is spending. No company chip: the whole group.
const session: AuthorizedSession = {
  userId: 'measurement',
  organizationId: org.id,
  role: 'OWNER',
  companyScopes: [],
}

// A FIXED CLOCK, so a number in a commit message still means something next
// week. The same Friday `measure-dashboard.ts` uses.
const NOW = new Date(Date.UTC(2026, 9, 2))
const period = DEFAULT_PERIOD
const window = periodWindow(period, NOW)

console.log(`org       ${org.name}`)
console.log(`host      ${new URL(url).hostname.split('.')[0]}`)
console.log(`as of     ${NOW.toISOString().slice(0, 10)}`)
console.log(`period    ${period} (${grainOf(period)})\n`)

/**
 * `who` IS WHY THE TOTAL IS NOT A SUM OF THE ROWS.
 *
 * The page issues a different set of reads per audience: a money role gets the
 * KPI series, the gross bars and the cash half of the panel statement; a
 * dispatcher gets none of those and the same panel statement WITHOUT its cash
 * columns. Both variants of `panelFigures` are measured, and adding them would
 * report a page nobody loads — which is what the first run of this census did,
 * printing 15 for a page that is 14 for an owner and 9 for a dispatcher.
 */
type Read = {
  name: string
  who: ('money' | 'dispatcher')[]
  run: () => Promise<unknown>
}

const reads: Read[] = []

await runInOrg(
  db,
  org.id,
  async (tx) => {
    reads.push(
      {
        name: 'dashboardFor (KPIs, bars, donuts, per-day)',
        who: ['money'],
        run: () =>
          dashboardFor(tx, org.id, null, window, { grain: grainOf(period) }),
      },
      {
        name: 'actionQueue (Needs you, 8 rows + compliance)',
        who: ['money', 'dispatcher'],
        run: () => actionQueue(tx, session, companyScopeFilter([])),
      },
      {
        name: 'panelFigures, money role (fleet+cash+compliance)',
        who: ['money'],
        run: () => panelFigures(tx, [], window, NOW, { cash: true }),
      },
      {
        // THE SAME STATEMENT WITHOUT ITS CASH HALF, which is what a dispatcher
        // spends. Measured rather than assumed to be cheaper.
        name: 'panelFigures, dispatcher (no cash columns)',
        who: ['dispatcher'],
        run: () => panelFigures(tx, [], window, NOW, { cash: false }),
      },
      {
        name: 'topDriversByGross (fleet bars)',
        who: ['money'],
        run: () => topDriversByGross(tx, [], window),
      },
      {
        name: 'dqfSplit (compliance donut)',
        who: ['money', 'dispatcher'],
        run: () => dqfSplit(tx, [], NOW),
      },
      {
        name: 'company.findMany (the chips)',
        who: ['money', 'dispatcher'],
        run: () =>
          tx.company.findMany({
            where: { isActive: true },
            orderBy: { name: 'asc' },
            select: { id: true, name: true },
          }),
      },
    )

    console.log(
      `  ${'read'.padEnd(50)} ${'who'.padEnd(11)} ${'stmts'.padStart(5)} ${'ms'.padStart(6)}`,
    )
    console.log(
      `  ${'-'.repeat(50)} ${'-'.repeat(11)} ${'-'.repeat(5)} ${'-'.repeat(6)}`,
    )

    const totals = { money: 0, dispatcher: 0 }
    const times = { money: 0, dispatcher: 0 }
    const counts = { money: 0, dispatcher: 0 }
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
        counts[who] += 1
      }
      const label = read.who.length === 2 ? 'both' : read.who[0]!
      console.log(
        `  ${read.name.padEnd(50)} ${label.padEnd(11)} ${String(statements).padStart(5)} ${String(ms).padStart(6)}`,
      )
    }

    console.log(
      `  ${'-'.repeat(50)} ${'-'.repeat(11)} ${'-'.repeat(5)} ${'-'.repeat(6)}`,
    )
    for (const who of ['money', 'dispatcher'] as const) {
      console.log(
        `  ${`READER STATEMENTS, ${who} role (the budget)`.padEnd(50)} ` +
          `${`${String(counts[who])} reads`.padEnd(11)} ` +
          `${String(totals[who]).padStart(5)} ${String(times[who]).padStart(6)}`,
      )
    }
    console.log(
      `  ${'+ RLS overhead, 1 set_config per transaction'.padEnd(50)} ${'each'.padEnd(11)} ${String(1).padStart(5)}`,
    )
    // COUNTED, NOT ASSUMED: this census runs all six inside ONE transaction, so
    // its own frame is one set_config and not six. Printed so the line above is
    // visibly an arithmetic claim about the page rather than a reading of it.
    console.log(
      `  ${'(this census opened 1 transaction; frames seen)'.padEnd(50)} ${String(overhead).padStart(5)}`,
    )
    console.log(
      `\n  SERIAL SUM ABOVE; THE PAGE RUNS THESE SIX CONCURRENTLY, so the wall`,
    )
    console.log(
      `  clock is the slowest transaction and not the total printed here.`,
    )
  },
  {
    timeoutMs: 300_000,
    attribution: unattributed(
      'scripts/measure-dashboard-page.ts — read-only statement and timing ' +
        'census of every read the dashboard page issues',
    ),
  },
)

await db.$disconnect()
console.log('')
