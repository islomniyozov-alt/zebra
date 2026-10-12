// ---------------------------------------------------------------------------
// PRODUCTION'S FIRST QUERY, CHECKED — NOT ASSUMED (TMS-DESIGN-SYSTEM.md §6.8,
// owner's ruling 2026-10-12, closing GAPS 24).
//
//   node -r dotenv/config scripts/prod-signin-check.mjs
//   node -r dotenv/config scripts/prod-signin-check.mjs https://zebra.tajikcargollc.workers.dev
//
// GAPS 24 was Neon's scale-to-zero: the first request after idle paid the
// compute's cold start, and a sign-in stalled past 90 s. Production is now
// always awake and MUST NEVER have scale-to-zero re-enabled. This is the
// check that would notice if it were: it signs in to production ONCE, as the
// Live Check account, reads the sign-in's first-query span — `rateLimitMs`
// in the `signin.timing` line, the socket open plus the rate-limit read —
// from production's own Worker log through `wrangler tail`, and FAILS at
// 3 s. Warm, the span is under 2 s; a cold start shows as 5 s or more.
//
// ── WHAT IT WRITES, AND WHAT IT NEVER DOES ───────────────────────────────
//
// One `Session` row and one `LoginAttempt` row on production, as any sign-in
// does and as `live-check.mjs` already does. The password comes ONLY from
// `PROD_CHECK_*` (scripts/check-credentials.mjs): production never falls back
// to the owner's. Without those credentials this reports NOT OK by name — a
// check that cannot run is not a check that passed (GAPS 8).
//
// The verdict is the exit code, under `scripts/run-status.mjs`; the record
// (span, ray, the Worker's wall and CPU) goes to `RUN_STATUS_DETAIL`.
// ---------------------------------------------------------------------------

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { chromium } from 'playwright'
import { credentialsFor } from './check-credentials.mjs'
import {
  isSignInPost,
  signInTimingOf,
  startTail,
  trimEvent,
  workerNameFor,
} from './worker-tail.mjs'

/** The span a cold start cannot hide under: fail at this, in milliseconds. */
export const PROD_FIRST_QUERY_BUDGET_MS = 3_000

export const PRODUCTION_BASE = 'https://zebra.tajikcargollc.workers.dev'

/** The verdict over a sign-in's timing line, as words the summary prints. */
export function verdictFor(timing, budgetMs = PROD_FIRST_QUERY_BUDGET_MS) {
  if (!timing) return { ok: false, reason: 'no signin.timing line in the tail' }
  if (typeof timing.rateLimitMs !== 'number')
    return { ok: false, reason: 'the timing line carries no rateLimitMs' }
  if (timing.rateLimitMs > budgetMs)
    return {
      ok: false,
      reason: `first query took ${timing.rateLimitMs} ms, budget ${budgetMs} ms — a cold start, or a database that is not awake`,
    }
  return { ok: true, reason: `first query ${timing.rateLimitMs} ms` }
}

