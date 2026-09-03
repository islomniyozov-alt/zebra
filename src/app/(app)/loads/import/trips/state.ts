// The shape the trips-import screen passes back and forth, in a PLAIN module.
//
// Not in `actions.ts`: a "use server" file may only export async functions, so
// exporting a constant from there compiles, typechecks, and then fails at
// runtime as a 500 with nothing in the browser to explain it. The repository
// has a lint rule for exactly this and it has caught it before.

// THE ROW SHAPE LIVES IN `src/lib/trips-preview.ts`, with the function that
// builds it — including the conditional `rate` key that §1.3 requires be
// ABSENT rather than empty for a role without `load.financials`. Re-exported
// here so the form imports one name.
export type { TripRowView } from '@/lib/trips-preview'
import type { TripRowView } from '@/lib/trips-preview'

export interface TripsPlanView {
  rows: TripRowView[]
  /** Prefix near-misses and trips with nothing usable. */
  warnings: string[]
  createCount: number
  enrichCount: number
  unchangedCount: number
  /** Loads somebody cancelled. Skipped whole, and said so. */
  cancelledCount: number
  skippedLegTotal: number
  /** Distinct facility codes the book could not resolve. */
  unresolvedCodes: string[]
  /** Facilities the book HAS, with no street on them. A different fix. */
  noAddressCodes: string[]
  /**
   * Whether the rows carry a `rate` key at all.
   *
   * The table renders the column only when this is true — and it is true only
   * when the server put the key there, so the column cannot exist without the
   * data and the data cannot arrive without the permission.
   */
  showsMoney: boolean
  /**
   * The count that differs between the two import screens on the SAME file.
   *
   * The board importer makes one load per ROW; this one makes one per TRIP. A
   * dispatcher who cannot remember which screen they are on can read it off
   * these two numbers — "16 trips from 41 rows" is only ever true here.
   */
  tripCount: number
  rowCount: number
  /** Where the file's trips are in their life, from the legs themselves. */
  stageCounts: { upcoming: number; running: number; finished: number }
}

export interface TripsImportState {
  error: string | null
  plan: TripsPlanView | null
  /** Posted back with the confirm. Null means nothing has been previewed. */
  signature: string | null
  /** The file changed between preview and confirm; this one has not run. */
  stale: boolean
  created: number | null
  enriched: number | null
}

export const EMPTY_TRIPS_IMPORT: TripsImportState = {
  error: null,
  plan: null,
  signature: null,
  stale: false,
  created: null,
  enriched: null,
}
