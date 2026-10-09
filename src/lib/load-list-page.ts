import { listedAuthorities } from './companies'
import { readGridColumns } from './grid-columns'
import {
  columnKeysFor,
  LOAD_COLUMN_KEYS,
  LOAD_COLUMNS_HIDDEN,
} from './list-columns'
import { loadFilterLabels } from './load-filter-options'
import { listWhere, loadListWhere, type LoadListParams } from './load-list'
import { loadListCounts, type ChipCounts } from './load-list-counts'
import { loadsCsv, loadsCsvFilename } from './load-list-csv'
import { readLoadRows, type LoadListRow } from './load-list-rows'
import { isLoadViewName, viewContext, type ViewContext } from './load-views'
import { companyScopeFilter, type TxClient } from './tenancy'

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
}

export async function readLoadListData(
  tx: TxClient,
  companyScopes: readonly string[],
  params: LoadListParams,
  options: { page: number; pageSize: number; now: Date; locale: string },
): Promise<LoadListData> {
  // The authorities this viewer may narrow to, which also decide "today".
  const authorities = await listedAuthorities(tx, companyScopes)
  const ctx = viewContext(authorities, options.now)
  const where = loadListWhere(params, companyScopeFilter(companyScopes), ctx)

  const rows = await readLoadRows(tx, listWhere(where), {
    skip: (options.page - 1) * options.pageSize,
    take: options.pageSize,
    now: options.now,
    locale: options.locale,
  })

  // EVERY NUMBER ON THE BAR AND THE FOOTER'S TOTAL: ONE STATEMENT.
  const counts = await loadListCounts(tx, params, companyScopes, ctx)

  // Only what is set is read: nothing at all when neither filter is on.
  const filterLabels =
    params.customer || params.driver
      ? await loadFilterLabels(tx, {
          customer: params.customer,
          driver: params.driver,
        })
      : { customer: null, driver: null }

  return { rows, counts, authorities, ctx, filterLabels }
}

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
    'loads.loads',
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
