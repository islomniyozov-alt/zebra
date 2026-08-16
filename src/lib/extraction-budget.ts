// ---------------------------------------------------------------------------
// A BUDGET ON WHAT INBOUND MAIL CAN SPEND ON THE MODEL.
//
// `UnroutedEmail` is the only table in this system whose write rate is set by
// the outside world: anybody who emails a routed address causes work. That was
// tolerable while the address was known to one carrier group and four test
// messages, and it stops being tolerable the day it is published — which is
// the day the write rate stops being ours (brief flag 69).
//
// IT PROTECTS THE MODEL SPEND, AND NOTHING ELSE. Storage growth is
// retention's job, already ruled and already ordered behind visibility. What
// cannot be undone by a purge is money handed to a vendor, so that is what
// has a budget.
//
// IT COUNTS EXTRACTIONS STARTED, NOT REQUESTS. A request that never reaches
// the model costs nothing and takes nothing.
//
// PER ORGANIZATION, NEVER PER SENDER. The envelope sender is trivially
// forged, so a per-sender limit is evadable by anyone who cares and unfair to
// a broker legitimately sending twenty bookings before lunch. The spend has an
// owner, and the owner is the tenant whose inbox it arrived at.
//
// IT NEVER SEES A REDELIVERY, BY CONSTRUCTION rather than by cleverness. A
// second copy of a message exits at the duplicate branch before the model is
// reached, so it never takes a slot. That matters more than it sounds: Gmail
// knocked FOUR TIMES with one message over 54 minutes on 2026-08-15 —
// 6m28s, 20m48s, 27m02s apart — and a limiter that counted deliveries would
// have read our own first real booking as abuse.
//
// IN MEMORY, AND THAT IS A REAL LIMITATION, STATED PLAINLY — the same one
// `fmcsa-gate.ts` carries. Workers have no shared memory: this counts within
// one isolate and Cloudflare may be running several, so the true ceiling is
// this number times the isolates in play. It stops a flood arriving down one
// pipe, which is the shape mail actually arrives in, and it does not stop a
// determined attacker spreading across isolates. The honest fix is a Durable
// Object or a KV counter — a binding and a deployment change rather than a
// code change. Flagged rather than pretended about.
// ---------------------------------------------------------------------------

/**
 * Extractions one organization may start per window.
 *
 * DELIBERATELY AN ORDER OF MAGNITUDE ABOVE REAL VOLUME. This is not a quota
 * anybody should ever notice; it is a ceiling on an accident or an attack. A
 * busy day is a handful of bookings, so a number that a real week could reach
 * would eventually refuse real freight, and a limiter that refuses real
 * freight gets removed rather than tuned.
 */
export const EXTRACTIONS_PER_ORG = 30

/** The window it is measured over. */
export const EXTRACTION_WINDOW_MS = 60 * 60 * 1000

/** When each recent extraction started, per organization. */
const buckets = new Map<string, number[]>()

export interface BudgetOutcome {
  allowed: boolean
  /** Whole seconds until a slot frees up. Zero when allowed. */
  retryAfterSeconds: number
}

/**
 * Take one extraction from the budget, or refuse.
 *
 * A SLIDING WINDOW, not a fixed one. A fixed window lets a sender spend the
 * whole budget in the last minute of one hour and the whole of the next in the
 * first minute of the following hour — twice the ceiling in two minutes.
 *
 * CHECKED BEFORE IT IS RECORDED. Recording first and refusing after would let
 * a refused attempt push the oldest allowed one out of the window, so a sender
 * in a loop would keep its budget permanently spent and never recover. A rate
 * limiter that punishes retrying turns a burst into an outage.
 *
 * `now` is injected so the tests are not a story about `setTimeout`.
 */
export function takeExtractionSlot(
  organizationId: string,
  now = Date.now(),
): BudgetOutcome {
  const mine = recent(organizationId, now)

  if (mine.length >= EXTRACTIONS_PER_ORG) {
    const oldest = Math.min(...mine)
    const waitMs = EXTRACTION_WINDOW_MS - (now - oldest)
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)),
    }
  }

  mine.push(now)
  buckets.set(organizationId, mine)
  return { allowed: true, retryAfterSeconds: 0 }
}

/** The timestamps still inside the window, dropping the ones that have aged out. */
function recent(key: string, now: number): number[] {
  const kept = (buckets.get(key) ?? []).filter(
    (at) => now - at < EXTRACTION_WINDOW_MS,
  )
  // An empty bucket is deleted rather than kept: this map is the only thing in
  // the module that grows.
  if (kept.length === 0) buckets.delete(key)
  else buckets.set(key, kept)
  return kept
}

/** Tests only. An isolate in production never wants its budget forgotten. */
export function resetExtractionBudget(): void {
  buckets.clear()
}
