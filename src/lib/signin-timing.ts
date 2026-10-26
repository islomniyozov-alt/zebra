import { ARGON2_PARAMS } from './password'
import { MODULE_LOADED_AT } from './request-timing'

// ---------------------------------------------------------------------------
// WHERE A SIGN-IN SPENDS ITS TIME (GAPS 24, owner's brief 2026-10-12).
//
// Measurement only. Three deployed sweeps in two days had one role's sign-in
// stall past 90 seconds and succeed on the retry, and nothing said which part
// of the sign-in stalled. This writes one structured log line per sign-in
// attempt so `wrangler tail` can answer it: the user lookup, the session
// insert and the total, plus the spans that complete the total (the
// rate-limit read, which is the request's FIRST query and so also pays for
// opening the Neon socket; membership; the closing writes).
//
// NO EMAIL AND NO HASH, by construction: the fields are numbers, an outcome,
// a role and the argon2 parameters, and nothing else is accepted.
//
// ── ARGON2 IS MEASURED BY THE RUNTIME, NOT BY A STOPWATCH ─────────────────
//
// Owner's ruling, 2026-10-12, on the first three sweeps' numbers. On workerd
// the clock advances only across I/O, so a stopwatch around the synchronous
// argon2id verify read 0 ms in all twelve attempts — and yielding a macrotask
// first did not help, because a `setTimeout(0)` is not I/O either. The verify's
// time landed in whichever span next waited on the database. The runtime's
// own `cpuTime` for the invocation, read from the tail beside this line, is
// the measure (1.1 s median, 1.3 s worst, over twelve sign-ins): argon2id is
// the only CPU-heavy thing a sign-in does. So there is no verify span here.
// ---------------------------------------------------------------------------

export interface SignInSpans {
  /** Failures counted before anything else; the request's first query. */
  rateLimitMs: number | null
  /** `User` by email. */
  lookupMs: number | null
  /** Membership resolution. Absorbs the argon2 verify's wall time — see above. */
  membershipMs: number | null
  /** The budget the membership transaction ran under (GAPS 37): `maxWait`. */
  membershipMaxWaitMs: number | null
  /** …and its `timeout`. Both from `TRANSACTION_BUDGET` unless a call site says otherwise. */
  membershipTimeoutMs: number | null
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
  membershipMs: null,
  membershipMaxWaitMs: null,
  membershipTimeoutMs: null,
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

// ── THE ISOLATE, FOR "FIRST REQUEST AFTER IDLE" ───────────────────────────
//
// Module state lives as long as the isolate. A fresh isolate's first sign-in
// has `isolateSignIns: 1` and no idle figure; a warm one reports how long it
// sat since its previous sign-in. `startedAt` is when this one began, so a
// stall can be lined up against the sweep's own timeline and the database's.

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
 *
 * `sinceModuleEvalMs` (GAPS 26) is the gap from this isolate's module
 * evaluation to the action's first line — on a fresh isolate, the
 * I/O-advanced part of what the framework did before the action ran.
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
    membershipMs: spans.membershipMs,
    membershipMaxWaitMs: spans.membershipMaxWaitMs,
    membershipTimeoutMs: spans.membershipTimeoutMs,
    sessionMs: spans.sessionMs,
    finalizeMs: spans.finalizeMs,
    totalMs: spans.totalMs,
    actionMs: input.actionMs,
    sinceModuleEvalMs: input.startedAt - MODULE_LOADED_AT,
    isolateSignIns: input.isolate.isolateSignIns,
    isolateIdleMs: input.isolate.isolateIdleMs,
    startedAt: new Date(input.startedAt).toISOString(),
    argon2: `m=${ARGON2_PARAMS.m},t=${ARGON2_PARAMS.t},p=${ARGON2_PARAMS.p}`,
  })
}

// ── WHAT THREW, WHEN THE SIGN-IN SAYS "UNAVAILABLE" (GAPS 37) ─────────────
//
// Owner's ruling, 2026-10-23. One sign-in in 19 came back `unavailable` after
// 11.3 s of CPU and the record could not say what threw: the action's catch
// swallowed the error and logged nothing but the timing line. This is the
// line that names it — the error's class, its message and its first stack
// frame — written before the form says "unavailable". NO PII: the message is
// capped and scrubbed of anything shaped like a credential in a URL or an
// email address, and nothing from the form reaches it.

const MESSAGE_CAP = 300

/** A message with URL credentials and email addresses removed. */
export function scrubMessage(text: string): string {
  return text
    .replace(/(\w+:\/\/)[^\s/@]+@/g, '$1<redacted>@')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<email>')
    .slice(0, MESSAGE_CAP)
}

/** The first frame of a stack, after the message line, or null. */
export function firstFrameOf(stack: string | undefined): string | null {
  const frame = (stack ?? '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('at '))
  return frame ? scrubMessage(frame) : null
}

export function signInErrorLine(error: unknown): string {
  const named =
    error && typeof error === 'object'
      ? (error as Record<string, unknown>)
      : null
  const cls =
    (typeof named?.name === 'string' && named.name) ||
    (named?.constructor as { name?: string } | undefined)?.name ||
    typeof error
  const message =
    typeof named?.message === 'string' ? named.message : String(error)
  return JSON.stringify({
    event: 'signin.error',
    class: cls,
    message: scrubMessage(message),
    firstFrame: firstFrameOf(
      typeof named?.stack === 'string' ? named.stack : undefined,
    ),
  })
}
