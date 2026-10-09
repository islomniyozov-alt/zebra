import { csvMoney, toCsv } from './list-view'
import type { LOAD_COLUMN_KEYS } from './list-columns'
import type { LoadListRow } from './load-list-rows'

// ---------------------------------------------------------------------------
// THE LOADS LIST AS A FILE (TMS-DESIGN-SYSTEM.md §6.7 item 7, §7.1.5).
//
// THE PERSON'S VISIBLE COLUMNS, IN THE TABLE'S ORDER, so the file matches the
// screen it was exported from. CODES, NOT LABELS: a status is `IN_TRANSIT`, not
// "In transit" in whatever language the person reads, because the file is read
// by a machine downstream. Money is `1234.56`; a date is `YYYY-MM-DD`.
//
// THE LOAD CELL HOLDS TWO IDENTIFIERS on screen — the load number, and the
// broker's reference under it — so the file gives each its own column rather
// than a cell a spreadsheet cannot split.
// ---------------------------------------------------------------------------

type LoadColumn = (typeof LOAD_COLUMN_KEYS)[number]

/** Per screen column, its file columns: a header and a value each. */
const FILE_COLUMNS: Record<
  LoadColumn,
  readonly [string, (row: LoadListRow) => string | null][]
> = {
  loadNumber: [
    ['load_number', (row) => row.loadNumber],
    ['reference', (row) => row.reference],
  ],
  company: [['authority', (row) => row.companyName]],
  customer: [['broker', (row) => row.customerName]],
  pickup: [['pickup', (row) => row.pickup]],
  delivery: [['delivery', (row) => row.delivery]],
  deliveryDate: [['del_date', (row) => row.deliveryDay]],
  driver: [
    ['driver', (row) => row.drivers.map((driver) => driver.name).join(' / ')],
  ],
  truck: [['truck', (row) => row.truck]],
  status: [['status', (row) => row.operationalStatus]],
  billing: [['billing', (row) => row.billingStatus]],
  rate: [['rate', (row) => csvMoney(row.linehaulCents)]],
  warnings: [['warnings', (row) => row.warnings.map((w) => w.name).join(';')]],
}

const isLoadColumn = (key: string): key is LoadColumn =>
  Object.hasOwn(FILE_COLUMNS, key)

/** The CSV document for these rows, in these screen columns. */
export function loadsCsv(
  rows: readonly LoadListRow[],
  visible: readonly string[],
): string {
  const columns = visible
    .filter(isLoadColumn)
    .flatMap((key) => FILE_COLUMNS[key])
  return toCsv(
    columns.map(([header]) => header),
    rows.map((row) => columns.map(([, value]) => value(row))),
  )
}

/**
 * `zebra-loads-<view>-<yyyy-mm-dd>.csv` — the view's NAME, or `all` without
 * one. Only a known view name reaches the filename, so a crafted `?view=`
 * cannot put anything else into a header.
 */
export function loadsCsvFilename(
  view: string | undefined,
  knownView: boolean,
  today: string,
): string {
  return `zebra-loads-${view !== undefined && knownView ? view : 'all'}-${today}.csv`
}
