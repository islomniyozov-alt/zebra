// The shape the import screen passes back and forth, in a PLAIN module.
//
// Not in `actions.ts`, because a "use server" file may only export async
// functions: exporting `EMPTY_IMPORT` from there compiles, typechecks, and
// then fails at runtime as a 500 with nothing in the browser to explain it.
// The repository has a lint rule for exactly this, and it caught this file.

export interface PlanRowView {
  rowNumber: number
  loadId: string
  lane: string
  stops: number
  first: string
  last: string
  miles: string
  /**
   * ABSENT — not empty — for a role without `load.financials`.
   *
   * AGENTS.md: never send a field to the client that the role cannot see. A
   * dispatcher's preview has no rate key in it at all, so the column cannot be
   * rendered, cannot be read off the wire, and cannot come back in a payload.
   */
  rate?: string
  warnings: string[]
}

export interface SkipView {
  rowNumber: number
  loadId: string
  reason: string
}

export interface PlanView {
  create: PlanRowView[]
  skip: SkipView[]
  /** The sentence about how this freight gets paid. */
  settlement: string
  /** True when the plan carries a rate column at all. */
  showsMoney: boolean
}

export interface RelayImportState {
  error: string | null
  plan: PlanView | null
  /** Posted back with the confirm. Null means nothing has been previewed. */
  signature: string | null
  /** The plan changed between preview and confirm; this one has not run. */
  stale: boolean
  /** Set once loads exist. */
  created: number | null
  failed: number | null
}

export const EMPTY_IMPORT: RelayImportState = {
  error: null,
  plan: null,
  signature: null,
  stale: false,
  created: null,
  failed: null,
}
