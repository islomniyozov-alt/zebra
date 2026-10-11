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

import { readdirSync, readFileSync } from 'node:fs'
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
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
    await page.fill('input[name="email"]', email)
    await page.fill('input[name="password"]', password)
    // ANYWHERE BUT THE LOGIN PAGE: where a role lands is its business, and a
    // driver has no dashboard to land on. A sign-in that stays on /login is a
    // refusal, and the timeout says so.
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith('/login'), {
        timeout: 90_000,
      }),
      page.click('button[type="submit"]'),
    ])
    const found = (await context.cookies())
      .filter((entry) => entry.name === 'zebra_session')
      .map((entry) => `${entry.name}=${entry.value}`)
      .join('; ')
    await context.close()
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
        seen.push({
          route,
          role,
          status: answer.status,
          verdict: classify(answer.status, answer.body),
        })
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
