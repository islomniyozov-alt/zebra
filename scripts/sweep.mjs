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

import { readdirSync } from 'node:fs'
import { join, sep } from 'node:path'
import { chromium } from 'playwright'
import { neonConfig, Pool } from '@neondatabase/serverless'

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
export const classify = (status, body) => {
  if (status >= 500) return 'SERVER ERROR'
  if (BOUNDARY_WORDS.some((words) => body.includes(words)))
    return 'ERROR BOUNDARY'
  if (status >= 400) return `CLIENT ERROR ${status}`
  if (status >= 300) return 'redirect'
  return 'ok'
}

/**
 * The verdict, as arithmetic over what was seen.
 *
 * SEPARATE FROM THE FETCHING so it can be tested without a worker, and so the
 * thing that decides OK from NOT OK is twelve lines somebody can read. A page
 * that was never reached counts as a problem: "we did not look" must never
 * arrive dressed as "we looked and it was fine".
 */
export const tally = ({ authed, anon, unresolved }) => {
  const errors = authed.filter(
    (row) => row.verdict === 'SERVER ERROR' || row.verdict === 'ERROR BOUNDARY',
  )
  const clientErrors = authed.filter((row) =>
    row.verdict.startsWith('CLIENT ERROR'),
  )
  const redirects = authed.filter((row) => row.verdict === 'redirect')
  const unrefused = anon.filter((row) => !row.refused)
  return {
    rendered:
      authed.length - errors.length - clientErrors.length - redirects.length,
    errors,
    clientErrors,
    redirects,
    unrefused,
    unresolved,
    problems:
      errors.length +
      clientErrors.length +
      unrefused.length +
      unresolved.length,
  }
}

async function sweep() {
  const routes = routesUnder(join(process.cwd(), 'src', 'app'))
  const pool = new Pool({
    connectionString: process.env.DIRECT_DATABASE_URL,
    max: 1,
  })
  const { resolved, failed, organizationId } = await resolveIds(pool)
  await pool.end()

  console.log(`sweeping ${routes.length} page(s) at ${BASE}`)
  console.log(
    `ids resolved inside organization ${organizationId ?? '(none)'}\n`,
  )

  // THE COOKIE COMES FROM A REAL SIGN-IN, because the login is a server action
  // and its id is Next's business, not ours. `live-check.mjs` learned that the
  // hard way: a hand-built POST reported "credentials not set".
  const browser = await chromium.launch(
    process.env.SHOT_CHROME ? { executablePath: process.env.SHOT_CHROME } : {},
  )
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[name="email"]', process.env.SEED_OWNER_EMAIL)
  await page.fill('input[name="password"]', process.env.SEED_OWNER_PASSWORD)
  await Promise.all([
    page.waitForURL(/\/(loads|dashboard)/, { timeout: 90_000 }),
    page.click('button[type="submit"]'),
  ])
  const cookies = await context.cookies()
  await browser.close()

  const cookie = cookies
    .filter((entry) => entry.name === 'zebra_session')
    .map((entry) => `${entry.name}=${entry.value}`)
    .join('; ')
  if (!cookie) {
    console.error('NO SESSION COOKIE AFTER SIGN-IN. Nothing swept. NOT OK.')
    process.exit(1)
  }

  const get = async (path, headers) => {
    const response = await fetch(new URL(path, BASE), {
      headers,
      redirect: 'manual',
    })
    const body = response.status < 300 ? await response.text() : ''
    return {
      status: response.status,
      body,
      to: response.headers.get('location'),
    }
  }

  const authed = []
  const anon = []
  const unresolved = [...failed]

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
    const mark = verdict === 'ok' ? 'ok  ' : 'FAIL'
    console.log(
      `${mark}  ${String(withSession.status).padEnd(3)} ${route.padEnd(34)} ${verdict === 'ok' ? '' : verdict}${withSession.to ? ` → ${withSession.to}` : ''}`,
    )

    // THE ANONYMOUS HALF. Auth pages are supposed to render to a stranger; every
    // other page must refuse. A 200 here is the worst finding this script can
    // make, so it is asserted rather than reported.
    if (
      !['/login', '/reset-password'].includes(route) &&
      !route.includes('[token]')
    ) {
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

  // ── THE VERDICT, IN CAPITALS, WITH THE NUMBERS REPEATED ──────────────────
  const sums = tally({ authed, anon, unresolved })

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
  if (sums.unresolved.length > 0) {
    console.log(`UNRESOLVED (never fetched at all): ${sums.unresolved.length}`)
    for (const line of sums.unresolved) console.log(`   ${line}`)
  }

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
