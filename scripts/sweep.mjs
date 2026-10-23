// ---------------------------------------------------------------------------
// EVERY PAGE, FETCHED, WITH AND WITHOUT A SESSION.
//
//   node -r dotenv/config scripts/sweep.mjs              # deployed dev
//   VERIFY_BASE=http://localhost:3000 node -r dotenv/config scripts/sweep.mjs
//
// ── WHY THIS EXISTS ───────────────────────────────────────────────────────
//
// On 2026-10-04 three screens were returning 500 in production and had been for
// weeks: `/trucks` for every organization, `/loads` for every carrier with more
// than one authority, and `/payroll/batches` for every user. Nothing in this
// repository was watching. `npm run check` was green throughout — it type-checks
// and unit-tests and never renders a page. `scripts/live-check.mjs` caught two of
// the three, because it happens to GET six app routes with a session; the third
// is on a screen its list does not name, and it was found by hand.
//
// A hand-written list of six routes is what let the third one live. So this
// enumerates from the FILESYSTEM — every `page.tsx` under `src/app` — and the
// only way to leave a page out of the sweep is to delete the page.
//
// ── IT ASKS TWO QUESTIONS OF EVERY PAGE ───────────────────────────────────
//
//   WITH A SESSION:    does it answer without a server error?
//   WITHOUT ONE:       does it refuse, rather than render?
//
// The second half is nearly free — a redirect costs no database work — and it
// covers the worse class: a screen that forgets to ask who is looking. The live
// check asks that of six routes; this asks it of all of them.
//
// ── A 200 IS NOT PROOF, SO THE BODY IS READ TOO ───────────────────────────
//
// Next can answer 200 while rendering an error boundary — `src/app/error.tsx` is
// exactly that page, and a sweep that trusted the status line would report a
// screen showing "Something went wrong" as healthy. Each body is checked for the
// boundary's own words.
//
// ── AND IT NEVER SKIPS SILENTLY ───────────────────────────────────────────
//
// A dynamic route needs a real id. An id that cannot be resolved is counted and
// named as UNRESOLVED, and UNRESOLVED makes the verdict NOT OK — because "we did
// not look" and "we looked and it was fine" are the two readings this whole file
// exists to keep apart.
// ---------------------------------------------------------------------------

import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { neonConfig, Pool } from '@neondatabase/serverless'
import {
  rayOf,
  isSignInPost,
  READY_WINDOW_MS,
  signInTimingOf,
  startTail,
  timingLinesOf,
  trimEvent,
  workerNameFor,
} from './worker-tail.mjs'

const BASE =
  process.env.VERIFY_BASE ?? 'https://zebra-dev.tajikcargollc.workers.dev'

neonConfig.webSocketConstructor ??= WebSocket
neonConfig.poolQueryViaFetch = false

/**
 * The words `src/app/error.tsx` renders. A 200 carrying these is a failure.
 *
 * READ OFF THAT FILE, not invented: `tests/sweep.test.ts` asserts the string is
 * still in it, because a reworded error page would otherwise turn this check off
 * silently and leave the sweep reporting every broken screen as healthy.
 */
const BOUNDARY_WORDS = ['Something went wrong on our side']

// ── THE ROUTES, FROM THE FILESYSTEM ────────────────────────────────────────

/**
 * Every `page.tsx` under `src/app`, as the URL path it serves.
 *
 * Route groups — `(app)`, `(auth)` — are organisational and contribute nothing
 * to the path, which is the one rule a hand-written list gets wrong first.
 */
export function routesUnder(root) {
  const found = []
  const walk = (dir, segments) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const grouped = /^\(.*\)$/.test(entry.name)
        walk(
          join(dir, entry.name),
          grouped ? segments : [...segments, entry.name],
        )
      } else if (entry.name === 'page.tsx') {
        found.push(`/${segments.join('/')}`)
      }
    }
  }
  walk(root, [])
  return [...new Set(found)].sort()
}

/** `[id]` and `[token]`, which need a real value before anything can be fetched. */
const isDynamic = (route) => /\[[^\]]+\]/.test(route)

// ── THE IDS, SCOPED TO THE OWNER'S OWN ORGANIZATION ────────────────────────
//
// THE SCOPE IS THE POINT. This connection is the branch owner, so RLS does not
// apply to it and an unscoped `limit 1` can hand back a row belonging to the
// isolation counterpart — whose page correctly 404s for the signed-in owner. A
// sweep that did that would report a working tenant boundary as a broken screen,
// and the obvious "fix" would be to weaken the boundary.
const ID_SOURCES = [
  ['/brokers/[id]', 'Customer'],
  ['/companies/[id]', 'Company'],
  ['/drivers/[id]', 'Driver'],
  ['/invoices/[id]', 'Invoice'],
  ['/loads/[id]', 'Load'],
  ['/payments/[id]', 'Payment'],
  ['/safety/claims/[id]', 'Claim'],
  ['/safety/inspections/[id]', 'RoadsideInspection'],
  ['/settlements/[id]', 'Settlement'],
  ['/settlements/batches/[id]', 'SettlementBatch'],
  ['/trailers/[id]', 'Trailer'],
  ['/trucks/[id]', 'Truck'],
]

/**
 * A deliberately invalid reset token.
 *
 * NOT A REAL ONE, ON PURPOSE: a real token is single-use and spending it here
 * would break the next person's password reset. The page's job with a bad token
 * is to say so in words, which is a 200 — and a 500 here is the bug this sweep
 * is for.
 */
