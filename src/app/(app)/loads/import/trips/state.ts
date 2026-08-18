// The shape the trips-import screen passes back and forth, in a PLAIN module.
//
// Not in `actions.ts`: a "use server" file may only export async functions, so
// exporting a constant from there compiles, typechecks, and then fails at
// runtime as a 500 with nothing in the browser to explain it. The repository
// has a lint rule for exactly this and it has caught it before.

export interface TripRowView {
  tripId: string
  /** "DEN7 → MKC6 → ORD5", for a dispatcher to recognise at a glance. */
  lane: string
  stops: number
  miles: string
  /** ENRICH means a load already carries this reference — the email made it. */
  action: 'create' | 'enrich' | 'unchanged'
  /** What enrichment would add, or why nothing changes. */
  actionDetail: string
  /** Cancelled legs dropped from this trip. Rule 3, said out loud. */
  skippedLegs: number
  /** Facility codes with no location in the book. Written as names, not guesses. */
  unresolved: string[]
  /** Driver and equipment, shown only. Rule 7: nothing is auto-assigned. */
  driver: string
  equipment: string
}

export interface TripsPlanView {
  rows: TripRowView[]
  /** Prefix near-misses and trips with nothing usable. */
  warnings: string[]
  createCount: number
  enrichCount: number
  unchangedCount: number
  skippedLegTotal: number
  /** Distinct facility codes the book could not resolve. */
  unresolvedCodes: string[]
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
