import type { Prisma } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// WHICH ONE-OFF CHARGES A BATCH MAY TAKE (MONEY-DESIGN §4, owner's ruling
// 2026-11-18; migration 75).
//
// One driver can sit in two authorities' batches over overlapping dates — the
// no-overlap rule binds a scope, and two authorities share dates freely — and
// the statement's letterhead is the truck's company in both, so nothing on the
// statement tells them apart. A charge added from RAM's batch must not be read
// by Dolphins' draft for the same driver, or it is taken twice.
//
// ONE PREDICATE, TWO CALLERS: the engine's reader (`batchInputForOrg`), which
// decides what a draft deducts, and `finaliseBatch`'s mark-as-taken, which
// decides what no later batch may take again. If they disagreed, a batch could
// deduct a charge and leave it unsettled, or settle one it never deducted.
//
//   charge.companyId null   → any batch (every charge before this ruling)
//   charge.companyId X      → a batch of authority X, or an org-wide batch
//                             (the overlap rule forbids an org-wide batch and
//                             an authority's batch over the same dates)
// ---------------------------------------------------------------------------

export function chargeScopeWhere(
  batchCompanyId: string | null,
): Prisma.SettlementChargeWhereInput {
  if (batchCompanyId === null) return {}
  return { OR: [{ companyId: null }, { companyId: batchCompanyId }] }
}
