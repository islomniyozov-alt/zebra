import { Prisma } from '@/generated/prisma/client'
import type { TxClient } from './tenancy'
import { companyScopeFilter, narrowCompanyScope } from './tenancy'
import { listedAuthoritiesSql } from './companies'
import { actionRowsFrom, permittedActions } from './dashboard'
import {
  complianceFrom,
  complianceSql,
  type ComplianceSqlRow,
} from './compliance'
import {
  dqfSplitFrom,
  needsYouFrom,
  needsYouSql,
  panelFrom,
  panelSql,
  topDriversFrom,
  topDriversSql,
  type NeedsYouRow,
  type PanelRow,
  type TopDriverRow,
} from './dashboard-counts'
import { dqfRosterFrom, dqfRosterSql, type DqfRosterSqlRow } from './dqf'
import {
  dashboardFrom,
  moneyFrom,
  moneySql,
  type MoneyRow,
} from './dashboard-kpis'
import type { DashboardInput, DashboardReads } from './dashboard-page'
import type { DashboardRead } from './request-timing'
import type { AuthorizedSession } from './permissions'

// ---------------------------------------------------------------------------
// THE DASHBOARD IN ONE STATEMENT (§6.1.1 v10.97; owner's ruling 2026-11-13).
//
// The fallback the owner named for the wall: one transaction in sequence put
// the owner at 10 statements and 949 ms, two in parallel at 12 and 692, and
// the before was 31 and 568. So the seven cards are ONE SELECT:
//
//   WITH money AS (…), needs AS (…), compliance AS (…), compliance_row AS (…),
//        panels AS (…), top_drivers AS (…), dqf AS (…), authorities AS (…)
//   SELECT <one column per card, its rows as JSON>
//
// EACH CTE IS THE CARD'S OWN SQL TEXT, built by the one function its own
// reader also sends (`moneySql` beside `moneyRows`, and so on), so there is
// one SQL text per card and this file only names them. EACH PARSER IS THE
// CARD'S OWN, and takes the JSON transport's numbers and timestamp strings as
// readily as the driver's `bigint` and `Date` (`sql-json.ts`).
//
// A CARD THE ROLE MAY NOT SEE HAS NO CTE, and its column is a literal null:
// its query does not run, the §6.1.1 rule for cash applied to every card.
// `compliance_row` exists only when a chip narrows the panel and not the row.
//
// THE SPANS. Every card settles when the one statement does, so each card
// that ran has the statement's wall as its span — time from the start to the
// card's settle, which is what the spans meant before v10.95 — and a card
// that did not run is null.
// ---------------------------------------------------------------------------

type Json<T> = T[] | null

interface OneRow {
  money: Json<MoneyRow>
  needs: NeedsYouRow | null
  compliance: Json<ComplianceSqlRow>
  compliance_row: Json<ComplianceSqlRow>
  panels: PanelRow | null
  top_drivers: Json<TopDriverRow>
  dqf: Json<DqfRosterSqlRow>
  authorities: Json<{
    id: string
    name: string
    timezone: string
    isDefault: boolean
  }>
}

/** A card's rows as one JSON array (empty, never null, when it ran). */
const rowsOf = (name: string) =>
  Prisma.sql`(SELECT COALESCE(json_agg(x), '[]'::json) FROM ${Prisma.raw(name)} x)`
/** A card's single row as one JSON object. */
const rowOf = (name: string) =>
  Prisma.sql`(SELECT row_to_json(x) FROM ${Prisma.raw(name)} x)`
const absent = Prisma.sql`NULL::json`

