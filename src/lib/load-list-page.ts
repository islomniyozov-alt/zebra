import { Prisma } from '@/generated/prisma/client'
import { listedAuthorities, listedAuthoritiesSql } from './companies'
import { keyFor, readGridColumns, type StoredColumnRow } from './grid-columns'
import {
  columnKeysFor,
  LOAD_COLUMN_KEYS,
  LOAD_COLUMNS_HIDDEN,
} from './list-columns'
import { driverLabel } from './load-filter-options'
import { listWhere, loadListWhere, type LoadListParams } from './load-list'
import {
  chipCounts,
  countGroupsFrom,
  loadCountGroupsSql,
  loadListRowsWhereSql,
  type ChipCounts,
  type CountGroupRow,
} from './load-list-counts'
import { loadsCsv, loadsCsvFilename } from './load-list-csv'
import {
  loadRowSourcesFrom,
  loadRowsFrom,
  loadRowsSql,
  readLoadRows,
  type LoadListRow,
  type LoadRowSqlRow,
} from './load-list-rows'
import { isLoadViewName, viewContext, type ViewContext } from './load-views'
import { companyScopeFilter, type TenantReader, type TxClient } from './tenancy'
import {
  loadWarningFactsFrom,
  loadWarningFactsSql,
  type LoadWarningFactRow,
} from './warnings'
import {
  parseDensity,
  parseSavedViews,
  PREFERENCE_KEYS,
  type Density,
  type SavedView,
} from './preferences'

// ---------------------------------------------------------------------------
// WHAT THE LOADS LIST READS, IN ONE PLACE (TMS-DESIGN-SYSTEM.md §6.7).
//
// The page calls this and renders. It is here rather than in the page because
// the budget guard has to run it: "a render issues at most one counting
// statement" is a claim about these reads, and a claim about code inside a
// server component is a claim nobody can test (AGENTS.md: domain logic lives
// in `src/lib`).
// ---------------------------------------------------------------------------

export interface LoadListData {
  rows: LoadListRow[]
  counts: ChipCounts
  authorities: Awaited<ReturnType<typeof listedAuthorities>>
  ctx: ViewContext
  filterLabels: { customer: string | null; driver: string | null }
  savedViews: SavedView[]
  density: Density
  /** The stored column row; the page decides the visible set from it. */
  columnsRow: StoredColumnRow | null
}

interface HeadRow {
  authorities: Awaited<ReturnType<typeof listedAuthorities>>
  prefs: { key: string; value: Prisma.JsonValue; organizationId: string }[]
  customer: string | null
  driver: { firstName: string; lastName: string } | null
}

interface BodyRow {
  rows: LoadRowSqlRow[]
  groups: CountGroupRow[]
  facts: LoadWarningFactRow[]
}

/**
 * THE PAGE'S READS IN TWO CALLS (§6.7 v11.10; owner's ruling 2026-11-15, the
 * one-call reads). Measured on dev before: 10 statements, page 513 ms as the
 * owner, 584 as a dispatcher — the authorities, the rows, the warnings, the
 * counts, the labels and three preferences, each its own read in one
 * transaction.
 *
 * TWO, NOT ONE, because "today" is the default authority's local date and
 * every date view and the Upcoming chip are bounded by it: the head reads the
 * authorities (with the preferences and the filter labels, which need
 * nothing), and the body — the rows, their warnings and every chip — is built
 * from the day the head names. Both go through the tenant reader, outside any
 * transaction.
 *
 * The rows are `loadRowsSql` under `loadListRowsWhereSql` (the counts' own
 * fragments), shaped by `loadRowsFrom`, the function the export's rows go
 * through too; `tests/integration/load-list.test.ts` holds them equal to
 * `readLoadRows(listWhere(…))` filter by filter and view by view.
 */
