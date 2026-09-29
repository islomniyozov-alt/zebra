import { describe, expect, it } from 'vitest'
import { retryingClient } from './retrying-client'
import { withOrg } from '@/lib/tenancy'
import { unattributed } from '@/lib/audit'
import { thisWeekFor } from '@/lib/this-week'
import { SETTLEMENT_BATCH_TIMEOUT_MS } from '@/lib/settlement-batch'
import { payWeekFor } from '@/lib/settlement-week'

// ---------------------------------------------------------------------------
// WHAT THE TUESDAY SCREEN COSTS, MEASURED.
//
// The brief requires this page inside the five-second transaction budget on
// production's fourteen thousand loads, and says to measure it rather than
// assume. So this reads the LARGEST organization on the dev database — the one
// seeded from the Datatruck export — and prints the cost per section.
//
// IT IS A MEASUREMENT, NOT A THRESHOLD TEST. Asserting "under 5000ms" against a
// shared database over a network makes a flaky test out of a real question; the
// number is printed, and the budget conversation happens where the number is
// read.
//
// AND IT LIVES IN THE `node` PROJECT, WHICH IS THE WHOLE POINT. The integration
// project runs against per-worker CLONES of an empty template, so a timing test
// there measures a database with no rows in it and reports a reassuring number
// about nothing. That dead end has been walked once already in this repository,
// on a policy change that was invisible for the same reason.
// ---------------------------------------------------------------------------

/**
 * How many round trips the page costs, counted rather than reasoned about.
 *
 * A SEPARATE CLIENT WITH THE QUERY LOG ON. The shared one goes through the
 * audit extension and is what the timing above measures; this one exists only
 * to count, and counts `query` events, which is one per statement sent.
 */
async function countQueries(
  organizationId: string,
  period: Parameters<typeof thisWeekFor>[1]['period'],
  payDay: Date,
): Promise<{ page: number; raw: number }> {
  const { PrismaClient } = await import('@/generated/prisma/client')
  const { PrismaNeon } = await import('@prisma/adapter-neon')
  const client = new PrismaClient({
    adapter: new PrismaNeon({
      connectionString: process.env.DIRECT_DATABASE_URL!,
    }),
    log: [{ emit: 'event', level: 'query' }],
  })

  let count = 0
  client.$on('query', () => {
    count++
  })

  // ── WARM THE COMPUTE BEFORE THE TRANSACTION OPENS ──────────────────────
  //
  // THIS IS WHERE THE FLAKE WAS. A fresh client's first statement pays for the
  // connection and the handshake, and this one paid for it INSIDE the
  // transaction — so the 5s interactive-transaction budget was spent on a cold
  // start before any of the page's own work began. The failure said so
  // exactly: "6111 ms passed since the start of the transaction".
  //
  // AND THE COMPUTE REALLY IS COLD. Measured 2026-09-18:
  // `pg_postmaster_start_time` was 00:07:28 against a run that began at
  // 00:07:05 — Neon's autosuspend had released it, and the run itself woke it
  // up 23 seconds in. Every run pays that once.
  //
  // It cost five gates in one day, always the same way, and it was never a
  // finding about the money screen — this function only COUNTS queries, and
  // the count is latency-independent. One trivial statement outside the
  // transaction moves the cold start where it belongs.
  await client.$queryRaw`select 1`

  await client.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.current_org_id', $1, true)`,
        organizationId,
      )
      await thisWeekFor(tx as never, { period, payDay })
    },
    // THE BUDGET, NAMED. This ran on Prisma's 5s default and tipped over at
    // 7.5s on 2026-09-29 — the same fault as `integrity.test.ts` an hour
    // earlier, in the same file as a transaction that already had one. Counting
    // the call sites is what found it; see `transaction-budget.test.ts`.
    { timeout: SETTLEMENT_BATCH_TIMEOUT_MS },
  )
  await client.$disconnect()

  // Minus the BEGIN/COMMIT pair, the `set_config` this harness added, and the
  // `select 1` that warmed the connection. FOUR, not three — the listener
  // counts every statement this client sends, including the warm-up, and a
  // warm-up left out of the subtraction would inflate the page's cost by one
  // round trip for ever.
  // BOTH NUMBERS TRAVEL. `page` is what the screen costs; `raw` is every
  // statement this client sent, so the caller can assert that the harness's
  // own four are accounted for rather than trusting the arithmetic here.
  return { page: Math.max(0, count - 4), raw: count }
}

