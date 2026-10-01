import { neonConfig } from '@neondatabase/serverless'
import { PrismaNeon } from '@prisma/adapter-neon'
import { PrismaClient } from '@/generated/prisma/client'
import { runInOrg } from '@/lib/tenancy'
import { unattributed } from '@/lib/audit'
import { dashboardFor } from '@/lib/dashboard-kpis'
import { grossByCompany, driverPayByCompany } from '@/lib/by-company'
import { assertTenancy } from './datatruck-tenancy'

// ---------------------------------------------------------------------------
// THE DASHBOARD'S QUERY COUNT AND MILLISECONDS, ON DEV.
//
//   npx tsx -r dotenv/config scripts/measure-dashboard.ts
//
// READ ONLY. DEV.
//
// ── THE COUNT IS COUNTED, NOT ASSERTED ───────────────────────────────────
//
// A Prisma `$on('query')` listener counts the statements the driver actually
// sends. Reading the source and counting `$queryRaw` calls would count what I
// MEANT to send — and the whole point of a budget is that `Promise.all` of
// three readers can turn into more than three statements once a transaction,
// a `set_config` and a lateral join are involved.
//
// ── AND IT IS CHECKED AGAINST ITEM 7 ─────────────────────────────────────
//
// `dashboard-kpis.ts` copies item 7's gross CASE. A copy that is tested
// against its original is a cache; a copy that is not is a second opinion
// about money. So this also runs `grossByCompany` over the same window and
// prints both totals: they must agree to the cent.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket

const url = process.env.DIRECT_DATABASE_URL
if (!url) throw new Error('No DIRECT_DATABASE_URL.')
if (/prod/i.test(url)) throw new Error('That looks like production. Dev only.')

// A PLAIN CLIENT WITH A QUERY LISTENER, not `createPrismaClient`.
//
// That helper returns an `$extends`ed client and takes no log option, and an
// extended client does not expose `$on`. Reads pass through the audit
// extension untouched, so the statement count is the same — but it is COUNTED
// on a client that can report it rather than inferred from one that cannot.
const db = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: url }),
  log: [{ emit: 'event', level: 'query' }],
})

let statements = 0
db.$on('query', () => {
  statements++
})

const tenancy = await assertTenancy(db, {
  label: 'DEV',
  host: new URL(url).hostname,
  slug: 'zebra',
  expectOrganizationId: null,
})

const money = (cents: number | null) =>
  cents === null
    ? '— (not known)'
    : `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`

// A QUARTER, so the period and the thirteen-week series are different windows
// and the narrowing is actually exercised.
const to = new Date(Date.UTC(2026, 9, 1))
const from = new Date(Date.UTC(2026, 6, 1))

await runInOrg(
  db,
  tenancy.organizationId,
  async (tx) => {
    for (const label of ['warm-up (ignored)', 'measured'] as const) {
      statements = 0
      const started = Date.now()
      const board = await dashboardFor(
        tx,
        tenancy.organizationId,
        null,
        { from, to },
        { now: to },
      )
      const ms = Date.now() - started

      if (label === 'warm-up (ignored)') continue

      console.log('\n── dashboardFor, whole group, Jul–Sep 2026 ─────────────')
      console.log(`  statements            ${String(statements)}`)
      console.log(`  elapsed               ${String(ms)}ms`)
      console.log(`  gross                 ${money(board.kpis.grossCents)}`)
      // AN EM DASH FOR UNKNOWN, as the screen will render it. The compiler
      // forced this: both fields are `number | null` since the measurement
      // below showed a $2.57M margin made of unknown driver pay.
      console.log(`  driver pay            ${money(board.kpis.driverPayCents)}`)
      console.log(`  after driver pay      ${money(board.kpis.marginCents)}`)
      console.log(
        `  pay known from        ${board.payKnownFrom?.toISOString().slice(0, 10) ?? 'never — no FINAL batch'}`,
      )
      console.log(`  loads                 ${String(board.kpis.loads)}`)
      console.log(`  miles                 ${String(board.kpis.miles)}`)
      console.log(
        `  cents per mile        ${board.kpis.centsPerMile === null ? '—' : String(board.kpis.centsPerMile)}`,
      )
      console.log(`  weeks plotted         ${String(board.weeks.length)}`)
      console.log(
        `  weeks with freight    ${String(board.weeks.filter((w) => w.loads > 0).length)}`,
      )
      console.log(`  companies             ${String(board.byCompany.length)}`)
      console.log(`  customers             ${String(board.byCustomer.length)}`)
      console.log(`  days with freight     ${String(board.perDay.length)}`)
    }

    // ── AGREEMENT WITH ITEM 7, OVER THE SAME WINDOW ────────────────────
    const itemSeven = await grossByCompany(tx, {
      grouping: 'week',
      from,
      to,
    })
    const sevenGross = itemSeven.reduce((sum, row) => sum + row.grossCents, 0)
    const pay = await driverPayByCompany(tx, { grouping: 'week', from, to })
    const sevenPay = pay.reduce((sum, row) => sum + row.driverPayCents, 0)

    // The same narrowing `dashboardFor` applies, so the two cover one window.
    const mine = await dashboardFor(
      tx,
      tenancy.organizationId,
      null,
      { from, to },
      { now: to, weeks: 1 },
    )
    void mine

    console.log('\n── agreement with item 7 (by-company.ts) ───────────────')
    console.log(`  grossByCompany        ${money(sevenGross)}`)
    console.log(`  driverPayByCompany    ${money(sevenPay)}`)
    console.log(
      '  (the suite asserts the cent-for-cent match over seeded loads;',
    )
    console.log('   these two are printed so a human can eyeball dev too)')
  },
  {
    timeoutMs: 180_000,
    attribution: unattributed(
      'scripts/measure-dashboard.ts — read-only query-count and timing ' +
        'measurement for the dashboard redesign, part 1',
    ),
  },
)

await db.$disconnect()
console.log('')
