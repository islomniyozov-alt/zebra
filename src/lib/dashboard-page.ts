import type { TxClient } from './tenancy'
import { companyScopeFilter, narrowCompanyScope } from './tenancy'
import { listedAuthorities } from './companies'
import { actionQueue, type ActionRow } from './dashboard'
import { complianceOnce, type ComplianceHorizons } from './compliance'
import {
  dqfSplit,
  panelFigures,
  topDriversByGross,
  type DqfSplit,
} from './dashboard-counts'
import { dashboardFor, type Dashboard } from './dashboard-kpis'
import type { Grain, PeriodWindow } from './rolling-period'
import type { DashboardRead } from './request-timing'
import type { AuthorizedSession } from './permissions'

// ---------------------------------------------------------------------------
// THE DASHBOARD'S ONE READ (§6.1.1 v10.95; owner's instruction 2026-11-13).
//
// The page opened SEVEN transactions — one per card, in parallel — so before
// a single row was read it had paid `set_config` and `COMMIT` seven times:
// fourteen of the owner's 35 statements, measured on dev through
// `page.timing`. The compliance queue was read twice more (the Needs-you
// row and the 30/60/90 panel are the same rows at two horizons) and the
// money card scanned its window three times for three groupings.
//
// So the cards run inside ONE transaction, in sequence — a transaction holds
// one connection, and Prisma serialises its queries on it — and each card is
// ONE statement with ONE predicate: `moneyRows`, `needsYouCounts`,
// `complianceOnce` (read once, both cards), `panelFigures`,
// `topDriversByGross`, `dqfRoster`, `listedAuthorities`. The budget is in
// `tests/integration/dashboard.test.ts`: nine statements for the owner
// including `set_config` and `COMMIT`, named.
//
// THE SPANS KEEP THEIR SEVEN NAMES. `dashboard.timing` reported each card's
// time from the fan-out's start to its own settle; it now reports each card's
// own duration in the sequence, under the same keys, so the sweep's reader
// reads the line as before and the sum of the spans is the transaction's
// wall. A card the role is not shown is `null`, not 0: it did not run.
// ---------------------------------------------------------------------------

export interface DashboardInput {
  companyParam: string | null
  window: PeriodWindow
  grain: Grain
  now: Date
  may: {
    money: boolean
    panels: boolean
    fleet: boolean
    compliance: boolean
  }
  /**
   * Skip the money card itself and nothing else: `readCards` sets it so the
   * other six run with the role's real permissions — `topDrivers` and the
   * panels' cash still need `may.money` — while money runs beside them.
   */
  cardsOnly?: boolean
}

export interface DashboardReads {
  money: Dashboard | null
  queue: ActionRow[]
  panels: Awaited<ReturnType<typeof panelFigures>> | null
  topDrivers: Awaited<ReturnType<typeof topDriversByGross>> | null
  dqf: DqfSplit | null
  horizons: ComplianceHorizons | null
  companies: Awaited<ReturnType<typeof listedAuthorities>>
  /** Each card's own duration in the sequence, ms; null where it did not run. */
  spans: Record<DashboardRead, number | null>
}

/** The order the cards run in — money first, the one every eye goes to. */
export const DASHBOARD_ORDER: readonly DashboardRead[] = [
  'money',
  'horizons',
  'queue',
  'panels',
  'topDrivers',
  'dqf',
  'companies',
]

