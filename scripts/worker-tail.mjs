import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// THE WORKER'S OWN ACCOUNT OF A REQUEST, BY ITS RAY.
//
// Owner's ruling, 2026-10-11 (TMS-DESIGN-SYSTEM.md §6.8): a 500 on a sweep is
// recorded with the Worker's log for that request, because "transient" is
// only a finding once we can see what it was. On that day a dispatcher's
// `/loads` answered 500 once, four direct requests answered 200, and the
// re-run was clean — and there was nothing to say about the 500 itself.
//
// ── WHY `wrangler tail` AND NOT THE LOGS API ─────────────────────────────
//
// Workers Logs has a query API, and it answered 403: the token `wrangler
// login` stores carries `workers_tail (read)` and no observability scope.
// Tail needs nothing new and sees every invocation while it runs, so the
// sweep runs one for its whole length and keeps the events by ray. A 500
// whose ray never arrives is RECORDED AS SUCH, with the reason, never dropped.
//
// ── WHAT IS KEPT ─────────────────────────────────────────────────────────
//
// The outcome, the status, the exceptions and the log lines. NOT the request
// headers — a tail event carries the session cookie, and this goes into a
// file on disk.
// ---------------------------------------------------------------------------

/**
 * Split a stream of pretty-printed JSON objects into whole objects and the
 * unfinished remainder. Braces inside strings do not count, and an escaped
 * quote does not end one — a log line is arbitrary text.
 */
export function takeJsonObjects(buffer) {
  const objects = []
  let depth = 0
  let inString = false
  let escaped = false
  let start = -1
  let consumed = 0
  for (let i = 0; i < buffer.length; i++) {
    const ch = buffer[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}' && depth > 0) {
      depth--
      if (depth === 0) {
        try {
          objects.push(JSON.parse(buffer.slice(start, i + 1)))
        } catch {
          // Not an event (a banner with a brace in it); skip it.
        }
        consumed = i + 1
      }
    }
  }
  return { objects, rest: buffer.slice(depth === 0 ? buffer.length : consumed) }
}

/**
 * The ray without its colo: the response header says `a4904f48bc301f5c-DYU`,
 * the tail event's request header says `a4904f48bc301f5c`.
 */
export const rayKey = (ray) => (ray ? String(ray).split('-')[0] : null)

/** The ray a tail event belongs to, or null. */
export const rayOf = (event) =>
  rayKey(event?.event?.request?.headers?.['cf-ray'] ?? null)

/** What of a tail event goes on disk: never the headers. */
export const trimEvent = (event) => ({
  outcome: event?.outcome ?? null,
  status: event?.event?.response?.status ?? null,
  // The invocation's own clock and CPU, from the runtime rather than from
  // code: the cross-check for a span measured inside it (GAPS 24).
  wallTime: event?.wallTime ?? null,
  cpuTime: event?.cpuTime ?? null,
  at: event?.eventTimestamp
    ? new Date(event.eventTimestamp).toISOString()
    : null,
  exceptions: (event?.exceptions ?? []).map((entry) => ({
    name: entry?.name ?? null,
    message: entry?.message ?? null,
  })),
  logs: (event?.logs ?? []).map((entry) => ({
    level: entry?.level ?? null,
    message: Array.isArray(entry?.message)
      ? entry.message.map((part) => String(part)).join(' ')
      : String(entry?.message ?? ''),
  })),
})

/** Whether a tail event is a sign-in: the login form's server action. */
export const isSignInPost = (event) => {
  const request = event?.event?.request
  if (request?.method !== 'POST' || !request.url) return false
  return new URL(request.url).pathname === '/login'
}

/**
 * Every structured timing line an invocation wrote — `signin.timing`,
 * `shell.timing`, `dashboard.timing` (src/lib/signin-timing.ts,
 * src/lib/request-timing.ts) — parsed, in the order written. A sign-in POST
 * writes all three, because it renders the dashboard in its own response
 * (§6.10); a request that never got that far writes none.
 */
