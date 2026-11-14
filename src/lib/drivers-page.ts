import { Prisma } from '@/generated/prisma/client'
import type { TxClient } from './tenancy'
import {
  driverTabCountsFrom,
  driverTabCountsSql,
  type DriverListBase,
  type DriverTab,
} from './driver-list'
import {
  driverHealthFrom,
  driverHealthSql,
  type DriverHealthCounts,
} from './data-health'
import { keyFor, type StoredColumnRow } from './grid-columns'
import {
  parseDensity,
  parseSavedViews,
  PREFERENCE_KEYS,
  type Density,
  type SavedView,
} from './preferences'
import {
  dqfDocumentsSql,
  dqfDriversSql,
  dqfFactsFrom,
  type DqfDocumentSqlRow,
  type DqfDriverSqlRow,
} from './dqf'
import {
  driverFactsFrom,
  driverRosterSql,
  negativeNetSql,
  truckComplianceSql,
  truckFactsFrom,
  type DriverFacts,
  type DriverRosterSqlRow,
  type NegativeNetSqlRow,
  type TruckComplianceSqlRow,
  type TruckFacts,
} from './warnings'
import {
  dispatchFactsFrom,
  dispatchFactsSql,
  lastActivityFrom,
  lastActivitySql,
  type DispatchFacts,
  type DispatchFactsSqlRow,
  type LastActivitySqlRow,
} from './dispatch-fields'
import { asNumber } from './sql-json'

// ---------------------------------------------------------------------------
// /drivers IN SIX STATEMENTS (§6.4 part 1 v11.02; owner's instruction
// 2026-11-14, the slow-pages chain on GAPS 42).
//
// Before: 21 statements a request, each its own round trip — about 200 ms on
// dev whatever it asked, so the count was the wall (4.6 s). The page's one
// transaction now makes three reads:
//
//   head    ONE SELECT: the authority count, the five tab counts, the five
//           data-health counts, the three preference rows — a CTE each
//   list    the page's own `driver.findMany`, unchanged
//   facts   ONE SELECT keyed on the listed ids: negative settlements, the
//           DQF evidence, the roster columns, dispatch facts, last activity,
//           the listed trucks' compliance — a CTE each
//
// EVERY CTE IS THE SQL TEXT ITS OWN READER SENDS (`driverTabCountsSql`
// beside `countDriverTabs`, `driverHealthSql` beside `countDriverHealth`, the
// loaders' texts beside the loaders), parsed by the readers' own parsers
// through `sql-json`, so `/drivers/[id]`, `/safety/dqf` and `/trucks` keep
// the same SQL and `tests/integration/drivers-page.test.ts` holds the two
// transports equal.
//
// THE COLUMN PREFERENCE COMES BACK AS ITS ROW: the visible set and the
// one-time legacy rewrite stay in `readGridColumns`, which the page calls
// with this row.
// ---------------------------------------------------------------------------

const GRID = 'drivers.drivers' as const

export interface DriversHeadInput {
  userId: string
  base: DriverListBase
  /** The health counts' own scope: the authority chip, or the session's. */
  healthCompanyIds: readonly string[]
  now: Date
  includeRemoved: boolean
}

export interface DriversHead {
  companyCount: number
  counts: Record<DriverTab, number>
  health: DriverHealthCounts
  columnsRow: StoredColumnRow | null
  savedViews: SavedView[]
  density: Density
}

interface PreferenceRow {
  key: string
  value: Prisma.JsonValue
  organizationId: string
}

interface HeadRow {
  companies: unknown
  tabs: Partial<Record<DriverTab, unknown>> | null
  health: Partial<Record<keyof DriverHealthCounts, unknown>> | null
  prefs: PreferenceRow[]
}