export async function readDashboard(
  tx: TxClient,
  ctx: AuthorizedSession,
  input: DashboardInput,
): Promise<DashboardReads> {
  const { may } = input
  const scope = companyScopeFilter(ctx.companyScopes)
  const narrowed = narrowCompanyScope(ctx.companyScopes, input.companyParam)
  const spans: Record<DashboardRead, number | null> = {
    money: null,
    queue: null,
    panels: null,
    topDrivers: null,
    dqf: null,
    horizons: null,
    companies: null,
  }
  const timed = async <T>(name: DashboardRead, read: () => Promise<T>) => {
    const started = performance.now()
    const value = await read()
    spans[name] = Math.round(performance.now() - started)
    return value
  }

  const money =
    may.money && !input.cardsOnly
      ? await timed('money', () =>
          dashboardFor(
            tx,
            ctx.organizationId,
            input.companyParam,
            input.window,
            {
              // THE PRESET DECIDES, not the span (§6.1.1).
              grain: input.grain,
            },
          ),
        )
      : null

  // THE COMPLIANCE TABLE, ONCE, FOR TWO CARDS. The Needs-you row's count at
  // the authorities' lead days and the panel's 30/60/90 are the same rows at
  // two horizons; `complianceOnce` reads them in one statement. Its span is
  // the panel's (`horizons`); the queue's span below is `needsYouCounts`.
  // THE CHIP, NOT JUST THE SESSION SCOPE, for the panel; the row keeps the
  // session scope it always had.
  const compliance = may.compliance
    ? await timed('horizons', () => complianceOnce(tx, narrowed, input.now))
    : null
  // THE ROW KEEPS THE SESSION SCOPE IT ALWAYS HAD. With no chip the two
  // scopes are one and the row's count is the same read; with a chip the
  // panel narrows and the row does not, so the row is one more statement on
  // the session scope — one, not the three it was.
  const sameScope =
    narrowed.length === ctx.companyScopes.length &&
    narrowed.every((id, index) => id === ctx.companyScopes[index])
  const rowCompliance = !may.compliance
    ? undefined
    : compliance && sameScope
      ? compliance.queueCount
      : (await complianceOnce(tx, ctx.companyScopes, input.now)).queueCount

  const queue = await timed('queue', () =>
    actionQueue(
      tx,
      ctx,
      scope,
      rowCompliance === undefined ? {} : { complianceCount: rowCompliance },
    ),
  )

  const panels = may.panels
    ? await timed('panels', () =>
        panelFigures(tx, narrowed, input.window, input.now, {
          cash: may.money,
        }),
      )
    : null

  const topDrivers =
    may.money && may.fleet
      ? await timed('topDrivers', () =>
          topDriversByGross(tx, narrowed, input.window),
        )
      : null

  const dqf = may.compliance
    ? await timed('dqf', () => dqfSplit(tx, narrowed, input.now))
    : null

  const companies = await timed('companies', () =>
    listedAuthorities(tx, ctx.companyScopes),
  )

  return {
    money,
    queue,
    panels,
    topDrivers,
    dqf,
    horizons: compliance?.horizons ?? null,
    companies,
    spans,
  }
}

// ── TWO TRANSACTIONS, MONEY BESIDE THE SIX (§6.1.1 v10.96) ────────────────
//
// Owner's ruling 2026-11-13 on the after-measurement: one transaction in
// sequence read owner 31 → 10 statements and 568 → 949 ms on the median —
// each card cheaper, their SUM where their MAX had been. So the page runs
// `readMoney` and `readCards` in parallel, each in its own `withCurrentOrg`:
// two statements more than `readDashboard` (owner at twelve, on the line),
// and the wall is the longer of the two rather than the sum of seven.
// `readDashboard` above stays as the one-transaction read the budget test
// names statement by statement; these two are the same cards split.

/** The money card alone: one statement, its own transaction. */
export async function readMoney(
  tx: TxClient,
  ctx: AuthorizedSession,
  input: DashboardInput,
): Promise<{ money: Dashboard | null; ms: number | null }> {
  if (!input.may.money) return { money: null, ms: null }
  const started = performance.now()
  const money = await dashboardFor(
    tx,
    ctx.organizationId,
    input.companyParam,
    input.window,
    { grain: input.grain },
  )
  return { money, ms: Math.round(performance.now() - started) }
}

/** The other six cards, in sequence, in their own transaction. */
export async function readCards(
  tx: TxClient,
  ctx: AuthorizedSession,
  input: DashboardInput,
): Promise<Omit<DashboardReads, 'money'>> {
  // `readDashboard` with the money card itself skipped — the six run exactly
  // as they run there, with the role's real permissions, because
  // `topDrivers` and the panels' cash still need `may.money`.
  const { money: _money, ...cards } = await readDashboard(tx, ctx, {
    ...input,
    cardsOnly: true,
  })
  void _money
  return cards
}
