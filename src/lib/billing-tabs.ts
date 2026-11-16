import { listWhere, loadListWhere, type LoadListParams } from './load-list'
import { chipCounts, loadCountGroups } from './load-list-counts'
import { readLoadRows, type LoadListRow } from './load-list-rows'
import type { ViewContext } from './load-views'
import { companyScopeFilter, type TxClient } from './tenancy'

// ---------------------------------------------------------------------------
// BILLING → INVOICE'S LOAD TABS (TMS-DESIGN-SYSTEM.md §6.7, the second pass,
// owner's brief 2026-11-16). The invoicing chips left `/loads` and became tabs
// here, where accounting works: POD received · Ready to invoice · Uninvoiced ·
// Invoiced · Partially paid · Paid.
//
// READY TO INVOICE IS NOT IN THIS FILE: it was already this page's queue, with
// its own reader and its own count, held to the old chip by a test. The other
// five list LOADS — no invoice exists for an uninvoiced load — and each keeps
// the predicate its chip had, by being that chip's own `LoadListParams`: the
// list's `where` and the grouped count, nothing restated.
// ---------------------------------------------------------------------------

export const BILLING_LOAD_TABS = [
  'podReceived',
  'uninvoiced',
  'invoiced',
  'partiallyPaid',
  'paid',
] as const

export type BillingLoadTab = (typeof BILLING_LOAD_TABS)[number]

export function isBillingLoadTab(value: string): value is BillingLoadTab {
  return (BILLING_LOAD_TABS as readonly string[]).includes(value)
}

/** The chip each tab was on `/loads`: the status chip, or a billing chip. */
const CHIP: Record<
  BillingLoadTab,
  Pick<LoadListParams, 'status' | 'billing'>
> = {
  podReceived: { status: 'POD_RECEIVED' },
  uninvoiced: { billing: 'UNINVOICED' },
  invoiced: { billing: 'INVOICED' },
  partiallyPaid: { billing: 'PARTIALLY_PAID' },
  paid: { billing: 'PAID' },
}

/** A tab's list parameters: its chip, the authority and the search. */
export function billingTabParams(
  tab: BillingLoadTab,
  narrow: { company?: string; ref?: string },
): LoadListParams {
  return { ref: narrow.ref ?? '', company: narrow.company, ...CHIP[tab] }
}

/**
 * Every tab's count, from the list's one grouped statement under the
 * authority and the search — a chip's own number, as `/loads` counted it.
 */
export async function billingTabCounts(
  tx: TxClient,
  companyScopes: readonly string[],
  narrow: { company?: string; ref?: string },
  ctx: ViewContext,
): Promise<Record<BillingLoadTab, number>> {
  const counts = chipCounts(
    await loadCountGroups(
      tx,
      { ref: narrow.ref ?? '', company: narrow.company },
      companyScopes,
      ctx,
    ),
    {},
  )
  return Object.fromEntries(
    BILLING_LOAD_TABS.map((tab) => {
      const chip = CHIP[tab]
      return [
        tab,
        chip.status
          ? (counts.status[chip.status] ?? 0)
          : (counts.billing[chip.billing!] ?? 0),
      ]
    }),
  ) as Record<BillingLoadTab, number>
}

/** One page of a tab's loads, newest booking first, through the list's reader. */
export function readBillingTab(
  tx: TxClient,
  companyScopes: readonly string[],
  tab: BillingLoadTab,
  narrow: { company?: string; ref?: string },
  ctx: ViewContext,
  options: { skip?: number; take?: number; now: Date; locale: string },
): Promise<LoadListRow[]> {
  return readLoadRows(
    tx,
    listWhere(
      loadListWhere(
        billingTabParams(tab, narrow),
        companyScopeFilter(companyScopes),
        ctx,
      ),
    ),
    options,
  )
}
