import {
  activeSort,
  paginate,
  pageHref,
  readListParams,
  sortHref,
  totalsLabel,
  type ListParams,
  type ListShape,
  type Paged,
  type RawParams,
} from '@/lib/list-view'
import type { Column } from '@/components/ui/Table'

// ---------------------------------------------------------------------------
// THE SIX LINES EVERY GRID PAGE WOULD OTHERWISE REPEAT.
//
// Read the params, filter, sort, paginate, work out the sort descriptor and the
// footer label. Thirteen grids doing that by hand is thirteen chances to
// paginate before filtering — which totals the wrong rows and looks right.
//
// NOT A COMPONENT. A shared server component taking generic columns and rows
// ends up with a props object longer than the page it replaced; this is the
// arithmetic, and each page still renders its own markup.
// ---------------------------------------------------------------------------

export interface GridView<Row> {
  params: ListParams
  /** Every row the filter selected, across pages. The footer's `of N`. */
  filtered: Row[]
  paged: Paged<Row>
  sort: { key: string; dir: 'asc' | 'desc' }
  /** Ready for `Table`'s `sort` prop. */
  sortFor: (pathname: string) => (columnKey: string) => string
  hrefForPage: (pathname: string) => (page: number) => string
}

/**
 * FILTER, THEN SORT, THEN PAGINATE. In that order, and the order is the point:
 * paginating first would sort one page of an arbitrary slice, and the footer
 * would total rows that are not the rows the filter selected.
 */
export function gridView<Row>(
  rows: readonly Row[],
  raw: RawParams,
  shape: ListShape<Row>,
  apply: (
    rows: readonly Row[],
    params: ListParams,
    shape: ListShape<Row>,
  ) => Row[],
): GridView<Row> {
  const params = readListParams(raw)
  const filtered = apply(rows, params, shape)
  const sort = activeSort(params, shape)
  return {
    params,
    filtered,
    paged: paginate(filtered, params),
    sort,
    sortFor: (pathname) => (columnKey) =>
      sortHref(pathname, raw, columnKey, sort),
    hrefForPage: (pathname) => (page) => pageHref(pathname, raw, page),
  }
}

/**
 * The footer's leading cell: `Total (251 rows)`.
 *
 * §7.1.2, corrected 2026-09-28 from the artefact — the foot sums every row the
 * filter selected, not the page, so the label names that same scope. A sum with
 * no scope beside it is the number people quote by accident; which page is on
 * screen is a separate fact and the pagination bar says it.
 */
export function pagedFooterLabel(
  total: string,
  rows: string,
  paged: Paged<unknown>,
): string {
  // THE SIZE OF THE FILTERED SET, NOT THE PAGE. The foot sums all of it
  // (§7.1.2, corrected from the artefact), so the label has to name the same
  // scope — `Total (251 rows)`. Which page is on screen is the pagination bar's
  // sentence, `1–20 of 251`, and keeping the two apart is what stops one number
  // being read as the other.
  if (paged.total === 0) return total
  return `${total} (${paged.total} ${rows})`
}

/** Unpaginated grids keep §7.1.2's plain form. */
export { totalsLabel }

/** Only the columns this person kept, in the table's own order (§7.1.4). */
export function keepColumns<Row>(
  columns: readonly Column<Row>[],
  visible: readonly string[],
): Column<Row>[] {
  // THE FIRST COLUMN IS ALWAYS KEPT. It carries the row's anchor, so hiding it
  // leaves a clickable row whose link has no text — announced as "link" and
  // nothing else. `ColumnsChooser` does not offer it, and this is the half that
  // holds when a stored preference from before that rule is read back.
  const first = columns[0]
  return columns.filter(
    (column, index) =>
      index === 0 || visible.includes(column.key) || column.key === first?.key,
  )
}
