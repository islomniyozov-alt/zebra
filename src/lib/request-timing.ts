// ---------------------------------------------------------------------------
// WHERE A REQUEST SPENDS ITS TIME, FOR THE TAIL TO READ (GAPS 26, owner's brief
// 2026-10-12). Measurement only.
//
// The sign-in POST ran 14 s of wall on the Worker while `login()` took 3.7 s,
// and nothing in the code could say where the other ten went. These are the
// instruments for the two requests a sign-in is made of: the shell layout and
// the page it redirects to write one structured line each, and the sign-in
// line gains the gap between the isolate's module evaluation and the action.
//
// NO PII, BY CONSTRUCTION: every line is built from named numeric fields, an
// outcome and a role. Nothing else is accepted.
//
// ── THE CLOCK, AGAIN ──────────────────────────────────────────────────────
//
// workerd advances `Date.now()` and `performance.now()` only across I/O. Every
// span here wraps a database round trip, so it is measured truthfully; what a
// span cannot see is synchronous CPU, which the tail's own `cpuTime` reports
// per invocation. `MODULE_LOADED_AT` is read when this module is evaluated —
// on a fresh isolate, the arrival time of the request that woke it — so the
// gap to a handler's start is the I/O-advanced part of what the framework did
// first, and reads 0 on a warm isolate's later requests only if nothing waited.
// ---------------------------------------------------------------------------

/** When this isolate evaluated its modules (see the note on the clock). */
export const MODULE_LOADED_AT = Date.now()

/**
 * A request's clock: when it started (epoch ms, for the line) and how long
 * since (whole ms). THE CLOCK IS READ HERE AND NOT IN A COMPONENT: a server
 * component renders once per request, so reading the time during its render
 * is sound, but `react-hooks/purity` cannot tell a server component from a
 * client one and flags the bare `Date.now()`/`performance.now()` — and an
 * instrument belongs in `src/lib` in any case, where it can be tested.
 */
export function stopwatch(): { startedAt: number; ms: () => number } {
  const startedAt = Date.now()
  const start = performance.now()
  return { startedAt, ms: () => Math.round(performance.now() - start) }
}

/** Run `fn` and report how long it waited, in whole milliseconds. */
export async function timed<T>(
  fn: () => Promise<T>,
): Promise<{ value: T; ms: number }> {
  const start = performance.now()
  const value = await fn()
  return { value, ms: Math.round(performance.now() - start) }
}

// ── THE ISOLATE, FOR "FIRST REQUEST AFTER IDLE" ───────────────────────────
//
// Module state lives as long as the isolate. The shell counts its own renders
// the way the sign-in counts its attempts (`signin-timing.ts`), so a GET on a
// fresh isolate is told apart from one on a warm isolate that sat idle.

let shellRenders = 0
let lastShellAt: number | null = null

export function shellIsolateMark(now: number = Date.now()): {
  isolateRenders: number
  isolateIdleMs: number | null
} {
  shellRenders += 1
  const idle = lastShellAt === null ? null : now - lastShellAt
  lastShellAt = now
  return { isolateRenders: shellRenders, isolateIdleMs: idle }
}

/** The shell layout's spans: the three reads every page pays before its own. */
export interface ShellSpans {
  /** `getSession()` — the session row by token hash; the request's first query. */
  sessionMs: number | null
  /** The viewer's own name, through the own-account handle. */
  accountMs: number | null
  /** The density preference, in its own tenant transaction (or skipped). */
  densityMs: number | null
  /** The layout from its first line to its last await. */
  totalMs: number | null
}

export function shellTimingLine(input: {
  role: string | null
  spans: ShellSpans
  isolate: { isolateRenders: number; isolateIdleMs: number | null }
  startedAt: number
}): string {
  const { spans } = input
  return JSON.stringify({
    event: 'shell.timing',
    role: input.role,
    sessionMs: spans.sessionMs,
    accountMs: spans.accountMs,
    densityMs: spans.densityMs,
    totalMs: spans.totalMs,
    sinceModuleEvalMs: input.startedAt - MODULE_LOADED_AT,
    isolateRenders: input.isolate.isolateRenders,
    isolateIdleMs: input.isolate.isolateIdleMs,
    startedAt: new Date(input.startedAt).toISOString(),
  })
}

/** The dashboard's seven parallel reads, by the name each has on the page. */
export const DASHBOARD_READS = [
  'money',
  'queue',
  'panels',
  'topDrivers',
  'dqf',
  'horizons',
  'companies',
] as const

export type DashboardRead = (typeof DASHBOARD_READS)[number]

export function dashboardTimingLine(input: {
  role: string | null
  /** A read the role is not shown is `null`, not 0: it did not run. */
  reads: Record<DashboardRead, number | null>
  /** The `Promise.all` from first to last settled — the page's wait. */
  fanOutMs: number
  /** The page from its first line to the end of the fan-out. */
  totalMs: number
  startedAt: number
}): string {
  return JSON.stringify({
    event: 'dashboard.timing',
    role: input.role,
    ...Object.fromEntries(
      DASHBOARD_READS.map((name) => [`${name}Ms`, input.reads[name]]),
    ),
    fanOutMs: input.fanOutMs,
    totalMs: input.totalMs,
    startedAt: new Date(input.startedAt).toISOString(),
  })
}
