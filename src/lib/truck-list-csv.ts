import type { TRUCK_COLUMN_KEYS } from './list-columns'
import { toCsv } from './list-view'
import type { TruckListRow } from './truck-list-rows'
import type { TruckViewName } from './truck-list'

// ---------------------------------------------------------------------------
// THE TRUCKS LIST AS A FILE (TMS-DESIGN-SYSTEM.md §6.5 part 1, §7.1.5).
//
// THE PERSON'S VISIBLE COLUMNS, IN THE TABLE'S ORDER, so the file matches the
// screen it was exported from. CODES, NOT LABELS: a status is `OUT_OF_SERVICE`,
// not "Out of service" in whatever language the person reads, because the
// file is read by a machine downstream. A removed truck's status cell is
// `REMOVED`, which is what the screen's cell says in words.
// ---------------------------------------------------------------------------

type TruckColumn = (typeof TRUCK_COLUMN_KEYS)[number]

/**
 * Per screen column, its file columns: a header and a value each. The Status
 * column is two in the file (round two): the DERIVED `status` the screen
 * shows, and `override` — the stored manual override or nothing — so a reader
 * can tell a shop from a road.
 */
const FILE_COLUMNS: Record<
  TruckColumn,
  readonly (readonly [string, (row: TruckListRow) => string | number | null])[]
> = {
  unitNumber: [['unit_number', (row) => row.unitNumber]],
  make: [['make', (row) => row.make]],
  model: [['model', (row) => row.model]],
  plate: [['plate', (row) => row.plate]],
  vin: [['vin', (row) => row.vin]],
  year: [['year', (row) => row.year]],
  plateState: [['state', (row) => row.plateState]],
  company: [['authority', (row) => row.companyName]],
  driver: [['driver', (row) => row.crew.map((seat) => seat.name).join(' / ')]],
  ownerName: [['owner_name', (row) => row.ownerName]],
  odometer: [['odometer', (row) => row.odometer]],
  status: [
    ['status', (row) => (row.isRetired ? 'REMOVED' : row.status)],
    ['override', (row) => row.override],
  ],
  fleetStatus: [['fleet_status', (row) => row.fleetStatus]],
  aging: [['aging_days', (row) => row.agingDays]],
  headingTo: [['heading_to', (row) => row.headingTo]],
  warnings: [['warnings', (row) => row.warnings.map((w) => w.name).join(';')]],
}

const isTruckColumn = (key: string): key is TruckColumn =>
  Object.hasOwn(FILE_COLUMNS, key)

/** The CSV document for these rows, in these screen columns. */
export function trucksCsv(
  rows: readonly TruckListRow[],
  visible: readonly string[],
): string {
  const columns = visible
    .filter(isTruckColumn)
    .flatMap((key) => FILE_COLUMNS[key])
  return toCsv(
    columns.map(([header]) => header),
    rows.map((row) => columns.map(([, value]) => value(row))),
  )
}

/**
 * `zebra-trucks-<view>-<yyyy-mm-dd>.csv` — the view's NAME, `active` without
 * one, because an unknown `?view=` already resolved to Active. Only a view
 * name can reach the filename, so nothing from the URL lands in a header.
 */
export function trucksCsvFilename(view: TruckViewName, today: string): string {
  return `zebra-trucks-${view}-${today}.csv`
}