export async function readDriversHead(
  tx: TxClient,
  input: DriversHeadInput,
): Promise<DriversHead> {
  const keys = [
    keyFor(GRID),
    PREFERENCE_KEYS.driversViews,
    PREFERENCE_KEYS.density,
  ]
  const rows = await tx.$queryRaw<HeadRow[]>`
    WITH companies AS (SELECT COUNT(*)::int AS n FROM "Company"),
         tabs AS (${driverTabCountsSql(input.base, input.now, input.includeRemoved)}),
         health AS (${driverHealthSql({ companyIds: input.healthCompanyIds }, input.now)}),
         prefs AS (
           SELECT p."key", p."value", p."organizationId"
             FROM "UserPreference" p
            WHERE p."userId" = ${input.userId} AND p."key" IN (${Prisma.join(keys)})
         )
    SELECT (SELECT n FROM companies) AS companies,
           (SELECT row_to_json(x) FROM tabs x) AS tabs,
           (SELECT row_to_json(x) FROM health x) AS health,
           (SELECT COALESCE(json_agg(x), '[]'::json) FROM prefs x) AS prefs
  `
  const row = rows[0]
  if (!row) throw new Error('readDriversHead: no row from a one-row SELECT.')

  const pref = (key: string) => row.prefs.find((p) => p.key === key) ?? null
  const columns = pref(keyFor(GRID))
  return {
    companyCount: asNumber(row.companies),
    counts: driverTabCountsFrom(row.tabs),
    health: driverHealthFrom(row.health),
    columnsRow: columns
      ? { value: columns.value, organizationId: columns.organizationId }
      : null,
    savedViews: parseSavedViews(
      pref(PREFERENCE_KEYS.driversViews)?.value ?? null,
    ),
    density: parseDensity(pref(PREFERENCE_KEYS.density)?.value ?? null),
  }
}

export interface DriverListFacts {
  facts: Map<string, DriverFacts>
  dispatch: Map<string, DispatchFacts>
  lastActivity: Map<string, Date | null>
  trucks: Map<string, TruckFacts>
}

interface FactsRow {
  negative: NegativeNetSqlRow[]
  dqf_drivers: DqfDriverSqlRow[]
  dqf_documents: DqfDocumentSqlRow[]
  roster: DriverRosterSqlRow[]
  dispatch: DispatchFactsSqlRow[]
  activity: LastActivitySqlRow[]
  trucks: TruckComplianceSqlRow[]
}

const FACT_CTES = [
  'negative',
  'dqf_drivers',
  'dqf_documents',
  'roster',
  'dispatch',
  'activity',
  'trucks',
] as const

/**
 * The listed drivers' facts and their trucks' compliance, in ONE statement —
 * what `driverWarningFacts`, `dispatchFactsForDrivers`,
 * `lastActivityForDrivers` and `truckWarningFacts` return. An empty list
 * sends nothing.
 */
export async function readDriverFacts(
  tx: TxClient,
  driverIds: readonly string[],
  truckIds: readonly string[],
): Promise<DriverListFacts> {
  if (driverIds.length === 0 && truckIds.length === 0) {
    return {
      facts: new Map(),
      dispatch: new Map(),
      lastActivity: new Map(),
      trucks: new Map(),
    }
  }
  const texts: Record<(typeof FACT_CTES)[number], Prisma.Sql> = {
    negative: negativeNetSql(driverIds),
    dqf_drivers: dqfDriversSql(driverIds),
    dqf_documents: dqfDocumentsSql(driverIds),
    roster: driverRosterSql(driverIds),
    dispatch: dispatchFactsSql(driverIds),
    activity: lastActivitySql(driverIds),
    trucks: truckComplianceSql(truckIds),
  }
  const rows = await tx.$queryRaw<FactsRow[]>`
    WITH ${Prisma.join(
      FACT_CTES.map(
        (name) => Prisma.sql`${Prisma.raw(name)} AS (${texts[name]})`,
      ),
      ',\n',
    )}
    SELECT ${Prisma.join(
      FACT_CTES.map(
        (name) =>
          Prisma.sql`(SELECT COALESCE(json_agg(x), '[]'::json) FROM ${Prisma.raw(name)} x) AS ${Prisma.raw(name)}`,
      ),
      ',\n',
    )}
  `
  const row = rows[0]
  if (!row) throw new Error('readDriverFacts: no row from a one-row SELECT.')

  return {
    facts: driverFactsFrom(
      driverIds,
      row.negative,
      dqfFactsFrom(row.dqf_drivers, row.dqf_documents),
      row.roster,
    ),
    dispatch: dispatchFactsFrom(row.dispatch),
    lastActivity: lastActivityFrom(driverIds, row.activity),
    trucks: truckFactsFrom(truckIds, row.trucks),
  }
}