const BAD_TOKEN = 'sweep-not-a-real-token'

async function resolveIds(pool) {
  const resolved = new Map()
  const failed = []

  const { rows: who } = await pool.query(
    `select m."organizationId" from "Membership" m
       join "User" u on u.id = m."userId"
      where u.email = $1 limit 1`,
    [process.env.SEED_OWNER_EMAIL],
  )
  const organizationId = who[0]?.organizationId
  if (!organizationId) {
    return {
      resolved,
      failed: ID_SOURCES.map(([route]) => `${route} (no owner org)`),
    }
  }

  for (const [route, model] of ID_SOURCES) {
    try {
      const { rows } = await pool.query(
        `select id from "${model}" where "organizationId" = $1 limit 1`,
        [organizationId],
      )
      if (rows[0]) resolved.set(route, rows[0].id)
      else failed.push(`${route} (no ${model} row in this organization)`)
    } catch (error) {
      failed.push(`${route} (${model}: ${String(error.message).slice(0, 60)})`)
    }
  }
  return { resolved, failed, organizationId }
}

// ── THE FETCHES ────────────────────────────────────────────────────────────

/**
 * What a response means. Four answers, and only two of them are faults.
 *
 * A REDIRECT IS NOT A FAULT AND NOT A PASS. `/loads/import` sends you to its
 * first tab and `/login` sends a signed-in owner to the dashboard; both are
 * correct, and neither is evidence that a page rendered. They are counted
 * separately rather than folded into either column, because the first draft of
 * this printed "55 answered, 2 did not" directly above "0 PROBLEMS" and made the
 * reader choose which line to believe.
 */
/**
 * The label at the start of a row, and it agrees with the verdict.
 *
 * A REDIRECT PRINTED AS "FAIL" until 2026-10-10: the label said FAIL for
 * anything that was not `ok`, while the classifier and the summary counted a
 * redirect as neither a fault nor a pass. The night's sweep printed two FAIL
 * rows directly above "0 PROBLEMS" — the exact contradiction the redirect
 * rule below was written to remove, surviving one line further down.
 */
export const markFor = (verdict) =>
  verdict === 'ok' ? 'ok   ' : verdict === 'redirect' ? 'redir' : 'FAIL '

export const classify = (status, body) => {
  if (status >= 500) return 'SERVER ERROR'
  if (BOUNDARY_WORDS.some((words) => body.includes(words)))
    return 'ERROR BOUNDARY'
  if (status >= 400) return `CLIENT ERROR ${status}`
  if (status >= 300) return 'redirect'
  return 'ok'
}

// ── THE ROUTE MATRIX (TMS-DESIGN-SYSTEM.md §6.8, 2026-10-10) ──────────────

// ── A SERVER ERROR IS EVIDENCE (§6.8, owner's ruling 2026-10-11) ──────────

/** How much of a failing page's body goes into the record. */
export const BODY_BYTES = 2048

/** The verdicts that are the server's failure, whatever the status line says. */
export const isServerError = (verdict) =>
  verdict === 'SERVER ERROR' || verdict === 'ERROR BOUNDARY'

/**
 * One server error as the verdict file keeps it: who asked, for what, the ray
 * that names the request, and the start of what came back. The Worker's log
 * is attached later, once the tail has had time to deliver it.
 */
export const serverErrorRecord = ({
  role,
  route,
  path,
  status,
  verdict,
  ray,
  body,
}) => ({
  role,
  route,
  path,
  status,
  verdict,
  ray: ray ?? null,
  body: String(body ?? '').slice(0, BODY_BYTES),
})

/**
 * Where the records go: the file `scripts/run-status.mjs` hands its command
 * and folds into the verdict, or a fixed one when the sweep runs bare.
 */
export const detailPath = (env) =>
  env.RUN_STATUS_DETAIL ?? join('.run-status', 'sweep-server-errors.json')

/** Tries per role before a stalled sign-in fails the sweep: one retry, no more. */
export const SIGN_IN_ATTEMPTS = 2

/**
 * Rays matched by more than one sign-in attempt, each with the attempts that
 * claimed it. Empty is the only acceptable answer (§6.10, 2026-10-13).
 */
export function duplicateMatches(rows) {
  const claims = new Map()
  for (const row of rows)
    for (const ray of new Set(row.matchedRays ?? []))
      claims.set(ray, [...(claims.get(ray) ?? []), row])
  return new Map([...claims].filter(([, claimants]) => claimants.length > 1))
}

// ── THE WARM-UP (§6.8, owner's ruling 2026-10-12, closing GAPS 24) ─────────
//
// Dev keeps Neon's scale-to-zero by choice, so the first thing to touch the
// database after idle pays the compute's cold start — which is what a
// sign-in stalling past 90 s and a one-row read taking 6.7 s to start a
// transaction both were. The sweep measures the application, so it wakes
// the compute FIRST and records what that cost, separately: one direct
// `SELECT 1` (the wake-up itself) and one `GET /login` answered 200 (the
// Worker, awake and answering). Before `resolveIds`, whose own connection
// would otherwise be the wake-up nobody measured.

/** How long dev is given to answer 200 on /login before the sweep refuses. */
export const WARM_UP_WINDOW_MS = 120_000

// ── THE HYPERDRIVE CONFIG (§6.10, corrected 2026-10-23) ───────────────────

