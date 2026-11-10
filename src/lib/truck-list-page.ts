import { listedAuthorities } from './companies'
import { readGridColumns } from './grid-columns'
import {
  columnKeysFor,
  TRUCK_COLUMN_KEYS,
  TRUCK_COLUMNS_HIDDEN,
} from './list-columns'
import { viewContext } from './load-views'
import { companyScopeFilter, type TxClient } from './tenancy'
import { listWhere, truckListWhere, type TruckListParams } from './truck-list'
import { truckListCounts, type TruckChipCounts } from './truck-list-counts'
import { trucksCsv, trucksCsvFilename } from './truck-list-csv'
import { readTruckRows, type TruckListRow } from './truck-list-rows'

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
}

export async function readTruckListData(
  tx: TxClient,
  companyScopes: readonly string[],
  params: TruckListParams,
  options: { now: Date; take: number },
): Promise<TruckListData> {
  const scope = companyScopeFilter(companyScopes)
  const authorities = await listedAuthorities(tx, companyScopes)
  const where = truckListWhere(params, scope)

  const rows = await readTruckRows(tx, listWhere(where), {
    now: options.now,
    take: options.take,
    attention: params.attention,
  })

  // EVERY NUMBER ON THE BAR AND IN THE FOOTER: ONE STATEMENT.
  const counts = await truckListCounts(tx, params, companyScopes)

  // THE MAKES ARE THE FLEET'S OWN SPELLINGS, over what the viewer may see
  // (scope and the authority filter), live trucks only. One statement; the
  // make filter itself is not applied, or choosing one would empty the list.
  const makes = (
    await tx.truck.findMany({
      where: {
        AND: [
          scope,
          params.company ? { companyId: params.company } : {},
          { deletedAt: null, make: { not: null } },
        ],
      },
      distinct: ['make'],
      select: { make: true },
      orderBy: { make: 'asc' },
    })
  ).flatMap((truck) => (truck.make ? [truck.make] : []))

  return { rows, counts, authorities, makes }
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
    'trucks.trucks',
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
