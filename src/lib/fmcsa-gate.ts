// ---------------------------------------------------------------------------
// A BUDGET ON THE FMCSA LOOKUP (Phase 6 §7 flag 24, the parked half).
//
// The flag parked this deliberately: while the only caller was the Add
// authority screen, the exposure was an OWNER or ADMIN pressing a button in a
// loop, and the flag said it "becomes real the day this same service is
// pointed at broker verification, where a DISPATCHER might hold the permission
// and a load list might look them up in bulk."
//
// That day is today, and wider than the flag guessed. `customer:create` is
// held by DISPATCHER because §9's create-on-miss needs it, AND by ACCOUNTING
// through RECORDS_WRITE, because keeping a broker's billing email, terms and
// block current is accounting's job. So the broker lookup puts the same
// outbound key in front of EVERY role, where the authority lookup put it in
// front of two. This budget is sized for that list.
//
// WHAT THIS PROTECTS IS NOT ZEBRA. It is the shared `FMCSA_WEBKEY`, which is
// per-organization at Anthropic-scale nothing and at FMCSA-scale a single
// credential that a public service can throttle or revoke for everyone at
// once. A loop on one dispatcher's screen must not cost every authority in
// every tenant its lookups.
//
// TWO BUDGETS, because the two failures are different:
//
//   * PER USER — the accidental loop, the double-click, the person who does
//     not believe the first answer. Small and short.
//   * OVERALL — the aggregate, so twenty users each politely inside their own
//     budget cannot together exceed what the key can spend.
//
// IN MEMORY, AND THAT IS A REAL LIMITATION, STATED PLAINLY. Workers have no
// shared memory: this counts within one isolate, and Cloudflare may be running
// several. It stops the loop it was built to stop — a runaway client hits one
// isolate over and over — and it does NOT stop a determined authenticated user
// spreading requests across isolates. The honest fix is a Durable Object or a
// KV counter, which is a binding and a deployment change rather than a code
// change. Flagged rather than pretended about.
//
// NOTHING IS STORED. No table, no migration, no per-request write to Neon for
// a counter — the transaction budget in loads.ts is what that would cost, on a
// path whose whole job is to be a convenience.
// ---------------------------------------------------------------------------

/** Per person, per window. Enough to look up a carrier and check it twice. */
export const PER_USER_LIMIT = 10

/** Everybody in this isolate, per window. */
export const OVERALL_LIMIT = 60

/** The window both budgets are measured over. */
export const WINDOW_MS = 60_000

/**
 * When each recent lookup happened, per key. The empty string is the overall
 * bucket — a user id can never be empty, so it cannot collide.
 */
const buckets = new Map<string, number[]>()

const OVERALL = ''

export interface GateOutcome {
  allowed: boolean
  /** Whole seconds until the caller may try again. Zero when allowed. */
  retryAfterSeconds: number
}

/**
 * Take one lookup from the budget, or refuse.
 *
 * A SLIDING WINDOW, not a fixed one. A fixed window lets somebody spend the
 * whole budget in the last second of one window and the whole of the next in
 * the first second of the next — twice the limit in two seconds, which is
 * precisely the burst that matters here.
 *
 * `now` is injected so the tests are not a story about `setTimeout`.
 */
export function takeLookupSlot(userId: string, now = Date.now()): GateOutcome {
  const overall = recent(OVERALL, now)
  const mine = recent(userId, now)

  // CHECKED BEFORE EITHER IS RECORDED. Recording first and refusing after
  // would let a refused attempt push the oldest allowed one out of the window,
  // so a client in a tight loop would keep its budget permanently spent and
  // never recover — a rate limiter that punishes retrying is a rate limiter
  // that turns a burst into an outage.
  if (mine.length >= PER_USER_LIMIT) {
    return { allowed: false, retryAfterSeconds: waitFor(mine, now) }
  }
  if (overall.length >= OVERALL_LIMIT) {
    return { allowed: false, retryAfterSeconds: waitFor(overall, now) }
  }

  mine.push(now)
  overall.push(now)
  buckets.set(userId, mine)
  buckets.set(OVERALL, overall)
  return { allowed: true, retryAfterSeconds: 0 }
}

/** The timestamps still inside the window, dropping the ones that have aged out. */
function recent(key: string, now: number): number[] {
  const kept = (buckets.get(key) ?? []).filter((at) => now - at < WINDOW_MS)
  // An empty bucket is deleted rather than kept: this map is the only thing in
  // the module that grows, and one entry per user who ever looked anything up
  // would be a slow leak in a long-lived isolate.
  if (kept.length === 0) buckets.delete(key)
  else buckets.set(key, kept)
  return kept
}

/** How long until the oldest recorded lookup leaves the window. */
function waitFor(timestamps: number[], now: number): number {
  const oldest = timestamps[0]
  if (oldest === undefined) return 0
  return Math.max(1, Math.ceil((WINDOW_MS - (now - oldest)) / 1000))
}

/** Tests only. Nothing in the application has a reason to forget a budget. */
export function resetLookupBudget(): void {
  buckets.clear()
}