export function timingLinesOf(event) {
  const found = []
  for (const entry of event?.logs ?? []) {
    const parts = Array.isArray(entry?.message)
      ? entry.message
      : [entry?.message]
    for (const part of parts) {
      if (typeof part !== 'string' || !part.includes('.timing"')) continue
      try {
        const line = JSON.parse(part)
        if (typeof line?.event === 'string' && line.event.endsWith('.timing'))
          found.push(line)
      } catch {
        // A line that only mentions the name is not the line.
      }
    }
  }
  return found
}

/** The `signin.timing` line a sign-in wrote, or null. */
export const signInTimingOf = (event) =>
  timingLinesOf(event).find((line) => line.event === 'signin.timing') ?? null

// ── READINESS (owner's ruling, 2026-10-12) ────────────────────────────────
//
// On the first of three sweeps the canary never came back through the tail
// inside 60 s, the sweep went on without a worker log, and six sign-ins were
// recorded with nothing beside them. So: a 120 s window, a canary every 10 s,
// and a sweep that REFUSES to start without the tail rather than sweeping
// blind. The constants are pinned in tests/worker-tail.test.ts.

/** How long the sweep waits for the tail to prove it sees requests. */
export const READY_WINDOW_MS = 120_000
/** How long each canary is given before the next one is sent. */
export const CANARY_EVERY_MS = 10_000

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The worker a `*.workers.dev` origin is served by, or null for anything else
 * (localhost has no tail to read).
 */
export function workerNameFor(base) {
  const host = new URL(base).hostname
  return host.endsWith('.workers.dev') ? host.split('.')[0] : null
}

/**
 * Start `wrangler tail <worker> --format json` and keep its events by ray.
 * Never throws: a tail that cannot start reports why through `failure()`, and
 * every lookup then says so.
 */
export function startTail(worker) {
  const events = new Map()
  let failure = worker ? null : 'no worker to tail for this origin'
  let stderr = ''
  let buffer = ''
  let child = null
  if (worker) {
    const wrangler = fileURLToPath(
      new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url),
    )
    child = spawn(
      process.execPath,
      [wrangler, 'tail', worker, '--format', 'json'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      const { objects, rest } = takeJsonObjects(buffer + chunk)
      buffer = rest
      for (const event of objects) {
        const ray = rayOf(event)
        if (ray) events.set(ray, event)
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-2000)
    })
    child.on('error', (error) => {
      failure = `wrangler tail could not start: ${error.message}`
    })
    child.on('exit', (code) => {
      if (!failure && code !== null && code !== 0) {
        const line = stderr
          .replace(/\x1b\[[0-9;]*m/g, '')
          .split('\n')
          .map((part) => part.trim())
          .filter(Boolean)
          .pop()
        failure = `wrangler tail exited ${code}${line ? `: ${line}` : ''}`
      }
    })
  }
  return {
    failure: () => failure,
    /**
     * Prove the tail sees requests before the sweep makes any: request
     * `canaryUrl` until its own ray comes back through the tail. With
     * `--format json` wrangler prints no "connected" banner, so a request
     * seen is the only evidence there is. Past `ms` the sweep goes on, and a
     * 500 whose ray never arrived is recorded as such.
     */
    async ready(canaryUrl, ms = READY_WINDOW_MS) {
      const deadline = Date.now() + ms
      while (Date.now() < deadline && !failure) {
        const response = await fetch(canaryUrl).catch(() => null)
        const ray = response?.headers.get('cf-ray')
        await response?.arrayBuffer().catch(() => null)
        const until = Math.min(Date.now() + CANARY_EVERY_MS, deadline)
        while (ray && Date.now() < until && !failure) {
          if (events.has(rayKey(ray))) return true
          await sleep(500)
        }
        // A canary that got no answer at all still waits its turn out.
        if (!ray)
          await sleep(Math.max(0, Math.min(until, deadline) - Date.now()))
      }
      return false
    },
    lookup: (ray) => events.get(rayKey(ray)) ?? null,
    /** Every event seen so far, for a request whose ray never came back. */
    all: () => [...events.values()],
    /** Wait until every ray has an event, the tail has failed, or `ms` passes. */
    async waitFor(rays, ms) {
      const deadline = Date.now() + ms
      while (Date.now() < deadline && !failure) {
        if (rays.every((ray) => events.has(rayKey(ray)))) return
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    },
    stop() {
      child?.kill()
    },
  }
}