/** The id wrangler.jsonc binds as HYPERDRIVE at the top level, or null. */
export function boundHyperdriveId(jsonc) {
  const stripped = jsonc
    .split('\n')
    .map((line) => (line.trimStart().startsWith('//') ? '' : line))
    .join('\n')
    .replace(/,(\s*[}\]])/g, '$1')
  const config = JSON.parse(stripped)
  const entry = (config.hyperdrive ?? []).find(
    (h) => h.binding === 'HYPERDRIVE',
  )
  return entry?.id ?? null
}

/**
 * The verdict over a `wrangler hyperdrive get` answer: the origin must be
 * `zebra_app` (the owner bypasses RLS) and caching must be disabled (a cached
 * read under RLS is a cross-tenant read). Pure, for the test.
 */
export function hyperdriveVerdict(id, config) {
  const originUser = config?.origin?.user ?? null
  const cachingDisabled = config?.caching?.disabled === true
  const reasons = []
  if (originUser !== 'zebra_app')
    reasons.push(`origin user is ${originUser ?? 'unknown'}, not zebra_app`)
  if (!cachingDisabled) reasons.push('query caching is not disabled')
  return {
    id,
    originUser,
    cachingDisabled,
    ok: reasons.length === 0,
    reason: reasons.join('; ') || null,
  }
}

/** Ask Cloudflare for the bound config; null when nothing is bound. */
async function hyperdriveReadBack() {
  const id = boundHyperdriveId(
    readFileSync(join(process.cwd(), 'wrangler.jsonc'), 'utf8'),
  )
  if (!id) return null
  const wrangler = fileURLToPath(
    new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url),
  )
  const result = spawnSync(
    process.execPath,
    [wrangler, 'hyperdrive', 'get', id],
    { encoding: 'utf8' },
  )
  const text = `${result.stdout}\n${result.stderr}`.replace(
    /\x1b\[[0-9;]*m/g,
    '',
  )
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) return hyperdriveVerdict(id, null) // no JSON: unknown origin, caching
  try {
    return hyperdriveVerdict(id, JSON.parse(text.slice(start, end + 1)))
  } catch {
    return hyperdriveVerdict(id, null)
  }
}

export async function warmUp(
  pool,
  base,
  { fetchImpl = fetch, windowMs = WARM_UP_WINDOW_MS, pauseMs = 5_000 } = {},
) {
  const at = new Date().toISOString()
  const directStart = Date.now()
  await pool.query('SELECT 1')
  const directMs = Date.now() - directStart

  const deadline = Date.now() + windowMs
  let loginStatus = null
  let loginMs = null
  for (;;) {
    const loginStart = Date.now()
    const response = await fetchImpl(new URL('/login', base)).catch(() => null)
    await response?.arrayBuffer().catch(() => null)
    loginMs = Date.now() - loginStart
    loginStatus = response?.status ?? null
    if (loginStatus === 200) break
    if (Date.now() >= deadline) {
      console.error(
        `DEV DID NOT ANSWER 200 ON /login WITHIN ${windowMs / 1000} s (last answer ${loginStatus ?? 'none'}). Nothing swept. NOT OK.`,
      )
      process.exit(1)
    }
    await new Promise((resolve) => setTimeout(resolve, pauseMs))
  }
  return { at, directMs, loginMs, loginStatus }
}

/** The roles the sweep signs in as, and the matrix's column for each. */
/**
 * Every role in `enum Role`, each a column of §6.8 (extended 2026-10-10), and
 * the environment variables its seed account signs in with.
 */
export const MATRIX_ROLES = [
  'owner',
  'admin',
  'manager',
  'dispatcher',
  'accounting',
  'driver',
]

export const credentialsFor = (role, env) => ({
  email: env[`SEED_${role.toUpperCase()}_EMAIL`],
  password: env[`SEED_${role.toUpperCase()}_PASSWORD`],
})

/**
 * §6.8's table, read from the design system itself: the rows between the two
 * markers, as `route → { owner, admin, …, note }`.
 *
 * COLUMNS ARE FOUND BY THEIR HEADER, NOT THEIR POSITION. The table grew from
 * two roles to six on 2026-10-10; a parser that read cell 3 as the dispatcher
 * would have read the admin column instead and held the wrong role to it
 * without a word. A role with no column, or a header with no Note, throws.
 *
 * READ FROM THE DOC, NOT COPIED INTO THIS FILE, so the intent has one home and
 * a change to it is a change to the design system. Throws when the markers are
 * missing, because a sweep that silently checked nothing against an empty
 * matrix would read as a sweep that found nothing wrong.
 */
