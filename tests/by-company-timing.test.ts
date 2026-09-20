import { describe, expect, it } from 'vitest'
import { retryingClient } from './retrying-client'
import { withOrg } from '@/lib/tenancy'
import { unattributed } from '@/lib/audit'
import {
  driverPayByCompany,
  grossByCompany,
  firstSettledPeriodStart,
  assembleReport,
} from '@/lib/by-company'

// ---------------------------------------------------------------------------
// WHAT THE BY-COMPANY PAGE COSTS, ON THE REAL PILE.
//
// The ruling: one query per number, grouped in SQL, inside five seconds on
// 14,464 loads, MEASURED. The measurement is the part that makes the other
// two claims worth anything — "grouped in SQL" is a design statement until a
// clock agrees with it.
//
// It runs in the node project against the dev database, like
// `this-week-timing.test.ts`, because the integration project's per-worker
// databases are clones of an empty template: timing a report over no rows
// measures nothing at all.
//
// ── THE COLD START IS PAID OUTSIDE THE BUDGET ────────────────────────────
//
// Neon autosuspends, and a fresh connection's first statement wakes it. That
// wake cost the money screen five gates in one day before it was moved out of
// the transaction, and the branches were found archived for inactivity again
// on 2026-09-20. One trivial statement first, then the clock.
// ---------------------------------------------------------------------------

/** The ruling's budget, for the whole page. */
const BUDGET_MS = 5_000

describe('the cost of the by-company report', () => {
  it('answers both numbers inside the budget, on the busiest organization', async () => {
    const owner = retryingClient(process.env.DIRECT_DATABASE_URL!)

    const busiest = await owner.load.groupBy({
      by: ['organizationId'],
      _count: { _all: true },
      orderBy: { _count: { organizationId: 'desc' } },
      take: 1,
    })
    const organizationId = busiest[0]?.organizationId
    const loads = busiest[0]?._count._all ?? 0
    if (!organizationId) {
      console.log('[by-company] no freight in this database; nothing to time')
      await owner.$disconnect()
      return
    }

    // THE DEFAULT THE PAGE OPENS ON: the last 13 Sunday-to-Saturday weeks.
    const now = new Date()
    const midnight = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    )
    const to = new Date(midnight + 86_400_000)
    const from = new Date(midnight - 13 * 7 * 86_400_000)

    // Warm the compute before anything is timed. See the header.
    await owner.$queryRaw`select 1`
    await owner.$disconnect()

    const started = Date.now()
    const report = await withOrg(
      organizationId,
      async (tx) => {
        const [gross, pay, settledFrom] = await Promise.all([
          grossByCompany(tx, { grouping: 'week', from, to }),
          driverPayByCompany(tx, { grouping: 'week', from, to }),
          firstSettledPeriodStart(tx),
        ])
        return assembleReport({
          gross,
          pay,
          firstSettledPeriodStart: settledFrom,
        })
      },
      {
        attribution: unattributed('by-company timing probe; reads only'),
        timeoutMs: BUDGET_MS * 2,
      },
    )
    const elapsed = Date.now() - started

    console.log('[by-company] cost of the report')
    console.log(`[by-company]   loads in the organization   ${loads}`)
    console.log(
      `[by-company]   periods returned            ${report.periods.length}`,
    )
    console.log(`[by-company]   TOTAL                       ${elapsed}ms`)
    console.log(`[by-company]   budget                      ${BUDGET_MS}ms`)

    expect(
      elapsed,
      `the by-company report took ${elapsed}ms against ${loads} loads`,
    ).toBeLessThan(BUDGET_MS)
  })
})
