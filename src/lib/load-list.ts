import type {
  LoadBillingStatus,
  LoadOperationalStatus,
  Prisma,
} from '@/generated/prisma/client'
import { readyToInvoiceWhere } from './invoices'
import { loadSearchWhere } from './loads'
import { viewWhere, type LoadViewName, type ViewContext } from './load-views'
import type { CompanyScopeFilter } from './tenancy'

// ---------------------------------------------------------------------------
// THE LOADS LIST'S WHERE, BUILT ONCE (TMS-DESIGN-SYSTEM.md §6.7, 2026-10-08).
//
// The page used to merge its filters with object spread. Two of them carry an
// `OR` — the reference search and the `unassigned` view — so whichever was
// spread last silently replaced the other, and `?view=unassigned&ref=T-1`
// ignored the search. Every part is now one element of an `AND`, and nothing
// can overwrite anything.
//
// The page, its chip counts, the export (§6.7 item 7) and the agreement tests
// all read this, so the list and the numbers describing it come from one place.
// ---------------------------------------------------------------------------

/**
 * The billing chip whose filter is a predicate rather than an enum value.
 *
 * Not a `LoadBillingStatus`: it is the same string the column happens to use,
 * but it selects through `readyToInvoiceWhere()`.
 */
export const READY = 'READY_TO_INVOICE'

/** The list's URL, read once. Absent means "not filtering on this". */
export interface LoadListParams {
  status?: string
  billing?: string
  company?: string
  ref: string
  view?: string
  from?: string
  to?: string
  customer?: string
  driver?: string
}

export function readLoadListParams(
  params: Record<string, string | string[] | undefined>,
): LoadListParams {
  const one = (key: string): string | undefined => {
    const value = params[key]
    return typeof value === 'string' && value !== '' ? value : undefined
  }
  return {
    status: one('status'),
    billing: one('billing'),
    company: one('company'),
    ref: (one('ref') ?? '').trim(),
    view: one('view'),
    from: one('from'),
    to: one('to'),
    customer: one('customer'),
    driver: one('driver'),
  }
}

/** Every filter on the list, one `where` per group. */
export interface LoadListWhere {
  /** Scope, company, search, broker and driver. Every count honours these. */
  base: Prisma.LoadWhereInput
  status: Prisma.LoadWhereInput
  billing: Prisma.LoadWhereInput
  view: Prisma.LoadWhereInput
}

export function loadListWhere(
  params: LoadListParams,
  scope: CompanyScopeFilter,
  ctx: ViewContext,
): LoadListWhere {
  const base: Prisma.LoadWhereInput = {
    AND: [
      { deletedAt: null },
      scope,
      params.company ? { companyId: params.company } : {},
      loadSearchWhere(params.ref),
      params.customer ? { customerId: params.customer } : {},
      // EITHER SEAT. A team load is the second driver's load too (§6.4 part 3).
      params.driver
        ? {
            OR: [{ driverId: params.driver }, { coDriverId: params.driver }],
          }
        : {},
    ],
  }
  return {
    base,
    status: params.status
      ? { operationalStatus: params.status as LoadOperationalStatus }
      : {},
    // READY TO INVOICE IS A PREDICATE, NOT A COLUMN VALUE. `billingStatus`
    // says READY_TO_INVOICE for direct-settled freight too, which the invoice
    // queue refuses to show; filtering on the column would list loads the
    // queue does not.
    billing:
      params.billing === READY
        ? readyToInvoiceWhere()
        : params.billing
          ? { billingStatus: params.billing as LoadBillingStatus }
          : {},
    view: viewWhere(params.view, {
      ...ctx,
      from: params.from,
      to: params.to,
    }),
  }
}

const and = (...parts: Prisma.LoadWhereInput[]): Prisma.LoadWhereInput => ({
  AND: parts,
})

/** The rows on screen, and the footer's total. */
export function listWhere(where: LoadListWhere): Prisma.LoadWhereInput {
  return and(where.base, where.status, where.billing, where.view)
}

/**
 * A chip's count honours every OTHER active filter and ignores its own group
 * (§7.4), so clicking it lands on exactly the number it promised. The view is a
 * filter like any other, and the status and billing counts honour it.
 */
export function statusCountWhere(where: LoadListWhere): Prisma.LoadWhereInput {
  return and(where.base, where.billing, where.view)
}

export function billingCountWhere(where: LoadListWhere): Prisma.LoadWhereInput {
  return and(where.base, where.status, where.view)
}

/** The Ready to invoice chip, whose predicate is not a column `groupBy` sees. */
export function readyCountWhere(where: LoadListWhere): Prisma.LoadWhereInput {
  return and(where.base, where.status, where.view, readyToInvoiceWhere())
}

/**
 * A view chip's count: every other filter, and this view in place of the
 * active one. The same `viewWhere` the list resolves `?view=` through.
 */
export function viewCountWhere(
  where: LoadListWhere,
  name: LoadViewName,
  ctx: ViewContext,
): Prisma.LoadWhereInput {
  return and(where.base, where.status, where.billing, viewWhere(name, ctx))
}