export function readRouteMatrix(markdown) {
  const start = markdown.indexOf('<!-- route-matrix:start -->')
  const end = markdown.indexOf('<!-- route-matrix:end -->')
  if (start < 0 || end < start) {
    throw new Error('TMS-DESIGN-SYSTEM.md has no §6.8 route matrix markers.')
  }
  const lines = markdown.slice(start, end).split('\n')
  const split = (line) => line.split('|').map((cell) => cell.trim())
  const header = lines.map(split).find((cells) => cells[1] === 'Route')
  if (!header) throw new Error('§6.8 route matrix has no header row.')
  const column = (name) => {
    const index = header.findIndex((cell) => cell.toLowerCase() === name)
    if (index < 0) throw new Error(`§6.8 route matrix has no "${name}" column.`)
    return index
  }
  const indices = Object.fromEntries(
    [...MATRIX_ROLES, 'note'].map((name) => [name, column(name)]),
  )
  const matrix = new Map()
  for (const line of lines) {
    const cells = split(line)
    const route = /^`(\/[^`]*)`$/.exec(cells[1] ?? '')?.[1]
    if (!route) continue
    matrix.set(
      route,
      Object.fromEntries(
        Object.entries(indices).map(([name, index]) => [
          name,
          cells[index] ?? '',
        ]),
      ),
    )
  }
  return matrix
}

/** What a verdict amounts to in the matrix's words. */
export const outcomeOf = (verdict) =>
  verdict === 'ok'
    ? 'reach'
    : verdict === 'redirect'
      ? 'redirect'
      : verdict.startsWith('CLIENT ERROR')
        ? 'refuse'
        : 'error'

/** The GAPS row a matrix note names, as `GAPS 12`, or null. */
export const knownGap = (note) => /\bGAPS \d+\b/.exec(note ?? '')?.[0] ?? null

/**
 * Every page whose answer disagrees with its matrix row, per role.
 *
 * A row with no matrix entry is itself a finding: a new page nobody decided
 * the roles for. A disagreement the row's note names as a GAPS row is KNOWN;
 * any other is NEW, and a NEW one makes the sweep NOT OK.
 */
export function matrixFindings(seen, matrix) {
  const findings = []
  for (const row of seen) {
    const expected = matrix.get(row.route)?.[row.role]
    if (expected === undefined) {
      findings.push({
        ...row,
        expected: '(no row)',
        got: outcomeOf(row.verdict),
        known: null,
      })
      continue
    }
    const got = outcomeOf(row.verdict)
    if (got !== expected) {
      findings.push({
        ...row,
        expected,
        got,
        known: knownGap(matrix.get(row.route).note),
      })
    }
  }
  return findings
}

/**
 * The verdict, as arithmetic over what was seen.
 *
 * SEPARATE FROM THE FETCHING so it can be tested without a worker, and so the
 * thing that decides OK from NOT OK is twelve lines somebody can read. A page
 * that was never reached counts as a problem: "we did not look" must never
 * arrive dressed as "we looked and it was fine".
 *
 * @param {{ authed: any[], anon: any[], unresolved: string[], findings?: any[] }} input
 */
export const tally = ({ authed, anon, unresolved, findings = [] }) => {
  const errors = authed.filter(
    (row) => row.verdict === 'SERVER ERROR' || row.verdict === 'ERROR BOUNDARY',
  )
  const clientErrors = authed.filter((row) =>
    row.verdict.startsWith('CLIENT ERROR'),
  )
  const redirects = authed.filter((row) => row.verdict === 'redirect')
  const unrefused = anon.filter((row) => !row.refused)
  // THE MATRIX'S NEW DISAGREEMENTS. An owner page that errored or refused is
  // already counted above, so it is not counted twice here.
  //
  // A SERVER ERROR IS NEVER KNOWN (§6.8: "a server error is never an
  // acceptable answer, in any column"). A GAPS reference may park a policy
  // disagreement while the owner rules; it may not park a 500.
  const isKnown = (row) => row.known !== null && row.got !== 'error'
  const known = findings.filter(isKnown)
  const fresh = findings.filter(
    (row) =>
      !isKnown(row) &&
      !(row.role === 'owner' && (row.got === 'error' || row.got === 'refuse')),
  )
  return {
    rendered:
      authed.length - errors.length - clientErrors.length - redirects.length,
    errors,
    clientErrors,
    redirects,
    unrefused,
    unresolved,
    known,
    fresh,
    problems:
      errors.length +
      clientErrors.length +
      unrefused.length +
      unresolved.length +
      fresh.length,
  }
}

async function sweep() {
  const routes = routesUnder(join(process.cwd(), 'src', 'app'))
  const pool = new Pool({
    connectionString: process.env.DIRECT_DATABASE_URL,
    max: 1,
  })
  // FIRST, before anything else reaches the database (see `warmUp`).
  // THE HYPERDRIVE CONFIG, READ BACK BEFORE ANYTHING ELSE (§6.10, corrected
  // 2026-10-23). The binding's string cannot say which role the origin uses
  // or whether query caching is off — only the config Cloudflare holds can —
  // so while wrangler.jsonc binds one, the sweep asks Cloudflare and refuses
  // to start unless the answer is `zebra_app` and `disabled: true`. A cached
  // read under RLS is a cross-tenant read; an owner origin bypasses RLS.
  const hyperdrive = await hyperdriveReadBack()
  if (hyperdrive && !hyperdrive.ok) {
    console.error(
      `HYPERDRIVE CONFIG REFUSED: ${hyperdrive.reason}. Nothing swept. NOT OK.`,
    )
    process.exit(1)
  }
  if (hyperdrive)
    console.log(
      `hyperdrive ${hyperdrive.id}: origin user ${hyperdrive.originUser}, caching disabled ${hyperdrive.cachingDisabled}`,
    )
  const coldStart = await warmUp(pool, BASE)
  console.log(
    `cold start: direct SELECT 1 ${coldStart.directMs} ms · GET /login ${coldStart.loginMs} ms (${coldStart.loginStatus})`,
  )
  const { resolved, failed, organizationId } = await resolveIds(pool)
  await pool.end()

  console.log(`sweeping ${routes.length} page(s) at ${BASE}`)
  console.log(
    `ids resolved inside organization ${organizationId ?? '(none)'}\n`,
  )

  // THE MATRIX, READ FROM THE DESIGN SYSTEM BEFORE ANY SIGN-IN (§6.8).
  const matrix = readRouteMatrix(
    readFileSync(join(process.cwd(), 'TMS-DESIGN-SYSTEM.md'), 'utf8'),
  )

  // THE COOKIES COME FROM REAL SIGN-INS, because the login is a server action
  // and its id is Next's business, not ours. `live-check.mjs` learned that the
  // hard way: a hand-built POST reported "credentials not set".
  //
  // EVERY ROLE SINCE 2026-10-10: the owner and one seed account per other
  // role (dev only, `prisma/seed.ts`). A role whose credentials are missing
  // FAILS the sweep rather than skipping it: a clean sweep of five roles says
  // nothing about the sixth, which is the gap this exists to close.
  // THE WORKER'S LOG, FOR THE LENGTH OF THE SWEEP — SIGN-INS INCLUDED. Started
  // before the first sign-in and proven with a canary, so a 500 below has a
  // log line to be matched against, and so does every sign-in, stalled or not
  // (scripts/worker-tail.mjs; GAPS 24 moved it ahead of the sign-ins).
  const worker = workerNameFor(BASE)
  const tail = startTail(worker)
  // On every way out, a throw included: an orphaned tail outlives the sweep.
  process.on('exit', () => tail.stop())
  // NO TAIL, NO SWEEP. Owner's ruling, 2026-10-12: a sweep that cannot see the
  // Worker's log records a stall or a 500 with nothing beside it, which is
  // what happened on the first of three sweeps. 120 s, a canary every 10 s
  // (worker-tail.mjs), then REFUSED. A localhost origin has no worker to tail
  // and sweeps without one, as before.
  const tailReady = worker ? await tail.ready(new URL('/login', BASE)) : false
  if (worker && !tailReady) {
    console.error(
      `WORKER LOG NOT AVAILABLE after ${READY_WINDOW_MS / 1000} s (${tail.failure() ?? 'the canary never came back through the tail'}). Nothing swept. NOT OK.`,
    )
    process.exit(1)
  }
  console.log(
    worker
      ? `worker log: tailing ${worker}`
      : 'worker log: none — not a workers.dev origin',
  )
  /** Every server error, for the verdict file. */
  const serverErrors = []
  /** Every sign-in attempt, stalled or not, for the verdict file (GAPS 24). */
  const signIns = []

  /**
   * Each attempt's Worker invocations: by the ray of its POST when one came
   * back, otherwise every sign-in POST the tail saw inside the attempt's
   * window — a stalled request has no response, so no ray, and its event
   * arrives whenever the Worker finishes with it.
   */
  const attachSignInLogs = async () => {
    if (!tailReady || signIns.length === 0) return
    await tail.waitFor(
      signIns.flatMap((row) => [row.ray, row.renderGet?.ray]).filter(Boolean),
      30_000,
    )
    for (const row of signIns) {
      const byRay = row.ray ? tail.lookup(row.ray) : null
      const from = Date.parse(row.startedAt) - 2_000
      const to = Date.parse(row.endedAt) + 2_000
      const events = byRay
        ? [byRay]
        : tail
            .all()
            .filter(
              (event) =>
                isSignInPost(event) &&
                event.eventTimestamp >= from &&
                event.eventTimestamp <= to,
            )
      row.worker = events.map((event) => ({
        ...trimEvent(event),
        timing: signInTimingOf(event),
      }))
      row.matchedRays = events.map(rayOf).filter(Boolean)
      if (events.length === 0)
        row.workerNote = row.ray
          ? 'no tail event for this ray within 30 s'
          : 'no sign-in POST in the tail inside this attempt'
      // THE DASHBOARD RENDER, ON ITS OWN REQUEST, BY ITS OWN RAY (§6.10,
      // owner's ruling 2026-10-23). The sign-in POST renders the dashboard
      // inside its own response, but nothing written during that render
      // reaches the tail — a known limitation, not chased. So after each
      // sign-in the sweep GETs /dashboard with the new session (`renderGet`
      // below) and reads `shell.timing` and `dashboard.timing` from THAT
      // invocation, matched by its ray and nothing else: no time window.
      const render = row.renderGet?.ray ? tail.lookup(row.renderGet.ray) : null
      const lines = render
        ? timingLinesOf(render).filter((line) => line.event !== 'signin.timing')
        : []
      row.render = row.renderGet
        ? {
            ...row.renderGet,
            wallTime: render?.wallTime ?? null,
            cpuTime: render?.cpuTime ?? null,
            outcome: render?.outcome ?? null,
            timings: lines,
          }
        : null
      if (render) row.matchedRays.push(rayOf(render))
      if (row.outcome === 'ok' && lines.length === 0)
        row.renderNote = !row.renderGet
          ? 'no dashboard GET was made after this sign-in'
          : render
            ? 'the dashboard GET carries no shell or dashboard line'
            : 'no tail event for the dashboard GET’s ray within 30 s'
    }
  }

  const writeDetail = () => {
    const detail = detailPath(process.env)
    mkdirSync(dirname(detail), { recursive: true })
    writeFileSync(
      detail,
      JSON.stringify(
        {
          base: BASE,
          tail: { worker, ready: tailReady, failure: tail.failure() },
          hyperdrive,
          coldStart,
          signIns,
          serverErrors,
        },
        null,
        2,
      ),
    )
    return detail
  }

  /** A GET with a session, timed to the body's end, its ray kept (§6.10). */
  const timedGet = async (path, cookie) => {
    const start = Date.now()
    try {
      const response = await fetch(new URL(path, BASE), {
        headers: { cookie },
        redirect: 'manual',
      })
      await response.arrayBuffer()
      return {
        path,
        status: response.status,
        ray: response.headers.get('cf-ray'),
        browserMs: Date.now() - start,
      }
    } catch (error) {
      return {
        path,
        status: null,
        ray: null,
        browserMs: Date.now() - start,
        error: String(error?.message ?? error).split('\n')[0],
      }
    }
  }

  const browser = await chromium.launch(
    process.env.SHOT_CHROME ? { executablePath: process.env.SHOT_CHROME } : {},
  )
  const signIn = async (email, password, label) => {
    if (!email || !password) {
      console.error(
        `NO ${label} CREDENTIALS (SEED_${label}_EMAIL / SEED_${label}_PASSWORD). Nothing swept. NOT OK.`,
      )
      process.exit(1)
    }
    // ONE RETRY PER ROLE, AND THE ROLE IS NAMED. Owner's brief, 2026-10-11:
    // two deployed sweeps stalled at sign-in with Playwright's bare timeout,
    // which said nothing about WHICH of six accounts stalled, and a re-run
    // was clean. A second stall is a failure, printed as one — a sweep that
    // retried until it got in would sweep a dev that cannot sign anybody in.
    let found = ''
    for (let attempt = 1; ; attempt++) {
      const context = await browser.newContext()
      const page = await context.newPage()
      // THE ATTEMPT, RECORDED WHETHER OR NOT IT STALLS (GAPS 24): when the
      // click went, when it ended, and the ray of the sign-in POST if the
      // Worker ever answered it.
      const row = {
        role: label.toLowerCase(),
        attempt,
        startedAt: null,
        endedAt: null,
        elapsedMs: null,
        outcome: null,
        ray: null,
        status: null,
        /** The POST as the browser timed it, request start to response end. */
        postMs: null,
        /** The GET the browser made after the 303 (GAPS 26). */
        redirect: null,
      }
      // THE RAY AND STATUS AT `response`, SYNCHRONOUSLY — for a 303 the later
      // `requestfinished` is not reliably delivered before the navigation
      // moves on (the production check lost its POST record that way on
      // 2026-10-12). The browser's timings still come from `requestfinished`,
      // which alone has a `responseEnd`.
      page.on('response', (response) => {
        const request = response.request()
        const path = new URL(request.url()).pathname
        if (request.method() === 'POST' && path === '/login') {
          row.ray = response.headers()['cf-ray'] ?? null
          row.status = response.status()
        } else if (
          request.method() === 'GET' &&
          request.isNavigationRequest() &&
          request.frame() === page.mainFrame() &&
          path !== '/login' &&
          row.redirect === null
        ) {
          row.redirect = {
            path,
            ray: response.headers()['cf-ray'] ?? null,
            status: response.status(),
            getMs: null,
            getMsKind: null,
          }
        }
      })
      page.on('requestfinished', (request) => {
        void (async () => {
          const response = await request.response()
          if (!response) return
          const path = new URL(request.url()).pathname
          const timing = request.timing()
          // A 303 carries no body, so Playwright gives it no `responseEnd`:
          // fall back to `responseStart`, the time to its headers, and say
          // which was read. (Found by the first GAPS 26 sweeps: 2 of 21.)
          const ms =
            timing.responseEnd >= 0
              ? Math.round(timing.responseEnd)
              : timing.responseStart >= 0
                ? Math.round(timing.responseStart)
                : null
          const msKind =
            timing.responseEnd >= 0
              ? 'responseEnd'
              : timing.responseStart >= 0
                ? 'responseStart'
                : null
          if (request.method() === 'POST' && path === '/login') {
            row.ray ??= response.headers()['cf-ray'] ?? null
            row.status ??= response.status()
            row.postMs = ms
            row.postMsKind = msKind
          } else if (
            request.method() === 'GET' &&
            request.isNavigationRequest() &&
            request.frame() === page.mainFrame() &&
            path !== '/login' &&
            (row.redirect === null || row.redirect.path === path)
          ) {
            row.redirect = {
              ...(row.redirect ?? {}),
              path,
              ray: row.redirect?.ray ?? response.headers()['cf-ray'] ?? null,
              status: row.redirect?.status ?? response.status(),
              getMs: ms,
              getMsKind: msKind,
            }
          }
        })().catch(() => {})
      })
      try {
        await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
        await page.fill('input[name="email"]', email)
        await page.fill('input[name="password"]', password)
        row.startedAt = new Date().toISOString()
        // ANYWHERE BUT THE LOGIN PAGE: where a role lands is its business,
        // and a driver has no dashboard to land on. A sign-in that stays on
        // /login is a refusal, and the timeout says so.
        await Promise.all([
          page.waitForURL((url) => !url.pathname.startsWith('/login'), {
            timeout: 90_000,
          }),
          page.click('button[type="submit"]'),
        ])
        row.endedAt = new Date().toISOString()
        row.elapsedMs = Date.parse(row.endedAt) - Date.parse(row.startedAt)
        row.outcome = 'ok'
        // LET THE REDIRECT TARGET FINISH (GAPS 26). The first three sweeps
        // closed the context here, the moment the URL changed, and the
        // dashboard document never reached `requestfinished`: zero GET
        // records. Its load is the measurement, so it is waited for — bounded,
        // and a page that never finishes loading is recorded without a GET,
        // not a sweep that stalls on it.
        await page.waitForLoadState('load', { timeout: 60_000 }).catch(() => {})
        // The `requestfinished` handler above is asynchronous; one tick for
        // its `request.response()` to resolve before the context goes.
        await new Promise((resolve) => setTimeout(resolve, 500))
        signIns.push(row)
        found = (await context.cookies())
          .filter((entry) => entry.name === 'zebra_session')
          .map((entry) => `${entry.name}=${entry.value}`)
          .join('; ')
        await context.close()
        // THE RENDER'S OWN REQUEST (§6.10, 2026-10-23): /dashboard with the
        // session just issued, timed from here, its ray kept so the tail can
        // be asked for exactly that invocation. A driver is refused the
        // dashboard (404) and still renders the shell, which is measured.
        if (found) row.renderGet = await timedGet('/dashboard', found)
        break
      } catch (error) {
        await context.close()
        const reason = String(error?.message ?? error).split('\n')[0]
        row.endedAt = new Date().toISOString()
        row.startedAt ??= row.endedAt
        row.elapsedMs = Date.parse(row.endedAt) - Date.parse(row.startedAt)
        row.outcome = 'stalled'
        row.reason = reason
        signIns.push(row)
        if (attempt >= SIGN_IN_ATTEMPTS) {
          console.error(
            `${label} SIGN-IN STALLED, ${attempt} of ${SIGN_IN_ATTEMPTS} attempts: ${reason}. NOT OK.`,
          )
          // The stall is the finding: its record goes in the verdict file
          // before the sweep stops.
          await attachSignInLogs()
          console.error(`sign-in record written to ${writeDetail()}`)
          process.exit(1)
        }
        console.error(
          `${label} sign-in stalled (attempt ${attempt} of ${SIGN_IN_ATTEMPTS}): ${reason} — retrying once.`,
        )
      }
    }
    if (!found) {
      console.error(`NO SESSION COOKIE AFTER ${label} SIGN-IN. NOT OK.`)
      process.exit(1)
    }
    return found
  }
  /** One session per role, the owner's first: it is also the classic sweep's. */
  const cookies = {}
  for (const role of MATRIX_ROLES) {
    const { email, password } = credentialsFor(role, process.env)
    cookies[role] = await signIn(email, password, role.toUpperCase())
  }
  const cookie = cookies.owner
  await browser.close()

  const get = async (path, headers) => {
    const response = await fetch(new URL(path, BASE), {
      headers,
      redirect: 'manual',
    })
    // A 5xx body is read too: it is half of what a server error is recorded
    // with, and the ray is the other half.
    const body =
      response.status < 300 || response.status >= 500
        ? await response.text()
        : ''
    return {
      status: response.status,
      body,
      to: response.headers.get('location'),
      ray: response.headers.get('cf-ray'),
    }
  }

  const authed = []
  const anon = []
  const unresolved = [...failed]
  /** Every protected page's answer per role, for the matrix. */
  const seen = []

  for (const route of routes) {
    let path = route
    if (isDynamic(route)) {
      const id = resolved.get(route)
      if (!id) {
        if (route.includes('[token]'))
          path = route.replace(/\[[^\]]+\]/, BAD_TOKEN)
        else continue // already named in `failed`
      } else {
        path = route.replace(/\[[^\]]+\]/, id)
      }
    }

    const withSession = await get(path, { cookie })
    const verdict = classify(withSession.status, withSession.body)
    authed.push({ route, path, status: withSession.status, verdict })
    if (isServerError(verdict))
      serverErrors.push(
        serverErrorRecord({
          role: 'owner',
          route,
          path,
          verdict,
          ...withSession,
        }),
      )
    console.log(
      `${markFor(verdict)} ${String(withSession.status).padEnd(3)} ${route.padEnd(34)} ${verdict === 'ok' ? '' : verdict}${withSession.to ? ` → ${withSession.to}` : ''}`,
    )

    // THE ANONYMOUS HALF. Auth pages are supposed to render to a stranger; every
    // other page must refuse. A 200 here is the worst finding this script can
    // make, so it is asserted rather than reported.
    if (
      !['/login', '/reset-password'].includes(route) &&
      !route.includes('[token]')
    ) {
      // THE MATRIX HALF (§6.8): the same page as every other role, and each
      // role's answer held to the design system's table.
      seen.push({ route, role: 'owner', status: withSession.status, verdict })
      for (const role of MATRIX_ROLES.filter((name) => name !== 'owner')) {
        const answer = await get(path, { cookie: cookies[role] })
        const verdict = classify(answer.status, answer.body)
        seen.push({ route, role, status: answer.status, verdict })
        if (isServerError(verdict))
          serverErrors.push(
            serverErrorRecord({ role, route, path, verdict, ...answer }),
          )
      }

      const without = await get(path, {})
      const refused = without.status >= 300 && without.status < 400
      anon.push({ route, status: without.status, refused })
      if (!refused) {
        console.log(
          `FAIL  ${without.status} ${route.padEnd(34)} ANONYMOUS CALLER WAS NOT REFUSED`,
        )
      }
    }
  }

  // ── EVERY SERVER ERROR, WITH THE WORKER'S ACCOUNT OF IT ──────────────────
  //
  // Written whether or not there were any, so a file from an earlier run can
  // never be read as this one's. Tail delivers an event a few seconds after
  // the response, so the rays are waited for — 30 s, then recorded as missing.
  if (serverErrors.length > 0 && tailReady)
    await tail.waitFor(
      serverErrors.map((row) => row.ray).filter(Boolean),
      30_000,
    )
  for (const row of serverErrors) {
    const event = row.ray ? tail.lookup(row.ray) : null
    row.worker = event ? trimEvent(event) : null
    if (!event)
      row.workerNote = !row.ray
        ? 'the response carried no cf-ray'
        : tailReady
          ? 'no tail event for this ray within 30 s'
          : `worker log not available: ${tail.failure() ?? 'the canary never came back through the tail'}`
  }
  // The sign-ins ran twenty minutes ago, so every one of their events has
  // arrived by now, a stalled request's included.
  await attachSignInLogs()
  tail.stop()
  const detail = writeDetail()
  const timed = signIns.filter((row) =>
    row.worker?.some((event) => event.timing),
  ).length
  console.log(
    `SIGN-INS: ${signIns.length} attempt(s), ${signIns.filter((row) => row.outcome === 'stalled').length} stalled, ${timed} with a timing line — recorded in ${detail}`,
  )
  if (serverErrors.length > 0) {
    console.log(`SERVER ERRORS, RECORDED IN ${detail}:`)
    for (const row of serverErrors) {
      console.log(
        `   ${row.role.padEnd(10)} ${row.route.padEnd(30)} ${row.status} ray ${row.ray ?? '(none)'}`,
      )
      const said = [
        ...(row.worker?.exceptions ?? []).map(
          (entry) => `${entry.name}: ${entry.message}`,
        ),
        ...(row.worker?.logs ?? [])
          .filter((entry) => entry.level === 'error')
          .map((entry) => entry.message),
      ]
      for (const line of said.slice(0, 3))
        console.log(`      worker: ${line.slice(0, 300)}`)
      if (row.workerNote) console.log(`      worker: ${row.workerNote}`)
    }
    console.log(
      '   A 500 ON A SWEEP IS A GAPS ROW, NOT A RE-RUN (§6.8, 2026-10-11).',
    )
  }

  // ── THE VERDICT, IN CAPITALS, WITH THE NUMBERS REPEATED ──────────────────
  const findings = matrixFindings(seen, matrix)
  // A matrix row that names no page is a decision about nothing, and hides
  // the page it was meant for.
  const protectedRoutes = new Set(seen.map((row) => row.route))
  for (const route of matrix.keys()) {
    if (!protectedRoutes.has(route))
      unresolved.push(`${route} (matrix row, no page)`)
  }
  const sums = tally({ authed, anon, unresolved, findings })

  console.log('\n' + '='.repeat(70))
  console.log(
    `SWEPT ${authed.length} of ${routes.length} page(s) WITH a session`,
  )
  console.log(
    `      ${sums.rendered} rendered, ${sums.redirects.length} redirected, ` +
      `${sums.clientErrors.length} refused, ${sums.errors.length} SERVER ERROR`,
  )
  console.log(
    `ANONYMOUS: ${anon.length} checked, ${sums.unrefused.length} NOT REFUSED`,
  )
  for (const row of sums.redirects) console.log(`   redirect: ${row.route}`)
  for (const row of sums.clientErrors)
    console.log(`   ${row.verdict}: ${row.route}`)
  for (const row of sums.errors) console.log(`   ${row.verdict}: ${row.route}`)
  for (const row of sums.unrefused) console.log(`   NOT REFUSED: ${row.route}`)
  console.log(
    `ROUTE MATRIX (§6.8): ${seen.length / MATRIX_ROLES.length} page(s) x ${MATRIX_ROLES.length} roles; ` +
      `${sums.fresh.length} NEW disagreement(s), ${sums.known.length} known`,
  )
  for (const role of MATRIX_ROLES) {
    const rows = seen.filter((row) => row.role === role)
    const count = (outcome) =>
      rows.filter((row) => outcomeOf(row.verdict) === outcome).length
    console.log(
      `   ${role.padEnd(10)} reached ${count('reach')}, refused ${count('refuse')}, redirected ${count('redirect')}, errored ${count('error')}`,
    )
  }
  for (const row of sums.fresh)
    console.log(
      `   NEW  ${row.role.padEnd(10)} ${row.route.padEnd(30)} matrix ${row.expected}, got ${row.got} (${row.status})`,
    )
  for (const row of sums.known)
    console.log(
      `   KNOWN ${row.known}: ${row.role} ${row.route} — matrix ${row.expected}, got ${row.got}`,
    )
  if (sums.unresolved.length > 0) {
    console.log(`UNRESOLVED (never fetched at all): ${sums.unresolved.length}`)
    for (const line of sums.unresolved) console.log(`   ${line}`)
  }

  // ONE INVOCATION, ONE SIGN-IN (§6.10, 2026-10-13). Two sign-ins matched to
  // the same invocation means a measurement attributed to the wrong role —
  // what the window matcher did — so it counts as a problem, by name.
  const shared = duplicateMatches(signIns)
  for (const [ray, rows] of shared)
    console.log(
      `   SHARED MATCH ${ray}: ${rows.map((row) => `${row.role}#${row.attempt}`).join(', ')}`,
    )
  sums.problems += shared.size

  if (sums.problems === 0) {
    console.log(`SWEEP CLEAN — OK. ${authed.length} PAGE(S), 0 PROBLEM(S).`)
    console.log('='.repeat(70))
    return 0
  }
  console.log(
    `SWEEP FOUND ${sums.problems} PROBLEM(S) — NOT OK. NOT OK COUNT: ${sums.problems}.`,
  )
  console.log('='.repeat(70))
  return 1
}

// Importable for the unit test, runnable as a script. `routesUnder` is the half
// worth testing without a network.
if (
  process.argv[1]?.endsWith(`scripts${sep}sweep.mjs`) ||
  process.argv[1]?.endsWith('scripts/sweep.mjs')
) {
  process.exit(await sweep())
}
