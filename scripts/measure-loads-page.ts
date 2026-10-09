import { neonConfig } from '@neondatabase/serverless'
import { PrismaNeon } from '@prisma/adapter-neon'
import { PrismaClient } from '@/generated/prisma/client'
import { runInOrg, companyScopeFilter } from '@/lib/tenancy'
import { unattributed } from '@/lib/audit'
import { listedAuthorities } from '@/lib/companies'
import { viewContext, type LoadViewName } from '@/lib/load-views'
import {
  billingCountWhere,
  listWhere,
  loadListWhere,
  readLoadListParams,
  readyCountWhere,
  statusCountWhere,
  viewCountWhere,
} from '@/lib/load-list'

// ---------------------------------------------------------------------------
// WHAT THE LOADS LIST COSTS, READ BY READ, ON DEV (TMS-DESIGN-SYSTEM.md §6.7).
//
//   npx tsx -r dotenv/config scripts/measure-loads-page.ts
//
// READ ONLY. DEV. The same unit as `measure-dashboard-page.ts`: READER
// STATEMENTS, with the RLS frame counted apart.
//
// IT EXISTS FOR THE TWO READS §6.7 ADDED TO EVERY RENDER, the Upcoming and
// Unpaid counts. Upcoming carries the per-zone stop predicate, one arm per zone
// and two date columns per arm, over every load in the organization — so its
// cost is measured against dev's full history rather than assumed. It also
// times each date view as a LIST, because a dispatcher clicks those.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket

// THE FILE IS THE AUTHORITY, NOT THE SHELL: see `measure-dashboard-page.ts`.
const url = process.env.DIRECT_DATABASE_URL
if (!url) throw new Error('No DIRECT_DATABASE_URL.')
const host = new URL(url).hostname.split('.')[0] ?? ''
if (!host.includes('little-lake')) {
  throw new Error(`Refusing: ${host} is not dev's endpoint.`)
}
const db = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: url }),
  log: [{ emit: 'event', level: 'query' }],
})

let statements = 0
db.$on('query', (event) => {
  if (!/set_config|^BEGIN|^COMMIT|^DEALLOCATE/i.test(event.query.trim())) {
    statements++
  }
})

const org = await db.organization.findFirstOrThrow({
  where: { slug: 'zebra' },
  select: { id: true, name: true },
})

console.log(`org       ${org.name}`)
console.log(`host      ${host}\n`)

await runInOrg(
  db,
  org.id,
  async (tx) => {
    const authorities = await listedAuthorities(tx, [])
    const ctx = viewContext(authorities, new Date())
    const scope = companyScopeFilter([])
    const where = loadListWhere(readLoadListParams({}), scope, ctx)
    console.log(`today     ${ctx.today}   zones ${ctx.zones.length}\n`)

    const reads: { name: string; run: () => Promise<unknown> }[] = [
      {
        name: 'matching count',
        run: () => tx.load.count({ where: listWhere(where) }),
      },
      {
        name: 'status groupBy',
        run: () =>
          tx.load.groupBy({
            by: ['operationalStatus'],
            where: statusCountWhere(where),
            _count: { _all: true },
          }),
      },
      {
        name: 'billing groupBy',
        run: () =>
          tx.load.groupBy({
            by: ['billingStatus'],
            where: billingCountWhere(where),
            _count: { _all: true },
          }),
      },
      {
        name: 'ready count',
        run: () => tx.load.count({ where: readyCountWhere(where) }),
      },
      ...(['upcoming', 'unpaid'] as LoadViewName[]).map((name) => ({
        name: `${name} count (NEW, every render)`,
        run: () => tx.load.count({ where: viewCountWhere(where, name, ctx) }),
      })),
      ...(
        [
          ['picksUpToday', {}],
          ['deliversThisWeek', {}],
          ['pickup', { from: ctx.today, to: ctx.today }],
          ['delivery', { from: '2026-09-01', to: '2026-09-30' }],
        ] as const
      ).map(([name, bounds]) => ({
        name: `${name} as the list (on click)`,
        run: () =>
          tx.load.count({
            where: listWhere(
              loadListWhere(
                readLoadListParams({ view: name, ...bounds }),
                scope,
                ctx,
              ),
            ),
          }),
      })),
    ]

    console.log(
      `  ${'read'.padEnd(40)} ${'stmts'.padStart(5)} ${'ms'.padStart(6)} ${'rows'.padStart(7)}`,
    )
    for (const read of reads) {
      await read.run()
      statements = 0
      const started = Date.now()
      const result = await read.run()
      const ms = Date.now() - started
      const rows = typeof result === 'number' ? String(result) : '—'
      console.log(
        `  ${read.name.padEnd(40)} ${String(statements).padStart(5)} ${String(ms).padStart(6)} ${rows.padStart(7)}`,
      )
    }
  },
  {
    timeoutMs: 120_000,
    attribution: unattributed(
      'scripts/measure-loads-page.ts — read-only statement and timing ' +
        'census of the loads list and its date views',
    ),
  },
)

await db.$disconnect()