export async function readLoadListData(
  reader: TenantReader,
  companyScopes: readonly string[],
  params: LoadListParams,
  options: {
    page: number
    pageSize: number
    now: Date
    locale: string
    userId: string
  },
): Promise<LoadListData> {
  const keys = [
    PREFERENCE_KEYS.loadsViews,
    PREFERENCE_KEYS.density,
    keyFor(LOADS_GRID),
  ]
  const [head] = await reader.read<HeadRow>(Prisma.sql`
    WITH authorities AS (${listedAuthoritiesSql(companyScopes)}),
         prefs AS (
           SELECT p."key", p."value", p."organizationId"
             FROM "UserPreference" p
            WHERE p."userId" = ${options.userId}
              AND p."key" IN (${Prisma.join(keys)})
         )
    SELECT (SELECT COALESCE(json_agg(x ORDER BY x."name"), '[]'::json)
              FROM authorities x) AS authorities,
           (SELECT COALESCE(json_agg(x), '[]'::json) FROM prefs x) AS prefs,
           ${
             params.customer
               ? Prisma.sql`(SELECT cu."name" FROM "Customer" cu WHERE cu."id" = ${params.customer})`
               : Prisma.sql`NULL::text`
           } AS customer,
           ${
             params.driver
               ? Prisma.sql`(SELECT json_build_object('firstName', d."firstName", 'lastName', d."lastName") FROM "Driver" d WHERE d."id" = ${params.driver})`
               : Prisma.sql`NULL::json`
           } AS driver`)
  if (!head) throw new Error('readLoadListData: no row from a one-row SELECT.')

  const authorities = head.authorities
  const ctx = viewContext(authorities, options.now)
  const [body] = await reader.read<BodyRow>(Prisma.sql`
    WITH listed AS (${loadRowsSql(
      loadListRowsWhereSql(params, companyScopes, ctx),
      {
        skip: (options.page - 1) * options.pageSize,
        take: options.pageSize,
      },
    )}),
         groups AS (${loadCountGroupsSql(params, companyScopes, ctx)}),
         facts AS (${loadWarningFactsSql(
           Prisma.sql`l."id" IN (SELECT id FROM listed)`,
         )})
    SELECT (SELECT COALESCE(json_agg(x ORDER BY x."bookedAt" DESC, x.id), '[]'::json)
              FROM listed x) AS rows,
           (SELECT COALESCE(json_agg(x), '[]'::json) FROM groups x) AS groups,
           (SELECT COALESCE(json_agg(x), '[]'::json) FROM facts x) AS facts`)
  if (!body) throw new Error('readLoadListData: no row from a one-row SELECT.')

  const pref = (key: string) =>
    head.prefs.find((row) => row.key === key) ?? null
  const columns = pref(keyFor(LOADS_GRID))
  return {
    rows: loadRowsFrom(
      loadRowSourcesFrom(body.rows),
      loadWarningFactsFrom(body.facts),
      options,
    ),
    counts: chipCounts(countGroupsFrom(body.groups), params),
    authorities,
    ctx,
    filterLabels: {
      customer: head.customer,
      driver: head.driver ? driverLabel(head.driver) : null,
    },
    savedViews: parseSavedViews(
      pref(PREFERENCE_KEYS.loadsViews)?.value ?? null,
    ),
    density: parseDensity(pref(PREFERENCE_KEYS.density)?.value ?? null),
    columnsRow: columns
      ? { value: columns.value, organizationId: columns.organizationId }
      : null,
  }
}

/** The loads grid's id, for the column memory. */
export const LOADS_GRID = 'loads.loads' as const

/**
 * The current view as CSV (§6.7 item 7): the list's own `where`, every row it
 * selects, in this person's visible columns. `/loads/export` calls this and
 * nothing else, and the agreement test calls it too.
 */
export async function readLoadListExport(
  tx: TxClient,
  viewer: { userId: string; companyScopes: readonly string[] },
  params: LoadListParams,
  now: Date,
): Promise<{ body: string; filename: string; rowCount: number }> {
  const authorities = await listedAuthorities(tx, viewer.companyScopes)
  const ctx = viewContext(authorities, now)
  const where = loadListWhere(
    params,
    companyScopeFilter(viewer.companyScopes),
    ctx,
  )
  // The SAME visible set the page renders, read the same way.
  const visible = await readGridColumns(
    tx,
    viewer.userId,
    LOADS_GRID,
    columnKeysFor(LOAD_COLUMN_KEYS, authorities.length > 1),
    LOAD_COLUMNS_HIDDEN,
  )
  const rows = await readLoadRows(tx, listWhere(where), {
    now,
    locale: 'en-US',
  })
  return {
    body: loadsCsv(rows, visible),
    filename: loadsCsvFilename(
      params.view,
      params.view !== undefined && isLoadViewName(params.view),
      ctx.today,
    ),
    rowCount: rows.length,
  }
}
