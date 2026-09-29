import { neonConfig } from '@neondatabase/serverless'
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'
import { readBatches } from '@/lib/accounting-grids'

// ---------------------------------------------------------------------------
// WHAT THE BATCHES GRID COSTS, BEFORE AND AFTER.
//
//   npx tsx -r dotenv/config scripts/measure-batches-read.ts
//
// Owner's ruling, 2026-09-29: move the per-company breakdown into grouped SQL
// like item 7's `grossByCompany`, and MEASURE it.
//
// ── COUNTED FROM THE DRIVER, NOT FROM A BELIEF ────────────────────────────
//
// `$on('query')` counts what actually reached Postgres. The alternative —
// reading the code and reasoning about how many statements it ought to make —
// is supplying the baseline you are testing, which AGENTS.md names as the
// instrument failure that costs whole sessions. The money screen's own
// `relationJoins` note carries measured before-and-after numbers for the same
// reason, and this is that note's shape.
//
// DEV ONLY: this file does not name the production connection variable.
// ---------------------------------------------------------------------------

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

const RUNS = 3

async function main(): Promise<void> {
  const connectionString = process.env.DIRECT_DATABASE_URL
  if (!connectionString) throw new Error('No dev database url.')

  // A PLAIN CLIENT WITH THE QUERY EVENT ON. `createPrismaClient` returns the
  // app's Proxy-wrapped, per-request client, which does not expose `$on` — so
  // this builds the one `this-week-timing.test.ts` builds, for the same reason
  // and by the same route.
  const client = new PrismaClient({
    adapter: new PrismaNeon({ connectionString }),
    log: [{ emit: 'event', level: 'query' }],
  })

  let statements = 0
  client.$on('query', () => {
    statements += 1
  })

  try {
    // WARM THE COMPUTE OUTSIDE THE MEASUREMENT. A fresh client's first
    // statement pays for the connection, the handshake and — on Neon after
    // autosuspend — waking the compute. That is latency, not the read.
    await client.$queryRaw`select 1`
    await client.$executeRawUnsafe(
      `SELECT set_config('app.current_org_id', $1, true)`,
      (
        await client.organization.findFirstOrThrow({
          where: { slug: 'zebra' },
          select: { id: true },
        })
      ).id,
    )

    const timings: number[] = []
    let counted = 0
    for (let run = 0; run < RUNS; run++) {
      statements = 0
      const started = Date.now()
      const rows = await readBatches(client as never, {})
      const took = Date.now() - started
      timings.push(took)
      counted = statements
      const authorities = rows.reduce(
        (sum, row) => sum + row.breakdown.length,
        0,
      )
      console.log(
        `run ${run + 1}: ${took}ms, ${statements} statement(s), ` +
          `${rows.length} batch(es), ${authorities} authority row(s)`,
      )
    }

    console.log(
      `
best ${Math.min(...timings)}ms, worst ${Math.max(...timings)}ms, ` +
        `${counted} statement(s) per read`,
    )
  } finally {
    await client.$disconnect()
  }
}

await main()
