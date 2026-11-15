import { Prisma } from '@/generated/prisma/client'
import { listedAuthorities, listedAuthoritiesSql } from './companies'
import { keyFor, readGridColumns, type StoredColumnRow } from './grid-columns'
import {
  truckHealthFrom,
  truckHealthSql,
  type TruckHealthCounts,
  type TruckHealthSqlRow,
} from './data-health'
import {
  headingToForTrucksFrom,
  headingToSql,
  type HeadingToSqlRow,
} from './dispatch-fields'
import {
  fleetStatusChangedFrom,
  fleetStatusChangedSql,
  type FleetStatusChangedSqlRow,
} from './fleet-codes'
import { crewOfTrucksFrom, crewOfTrucksSql, type CrewSqlRow } from './team'
import {
  truckComplianceWhereSql,
  truckFactsFrom,
  type TruckComplianceSqlRow,
} from './warnings'
import {
  columnKeysFor,
  TRUCK_COLUMN_KEYS,
  TRUCK_COLUMNS_HIDDEN,
} from './list-columns'
import { viewContext } from './load-views'
import { companyScopeFilter, type TenantReader, type TxClient } from './tenancy'
import {
  listWhere,
  openLoadStatesFrom,
  truckListWhere,
  type TruckListParams,
} from './truck-list'
import {
  openLoadStatesSql,
  truckChipCounts,
  truckCountGroupsFrom,
  truckCountGroupsSql,
  truckListRowsWhereSql,
  type TruckChipCounts,
  type TruckCountGroupRow,
} from './truck-list-counts'
import { trucksCsv, trucksCsvFilename } from './truck-list-csv'
import {
  readTruckRows,
  truckRowSourcesFrom,
  truckRowsFrom,
  truckRowsSql,
  type TruckListRow,
  type TruckRowSqlRow,
} from './truck-list-rows'

// ---------------------------------------------------------------------------
// WHAT THE TRUCKS LIST READS, IN ONE PLACE (TMS-DESIGN-SYSTEM.md §6.5 part 1).
//
// The page calls this and renders. Here rather than in the page because the
// agreement tests have to call it: "the export is the list" and "a chip's
// count is the rows it opens" are claims about these reads, and a claim about
// code inside a server component is a claim nobody can test (AGENTS.md:
// domain logic lives in `src/lib`).
// ---------------------------------------------------------------------------

export interface TruckListData {
  rows: TruckListRow[]
  counts: TruckChipCounts
  authorities: Awaited<ReturnType<typeof listedAuthorities>>
  /** The makes in the viewer's live fleet, as stored, for the Filters popover. */
  makes: string[]
  /** The five data-health counts over `healthCompanyIds` (§6.5 part 0). */
  health: TruckHealthCounts
  /** The stored column row; the page decides the visible set from it. */
  columnsRow: StoredColumnRow | null
}

/** The trucks grid's id, for the column memory. */
export const TRUCKS_GRID = 'trucks.trucks' as const

interface PageRow {
  authorities: Awaited<ReturnType<typeof listedAuthorities>>
  listed: TruckRowSqlRow[]
  groups: TruckCountGroupRow[]
  health: TruckHealthSqlRow | null
  makes: string[]
  columns: StoredColumnRow | null
  compliance: TruckComplianceSqlRow[]
  crew: CrewSqlRow[]
  heading: HeadingToSqlRow[]
  changed: FleetStatusChangedSqlRow[]
  load_states: { truckId: string | null; operationalStatus: string }[]
}

/**
 * THE PAGE'S READS IN ONE CALL (§6.5 part 1 v11.11; owner's ruling
 * 2026-11-15, the one-call reads). Measured on dev before: 14 statements, page
 * 360 ms as the owner, 346 as a dispatcher — the authorities, the trucks, five
 * per-list loaders, the counts, the makes, the health counts and the column
 * row, in one transaction. Here they are named CTEs of ONE statement through
 * the tenant reader, and no transaction.
 *
 * The rows' `where` is `truckListRowsWhereSql` (the counts' own fragments);
 * the loaders' texts are their own (`headingToSql`, `fleetStatusChangedSql`,
 * `truckComplianceWhereSql`) put over the listed ids, and the crews and open
 * loads are second spellings (`crewOfTrucksSql`, `openLoadStatesSql`). The
 * rows are shaped by `truckRowsFrom`, the function the export's Prisma rows go
 * through too. `tests/integration/truck-list.test.ts` holds the call equal to
 * the Prisma reads.
 */
