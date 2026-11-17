import { Prisma } from '@/generated/prisma/client'
import type { TenantReader } from './tenancy'
import {
  driverListFrom,
  driverListSql,
  driverTabCountsFrom,
  driverTabCountsSql,
  type DriverListBase,
  type DriverListRow,
  type DriverListSqlRow,
  type DriverTab,
} from './driver-list'
import {
  driverHealthFilterSql,
  driverHealthFrom,
  driverHealthSql,
  type DriverHealthCheck,
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
import {
  crewOfTrucksFrom,
  crewOfTrucksSql,
  type CrewMember,
  type CrewSqlRow,
} from './team'

// ---------------------------------------------------------------------------
// /drivers IN THREE STATEMENTS (§6.4 part 1 v11.02, v11.04; the slow-pages
// chain on GAPS 42).
//
// Before v11.02: 21 statements a request, each its own round trip — about
// 200 ms on dev whatever it asked, so the count was the wall (4.6 s). v11.02
// made it one transaction of three reads; v11.04 drops the transaction, whose
// `set_config` and COMMIT were two more trips, and sends two calls through a
// `TenantReader` (`zebra_tenant_read`, §6.2.9 v11.03):
//
//   head    ONE SELECT: the authority count, the five tab counts, the five
//           data-health counts, the three preference rows, AND THE LIST
//           (`driverListSql`, at most the page's cap) — a CTE each
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
  /** The list: the open tab, the health filter if any, and the row cap. */
  list: { tab: DriverTab; missing: DriverHealthCheck | null; cap: number }
}

export interface DriversHead {
  companyCount: number
  counts: Record<DriverTab, number>
  health: DriverHealthCounts
  columnsRow: StoredColumnRow | null
  savedViews: SavedView[]
  density: Density
  drivers: DriverListRow[]
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
  list: DriverListSqlRow[]
}

export async function readDriversHead(
  reader: TenantReader,
  input: DriversHeadInput,
): Promise<DriversHead> {
  const keys = [
    keyFor(GRID),
    PREFERENCE_KEYS.driversViews,
    PREFERENCE_KEYS.density,
  ]
  const rows = await reader.read<HeadRow>(Prisma.sql`
    WITH companies AS (SELECT COUNT(*)::int AS n FROM "Company"),
         tabs AS (${driverTabCountsSql(input.base, input.now, input.includeRemoved)}),
         health AS (${driverHealthSql({ companyIds: input.healthCompanyIds }, input.now)}),
         prefs AS (
           SELECT p."key", p."value", p."organizationId"
             FROM "UserPreference" p
            WHERE p."userId" = ${input.userId} AND p."key" IN (${Prisma.join(keys)})
         ),
         list AS (${driverListSql({
           base: input.base,
           tab: input.list.tab,
           now: input.now,
           includeRemoved: input.includeRemoved,
           filter: input.list.missing
             ? driverHealthFilterSql(input.list.missing, input.now)
             : null,
           cap: input.list.cap,
         })})
    SELECT (SELECT n FROM companies) AS companies,
           (SELECT row_to_json(x) FROM tabs x) AS tabs,
           (SELECT row_to_json(x) FROM health x) AS health,
           (SELECT COALESCE(json_agg(x), '[]'::json) FROM prefs x) AS prefs,
           (SELECT COALESCE(json_agg(x ORDER BY x.ord), '[]'::json) FROM list x) AS list
  `)
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
    drivers: driverListFrom(row.list),
  }
}

export interface DriverListFacts {
  facts: Map<string, DriverFacts>
  dispatch: Map<string, DispatchFacts>
  lastActivity: Map<string, Date | null>
  trucks: Map<string, TruckFacts>
  /**
   * §6.4 part 3 v11.22 — the listed trucks' crews, for the Team column. The
   * same seats `crewOfTrucks` returns (`crewOfTrucksSql`, held to it by
   * `tests/integration/truck-list.test.ts`); `teamMatesFor` folds them.
   */
  crews: Map<string, CrewMember[]>
}

interface FactsRow {
  negative: NegativeNetSqlRow[]
  dqf_drivers: DqfDriverSqlRow[]
  dqf_documents: DqfDocumentSqlRow[]
  roster: DriverRosterSqlRow[]
  dispatch: DispatchFactsSqlRow[]
  activity: LastActivitySqlRow[]
  trucks: TruckComplianceSqlRow[]
  crews: CrewSqlRow[]
}

/**
 * The aggregate's order, where one matters. The crews keep `crewOfTrucks`'
 * seat order — oldest pairing first, then id — as its caller on `/trucks`
 * does; the rest are maps keyed by id.
 */
const FACT_ORDER: Partial<Record<(typeof FACT_CTES)[number], Prisma.Sql>> = {
  crews: Prisma.sql` ORDER BY x."updatedAt", x.id`,
}

const FACT_CTES = [
  'negative',
  'dqf_drivers',
  'dqf_documents',
  'roster',
  'dispatch',
  'activity',
  'trucks',
  'crews',
] as const

/**
 * The listed drivers' facts and their trucks' compliance, in ONE statement —
 * what `driverWarningFacts`, `dispatchFactsForDrivers`,
 * `lastActivityForDrivers`, `truckWarningFacts` and `crewOfTrucks` return. An
 * empty list sends nothing.
 */
export async function readDriverFacts(
  reader: TenantReader,
  driverIds: readonly string[],
  truckIds: readonly string[],
): Promise<DriverListFacts> {
  if (driverIds.length === 0 && truckIds.length === 0) {
    return {
      facts: new Map(),
      dispatch: new Map(),
      lastActivity: new Map(),
      trucks: new Map(),
      crews: new Map(),
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
    crews: crewOfTrucksSql(
      Prisma.sql`d."assignedTruckId" = ANY(${[...truckIds]}::text[])`,
    ),
  }
  const rows = await reader.read<FactsRow>(Prisma.sql`
    WITH ${Prisma.join(
      FACT_CTES.map(
        (name) => Prisma.sql`${Prisma.raw(name)} AS (${texts[name]})`,
      ),
      ',\n',
    )}
    SELECT ${Prisma.join(
      FACT_CTES.map(
        (name) =>
          Prisma.sql`(SELECT COALESCE(json_agg(x${FACT_ORDER[name] ?? Prisma.empty}), '[]'::json) FROM ${Prisma.raw(name)} x) AS ${Prisma.raw(name)}`,
      ),
      ',\n',
    )}
  `)
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
    crews: crewOfTrucksFrom(truckIds, row.crews),
  }
}