describe('the cost of the money screen', () => {
  it('reports the time per section against the busiest organization', async () => {
    const owner = retryingClient(process.env.DIRECT_DATABASE_URL!)

    // THE BUSIEST ONE, CHOSEN BY COUNTING — not by name, which would be a
    // guess about which seed happened to be biggest today.
    const busiest = await owner.load.groupBy({
      by: ['organizationId'],
      _count: { _all: true },
      orderBy: { _count: { id: 'desc' } },
      take: 1,
    })

    if (busiest.length === 0) {
      console.log('[this-week] no loads on dev; nothing to measure')
      await owner.$disconnect()
      return
    }

    const organizationId = busiest[0]!.organizationId
    const loads = busiest[0]!._count._all
    const companies = await owner.company.count({
      where: { organizationId, isActive: true },
    })

    const { period, payDay } = payWeekFor(new Date())
    // WARM FIRST, THEN MEASURE, AND PRINT BOTH. The first query through a fresh
    // client pays for the connection and the handshake; charging that to the
    // page makes it look slower than any second page view is. But the cold
    // number is what the first person in on Tuesday actually waits for, so it
    // is printed rather than hidden — and the trivial query it runs also
    // measures what a `withOrg` transaction costs before it does any work.
    const coldStarted = Date.now()
    await withOrg(organizationId, (tx) => tx.company.count(), {
      attribution: unattributed('timing probe warm-up; reads only'),
      timeoutMs: SETTLEMENT_BATCH_TIMEOUT_MS,
    })
    const overhead = Date.now() - coldStarted

    const started = Date.now()
    const week = await withOrg(
      organizationId,
      (tx) => thisWeekFor(tx, { period, payDay }),
      {
        // UNATTRIBUTED, DELIBERATELY AND IN WORDS: this reads and writes
        // nothing, and the audit extension requires the reason rather than
        // letting a missing argument become a silent gap.
        attribution: unattributed('timing probe; reads only'),
        timeoutMs: SETTLEMENT_BATCH_TIMEOUT_MS,
      },
    )
    const total = Date.now() - started

    console.log(
      `\n[this-week] ${String(loads)} loads, ${String(companies)} active companies`,
    )
    for (const [section, ms] of Object.entries(week.timings).sort(
      (a, b) => b[1] - a[1],
    )) {
      console.log(`[this-week]   ${section.padEnd(12)} ${String(ms)}ms`)
    }
    // ── THE NUMBER THAT TRANSFERS ────────────────────────────────────────
    //
    // Milliseconds measured here are milliseconds from a development machine
    // roughly 200ms from us-east-2; a Worker sits far closer to the database,
    // so this clock is an upper bound rather than production's figure. The
    // QUERY COUNT is latency-independent and is what the budget conversation
    // should actually be about — round trips are what a transaction spends.
    const queries = await countQueries(organizationId, period, payDay)
    console.log(`[this-week]   ${'queries'.padEnd(12)} ${String(queries.page)}`)

    // ── THE HARNESS'S OWN STATEMENTS ARE ACCOUNTED FOR, EXACTLY ──────────
    //
    // Four: the `select 1` that warms the connection, `set_config`, BEGIN and
    // COMMIT. None of them is the page's cost.
    //
    // ASSERTED BECAUSE THE WARM-UP IS EASY TO ADD AND EASY TO FORGET TO
    // SUBTRACT. Getting that wrong would inflate the screen's measured cost by
    // a round trip for ever, in the one number the brief says the budget
    // conversation should be about — and it would look like a real regression.
    expect(
      queries.raw - queries.page,
      'the warm-up, set_config, BEGIN and COMMIT — and nothing else',
    ).toBe(4)
    // NOT ASSERTED: that the warm-up statement is there at all. Its effect —
    // no cold start inside the transaction — shows up only against a compute
    // that is actually cold, which cannot be arranged on demand; remove it and
    // this test still passes on a warm one. The break harness said so. What IS
    // guarded is the arithmetic above, which is where getting it wrong would
    // quietly inflate the screen's measured cost.

    const sections = Object.values(week.timings).reduce((a, b) => a + b, 0)
    console.log(`[this-week]   ${'sections'.padEnd(12)} ${String(sections)}ms`)
    console.log(`[this-week]   ${'TOTAL'.padEnd(12)} ${String(total)}ms`)
    console.log(
      `[this-week]   ${'(cold open)'.padEnd(12)} ${String(overhead)}ms — connection, BEGIN, SET LOCAL, COMMIT`,
    )
    console.log('')

    expect(week.companies.length).toBe(companies)
    await owner.$disconnect()
  }, 300_000)
})