export async function readTruckListData(
  reader: TenantReader,
  companyScopes: readonly string[],
  params: TruckListParams,
  options: {
    now: Date
    take: number
    userId: string
    /** The fleet the health counts cover: scope and the authority filter. */
    healthCompanyIds: readonly string[]
  },
): Promise<TruckListData> {
  const ids = (column: string) =>
    Prisma.sql`${Prisma.raw(column)} IN (SELECT id FROM listed)`
  const scopes = [...companyScopes]
  const [row] = await reader.read<PageRow>(Prisma.sql`
    WITH authorities AS (${listedAuthoritiesSql(companyScopes)}),
         listed AS (${truckRowsSql(
           truckListRowsWhereSql(params, companyScopes),
           options.take,
         )}),
         groups AS (${truckCountGroupsSql(params, companyScopes)}),
         health AS (${truckHealthSql({ companyIds: options.healthCompanyIds })}),
         makes AS (
           SELECT DISTINCT t.make FROM "Truck" t
            WHERE (${scopes.length === 0} OR t."companyId" = ANY(${scopes}::text[]))
              AND ${params.company ? Prisma.sql`t."companyId" = ${params.company}` : Prisma.sql`true`}
              AND t."deletedAt" IS NULL AND t.make IS NOT NULL
         ),
         columns AS (
           SELECT p."value", p."organizationId" FROM "UserPreference" p
            WHERE p."userId" = ${options.userId}
              AND p."key" = ${keyFor(TRUCKS_GRID)}
            LIMIT 1
         ),
         compliance AS (${truckComplianceWhereSql(ids('ci."truckId"'))}),
         crew AS (${crewOfTrucksSql(ids('d."assignedTruckId"'))}),
         heading AS (${headingToSql(ids('l."truckId"'))}),
         changed AS (${fleetStatusChangedSql(ids('a."entityId"'))}),
         load_states AS (${openLoadStatesSql(ids('t.id'))})
    SELECT (SELECT COALESCE(json_agg(x ORDER BY x."name"), '[]'::json)
              FROM authorities x) AS authorities,
           (SELECT COALESCE(json_agg(x ORDER BY x.ord), '[]'::json)
              FROM listed x) AS listed,
           (SELECT COALESCE(json_agg(x), '[]'::json) FROM groups x) AS groups,
           (SELECT row_to_json(x) FROM health x) AS health,
           (SELECT COALESCE(json_agg(x.make ORDER BY x.make), '[]'::json)
              FROM makes x) AS makes,
           (SELECT row_to_json(x) FROM columns x) AS columns,
           (SELECT COALESCE(json_agg(x), '[]'::json) FROM compliance x) AS compliance,
           (SELECT COALESCE(json_agg(x ORDER BY x."updatedAt", x.id), '[]'::json)
              FROM crew x) AS crew,
           (SELECT COALESCE(json_agg(x), '[]'::json) FROM heading x) AS heading,
           (SELECT COALESCE(json_agg(x), '[]'::json) FROM changed x) AS changed,
           (SELECT COALESCE(json_agg(x), '[]'::json) FROM load_states x) AS load_states`)
  if (!row) throw new Error('readTruckListData: no row from a one-row SELECT.')

  const trucks = truckRowSourcesFrom(row.listed)
  const truckIds = trucks.map((truck) => truck.id)
  return {
    rows: truckRowsFrom(
      trucks,
      {
        facts: truckFactsFrom(truckIds, row.compliance),
        crews: crewOfTrucksFrom(truckIds, row.crew),
        headingTo: headingToForTrucksFrom(truckIds, row.heading),
        statusChanged: fleetStatusChangedFrom(truckIds, row.changed),
        loadStates: openLoadStatesFrom(truckIds, row.load_states),
      },
      { now: options.now, attention: params.attention },
    ),
    counts: truckChipCounts(truckCountGroupsFrom(row.groups), params.view),
    authorities: row.authorities,
    makes: row.makes,
    health: truckHealthFrom(row.health),
    columnsRow: row.columns
      ? { value: row.columns.value, organizationId: row.columns.organizationId }
      : null,
  }
}

/**
 * The current view as CSV (§6.5 part 1, §7.1.5): the list's own `where`,
 * every row it selects, in this person's visible columns. `/trucks/export`
 * calls this and nothing else, and the agreement test calls it too.
 */
export async function readTruckListExport(
  tx: TxClient,
  viewer: { userId: string; companyScopes: readonly string[] },
  params: TruckListParams,
  now: Date,
): Promise<{ body: string; filename: string; rowCount: number }> {
  const authorities = await listedAuthorities(tx, viewer.companyScopes)
  const where = truckListWhere(params, companyScopeFilter(viewer.companyScopes))
  // The SAME visible set the page renders, read the same way.
  const visible = await readGridColumns(
    tx,
    viewer.userId,
    TRUCKS_GRID,
    columnKeysFor(TRUCK_COLUMN_KEYS, authorities.length > 1),
    TRUCK_COLUMNS_HIDDEN,
  )
  const rows = await readTruckRows(tx, listWhere(where), {
    now,
    attention: params.attention,
  })
  return {
    body: trucksCsv(rows, visible),
    // "Today" is the default authority's date, as the loads export names it.
    filename: trucksCsvFilename(
      params.view,
      viewContext(authorities, now).today,
    ),
    rowCount: rows.length,
  }
}
