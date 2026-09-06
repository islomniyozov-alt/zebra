// ---------------------------------------------------------------------------
// FINISHED FREIGHT NOBODY IS ATTACHED TO IS NOT READY FOR MONEY.
//
// Ruled 2026-09-06 from load 1015: a load with no truck and no driver must not
// read "Ready to invoice". The screen said it because `isReady` asked only
// whether the paperwork had landed and whether there was a figure on it.
//
// ── WHY THE CHECK IS HERE AND NOT ON THE POD TRANSITION ────────────────────
//
// Refusing to record one fact because another is missing is how status columns
// start lying. The POD did arrive; that is true and belongs on the event log
// whatever else is missing. What was false is the CONCLUSION drawn from it —
// that money was ready to move — so the conclusion is what learns the extra
// condition.
//
// It is also load-bearing in a way that is easy to miss: `settleableWhere`
// keys a settlement period on the POD status EVENT, because a Delivered click
// arriving after the POD is refused as stale and so a load can reach
// POD_RECEIVED with no applied DELIVERED event at all. Block the POD
// transition and the event never exists — then assigning a driver next week
// leaves the load invisible to every settlement period, permanently, instead
// of until somebody fixes it. Blocking converts a visible gap into a silent
// one.
//
// ── TWO REASONS, ONE RULE, AND THE DISTINCTION STAYS FINDABLE ──────────────
//
// DRIVER IS THE MONEY-BEARING HALF. `settleableWhere(driverId, …)` filters on
// driverId as an equality, so a load with no driver matches NO driver's query
// — it is never refused, it is simply never found, and nobody is paid. That is
// the failure this rule exists for.
//
// TRUCK IS THE OPERATIONAL HALF. Nothing downstream of billing or settlement
// reads it. It is in the rule because the owner ruled both — freight that
// nobody drove in nothing is not finished work — and because a POD on a load
// with no truck is evidence that an import invented a completion nobody
// witnessed. If these two ever need separating, driver is the one that must
// stay.
// ---------------------------------------------------------------------------

export interface AssignmentFacts {
  driverId: string | null
  truckId: string | null
}

/** Somebody drove this, in something. Both halves, per the 2026-09-06 ruling. */
export function isAssigned(load: AssignmentFacts): boolean {
  return load.driverId !== null && load.truckId !== null
}
