import { ARGON2_PARAMS } from './password'

// ---------------------------------------------------------------------------
// WHERE A SIGN-IN SPENDS ITS TIME (GAPS 24, owner's brief 2026-10-12).
//
// Measurement only. Three deployed sweeps in two days had one role's sign-in
// stall past 90 seconds and succeed on the retry, and nothing said which part
// of the sign-in stalled. This writes one structured log line per sign-in
// attempt so `wrangler tail` can answer it: the argon2id verify, the user
// lookup, the session insert and the total, plus the spans that complete the
// total (the rate-limit read, which is the request's FIRST query and so also
// pays for opening the Neon socket; membership; the closing writes).
//
// NO EMAIL AND NO HASH, by construction: the fields are numbers, an outcome,
// a role and the argon2 parameters, and nothing else is accepted.
//
// ── THE CLOCK DOES NOT MOVE WHILE CODE RUNS ───────────────────────────────
//
// On workerd, `Date.now()` and `performance.now()` advance only when I/O
// happens — a Spectre mitigation. argon2id is synchronous pure JavaScript, so
// a stopwatch around it reads the time BEFORE it ran at both ends: 0 ms. The
// verify span therefore yields to the event loop (`setTimeout(0)`) before it
// stops the watch, which lets the clock catch up. The tail's per-request
// `cpuTime` is the cross-check, and it is read beside this line.
// ---------------------------------------------------------------------------

export interface SignInSpans {
  /** Failures counted before anything else; the request's first query. */
  rateLimitMs: number | null
  /** `User` by email. */
  lookupMs: number | null
  /** argon2id (or the dummy hash and its verify, for an unknown email). */
  verifyMs: number | null
  /** Membership resolution. */
  membershipMs: number | null
  /** The `Session` insert. */
  sessionMs: number | null
  /** The success row and `lastLoginAt`. */
  finalizeMs: number | null
  /** `login()` from its first line to its return. */
  totalMs: number | null
  /** How many times `login()` ran (the socket retry can run it twice). */
  attempts: number
  /** The role signed in as; null on any failure. */
  role: string | null
}

export const newSignInSpans = (): SignInSpans => ({
  rateLimitMs: null,
  lookupMs: null,
  verifyMs: null,
  membershipMs: null,
  sessionMs: null,
  finalizeMs: null,
  totalMs: null,
  attempts: 0,
  role: null,
})

/** Milliseconds, rounded, from `start` to now. */
export const since = (
  start: number,
  now: () => number = performance.now.bind(performance),
) => Math.round(now() - start)

/**
 * Let the workerd clock catch up after synchronous work. Elsewhere it is a
 * single macrotask, which is the price of a verify span that is not zero.
 */
export const clockCatchUp = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0))

// ── THE ISOLATE, FOR "FIRST REQUEST AFTER IDLE" ───────────────────────────
//
// Module state lives as long as the isolate. A fresh isolate's first sign-in
// has `isolateSignIns: 1` and no idle figure; a warm one reports how long it
// sat since its previous sign-in. `wallClockMs` is when this one started, so
// a stall can be lined up against the sweep's own timeline and the database's.

let isolateSignIns = 0
let lastSignInAt: number | null = null

export function isolateMark(now: number = Date.now()): {
  isolateSignIns: number
  isolateIdleMs: number | null
} {
  isolateSignIns += 1
  const idle = lastSignInAt === null ? null : now - lastSignInAt
  lastSignInAt = now
  return { isolateSignIns, isolateIdleMs: idle }
}

/**
 * The one line, as JSON so the tail carries it whole. Built from named fields
 * only: there is no way to pass an email or a hash through it.
 */
export function signInTimingLine(input: {
  outcome: string
  spans: SignInSpans
  actionMs: number
  isolate: { isolateSignIns: number; isolateIdleMs: number | null }
  startedAt: number
}): string {
  const { spans } = input
  return JSON.stringify({
    event: 'signin.timing',
    outcome: input.outcome,
    role: spans.role,
    attempts: spans.attempts,
    rateLimitMs: spans.rateLimitMs,
    lookupMs: spans.lookupMs,
    verifyMs: spans.verifyMs,
    membershipMs: spans.membershipMs,
    sessionMs: spans.sessionMs,
    finalizeMs: spans.finalizeMs,
    totalMs: spans.totalMs,
    actionMs: input.actionMs,
    isolateSignIns: input.isolate.isolateSignIns,
    isolateIdleMs: input.isolate.isolateIdleMs,
    startedAt: new Date(input.startedAt).toISOString(),
    argon2: `m=${ARGON2_PARAMS.m},t=${ARGON2_PARAMS.t},p=${ARGON2_PARAMS.p}`,
  })
}