async function main() {
  const base = process.argv[2] ?? PRODUCTION_BASE
  const detailPath =
    process.env.RUN_STATUS_DETAIL ??
    join('.run-status', 'prod-signin-check.json')
  const record = { base, startedAt: new Date().toISOString() }
  const finish = (ok, reason) => {
    record.ok = ok
    record.reason = reason
    mkdirSync(dirname(detailPath), { recursive: true })
    writeFileSync(detailPath, JSON.stringify(record, null, 2))
    console.log(
      ok
        ? `PRODUCTION SIGN-IN FIRST QUERY — OK. ${reason}.`
        : `PRODUCTION SIGN-IN FIRST QUERY — NOT OK. ${reason}.`,
    )
    return ok ? 0 : 1
  }

  const credentials = credentialsFor(base)
  if (!credentials.ok) return finish(false, credentials.reason.split('\n')[0])

  const worker = workerNameFor(base)
  if (!worker) return finish(false, `${base} is not a workers.dev origin`)
  const tail = startTail(worker)
  process.on('exit', () => tail.stop())
  if (!(await tail.ready(new URL('/login', base))))
    return finish(
      false,
      `worker log not available: ${tail.failure() ?? 'the canary never came back through the tail'}`,
    )

  const browser = await chromium.launch(
    process.env.SHOT_CHROME ? { executablePath: process.env.SHOT_CHROME } : {},
  )
  let ray = null
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    // THE RAY AND STATUS AT `response`, SYNCHRONOUSLY: for a 303 the later
    // `requestfinished` is not reliably delivered before the navigation moves
    // on (2026-10-12: two runs, one with the POST recorded, one without). The
    // browser's timing still comes from `requestfinished`, when it arrives.
    page.on('response', (response) => {
      const request = response.request()
      if (
        request.method() === 'POST' &&
        new URL(request.url()).pathname === '/login'
      ) {
        ray = response.headers()['cf-ray'] ?? null
        record.post = {
          ...(record.post ?? {}),
          status: response.status(),
          ray,
        }
      }
    })
    page.on('requestfinished', (request) => {
      void (async () => {
        const response = await request.response()
        if (
          response &&
          request.method() === 'POST' &&
          new URL(request.url()).pathname === '/login'
        ) {
          const timing = request.timing()
          record.post = {
            ...(record.post ?? {}),
            status: response.status(),
            ray: (ray ??= response.headers()['cf-ray'] ?? null),
            // A 303 has no body, so no `responseEnd`; its headers' arrival is
            // the duration then, and the field says which was read.
            browserMs:
              timing.responseEnd >= 0
                ? Math.round(timing.responseEnd)
                : timing.responseStart >= 0
                  ? Math.round(timing.responseStart)
                  : null,
            browserMsKind:
              timing.responseEnd >= 0
                ? 'responseEnd'
                : timing.responseStart >= 0
                  ? 'responseStart'
                  : null,
          }
        }
      })().catch(() => {})
    })
    await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' })
    await page.fill('input[name="email"]', credentials.email)
    await page.fill('input[name="password"]', credentials.password)
    const clickedAt = Date.now()
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith('/login'), {
        timeout: 90_000,
      }),
      page.click('button[type="submit"]'),
    ])
    record.signedInAt = new Date().toISOString()
    record.windowFrom = clickedAt - 2_000
    // LET THE REDIRECT TARGET LOAD before the context goes: the
    // `requestfinished` handler above is asynchronous, and closing here lost
    // the POST's record on 2026-10-12 (no ray, no tail match). Bounded.
    await page.waitForLoadState('load', { timeout: 60_000 }).catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 500))
    await context.close()
  } catch (error) {
    record.error = String(error?.message ?? error).split('\n')[0]
    await browser.close()
    return finish(false, `sign-in did not complete: ${record.error}`)
  }
  await browser.close()

  // By ray when the browser recorded one; otherwise the one sign-in POST the
  // tail saw inside this attempt's window — the sweep's own fallback. The
  // tail delivers a few seconds after the response, so it is waited for.
  if (ray) await tail.waitFor([ray], 30_000)
  else await new Promise((resolve) => setTimeout(resolve, 15_000))
  const windowTo = Date.now()
  const event = ray
    ? tail.lookup(ray)
    : (tail
        .all()
        .filter(
          (candidate) =>
            isSignInPost(candidate) &&
            candidate.eventTimestamp >= record.windowFrom &&
            candidate.eventTimestamp <= windowTo,
        )
        .at(-1) ?? null)
  tail.stop()
  const timing = event ? signInTimingOf(event) : null
  record.worker = event ? { ...trimEvent(event), timing } : null
  record.matchedBy = event ? (ray ? 'ray' : 'window') : null
  if (!event)
    record.workerNote = ray
      ? 'no tail event for this ray within 30 s'
      : 'no sign-in POST in the tail inside this attempt'
  const verdict = verdictFor(timing)
  return finish(verdict.ok, verdict.reason)
}

// Importable for the unit test, runnable as a script.
if (
  process.argv[1]?.endsWith(`scripts${sep}prod-signin-check.mjs`) ||
  process.argv[1]?.endsWith('scripts/prod-signin-check.mjs')
) {
  process.exit(await main())
}