export async function readDashboardOneRow(
  tx: TxClient,
  ctx: AuthorizedSession,
  input: DashboardInput,
): Promise<DashboardReads> {
  const { may } = input
  const scope = companyScopeFilter(ctx.companyScopes)
  const narrowed = narrowCompanyScope(ctx.companyScopes, input.companyParam)
  const sameScope =
    narrowed.length === ctx.companyScopes.length &&
    narrowed.every((id, index) => id === ctx.companyScopes[index])
  const permitted = permittedActions(ctx)
  const needsCounts = permitted.some((action) => action.key !== 'compliance')
  const rowCompliance = permitted.some((action) => action.key === 'compliance')
  const money = may.money && !input.cardsOnly
  const topDrivers = may.money && may.fleet
  // The row's compliance is read on the SESSION scope, as `actionQueue`
  // reads it; the panel's on the chip. One CTE serves both when they agree.
  const compliancePanel = may.compliance
  const complianceRowSeparate =
    rowCompliance && (!compliancePanel || !sameScope)

  const ctes: Prisma.Sql[] = []
  const cte = (name: string, sql: Prisma.Sql) =>
    ctes.push(Prisma.sql`${Prisma.raw(name)} AS (${sql})`)
  if (money)
    cte(
      'money',
      moneySql({
        from: input.window.from,
        to: input.window.to,
        companyId: input.companyParam,
        grain: input.grain,
      }),
    )
  if (needsCounts)
    cte('needs', needsYouSql(scope.companyId?.in ?? [], input.now))
  if (compliancePanel) cte('compliance', complianceSql(narrowed, input.now))
  if (complianceRowSeparate)
    cte('compliance_row', complianceSql(ctx.companyScopes, input.now))
  if (may.panels)
    cte(
      'panels',
      panelSql(narrowed, input.window, input.now, { cash: may.money }),
    )
  if (topDrivers) cte('top_drivers', topDriversSql(narrowed, input.window))
  if (may.compliance) cte('dqf', dqfRosterSql(narrowed))
  cte('authorities', listedAuthoritiesSql(ctx.companyScopes))

  const started = performance.now()
  const rows = await tx.$queryRaw<OneRow[]>`
    WITH ${Prisma.join(ctes, ',\n')}
    SELECT
      ${money ? rowsOf('money') : absent} AS money,
      ${needsCounts ? rowOf('needs') : absent} AS needs,
      ${compliancePanel ? rowsOf('compliance') : absent} AS compliance,
      ${complianceRowSeparate ? rowsOf('compliance_row') : absent} AS compliance_row,
      ${may.panels ? rowOf('panels') : absent} AS panels,
      ${topDrivers ? rowsOf('top_drivers') : absent} AS top_drivers,
      ${may.compliance ? rowsOf('dqf') : absent} AS dqf,
      (SELECT COALESCE(json_agg(a ORDER BY a."name"), '[]'::json) FROM authorities a) AS authorities
  `
  const ms = Math.round(performance.now() - started)
  const row = rows[0]
  if (!row)
    throw new Error('readDashboardOneRow: no row from a one-row SELECT.')

  const compliance = row.compliance
    ? complianceFrom(row.compliance, input.now)
    : null
  const forRow = row.compliance_row
    ? complianceFrom(row.compliance_row, input.now)
    : compliance
  const spans: Record<DashboardRead, number | null> = {
    money: money ? ms : null,
    queue: ms,
    panels: may.panels ? ms : null,
    topDrivers: topDrivers ? ms : null,
    dqf: may.compliance ? ms : null,
    horizons: compliancePanel ? ms : null,
    companies: ms,
  }

  return {
    money: row.money
      ? dashboardFrom(moneyFrom(row.money), input.window, input.grain)
      : null,
    queue: actionRowsFrom(
      ctx,
      row.needs ? needsYouFrom(row.needs) : null,
      rowCompliance ? (forRow?.queueCount ?? 0) : null,
    ),
    panels: row.panels ? panelFrom(row.panels, { cash: may.money }) : null,
    topDrivers: row.top_drivers ? topDriversFrom(row.top_drivers) : null,
    dqf: row.dqf ? dqfSplitFrom(dqfRosterFrom(row.dqf), input.now) : null,
    horizons: compliance?.horizons ?? null,
    companies: row.authorities ?? [],
    spans,
  }
}
