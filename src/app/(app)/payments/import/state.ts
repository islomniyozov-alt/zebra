import type { MessageKey } from '@/lib/i18n'

// The shape the remittance-import screen passes back and forth, in a PLAIN
// module — a `'use server'` file may export async functions and nothing else.
// `trips/state.ts` records the same rule and the same 500 it produces.

/** One row of the preview table: what this workbook would do to one reference. */
export interface RemittanceRowView {
  reference: string
  /** `matched`, `short`, `over`, `unmatched`, `closed history`, `unkeyable`. */
  outcome: string
  outcomeLabel: string
  loads: string
  /** Pre-formatted by the server; absent when the role may not see money. */
  remitted?: string
  rated?: string
}

export interface RemittancePlanView {
  invoiceNumber: string
  workPeriod: string
  /** The carrier line as Amazon printed it, and the company it resolved to. */
  carrier: string
  companyName: string
  /** Pre-formatted. Absent for a role without `load.financials`. */
  total?: string
  rows: RemittanceRowView[]
  counts: { label: string; n: number }[]
  /** Distinct references named by the workbook that no load carries. */
  unmatchedReferences: string[]
  /**
   * TRUE WHEN THE WHOLE INVOICE IS A CREDIT.
   *
   * Owner's ruling, 2026-09-27: such a workbook books a Payment with zero
   * applications, unapplied by design. The preview says so in words, because its
   * row counts read `unmatched` and `unkeyable` — every word true and all of it
   * an invitation to hunt for a load that was never there.
   */
  isCredit: boolean
  creditText: string | null
  showsMoney: boolean
}

export interface RemittanceImportState {
  error: MessageKey | null
  plan: RemittancePlanView | null
  /** Posted back with the confirm; null means nothing has been previewed. */
  signature: string | null
  /** The file changed between preview and confirm; this one has not run. */
  stale: boolean
  /** Set once the write lands. */
  paymentId: string | null
  appliedUnits: number | null
  applied: string | null
  unapplied: string | null
  alreadyImported: boolean
}

export const EMPTY_REMITTANCE_IMPORT: RemittanceImportState = {
  error: null,
  plan: null,
  signature: null,
  stale: false,
  paymentId: null,
  appliedUnits: null,
  applied: null,
  unapplied: null,
  alreadyImported: false,
}
