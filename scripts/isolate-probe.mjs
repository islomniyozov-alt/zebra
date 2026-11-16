#!/usr/bin/env node
// ---------------------------------------------------------------------------
// THE ISOLATE PROBE — the memory ceiling's own instrument (§6.10 v10.94;
// owner's ruling 2026-11-13 on GAPS 43; GAPS 44).
//
//   node scripts/isolate-probe.mjs [--role accounting] [--base <origin>]
//   node scripts/isolate-probe.mjs --role all
//
// `--role all` IS THE SWEEP'S OWN SEQUENCE ON ONE CLIENT (owner's ruling
// 2026-11-15, after the driver's 1102 on `/payments/import` in run
// 43758082319): every route of the §6.8 table in the table's order, and for
// each route all six roles in `MATRIX_ROLES` order — owner first, driver
// last, refused cells INCLUDED, because the 1102 came on a page the matrix
// refuses, asked for by the last role on an isolate that had served the
// other five. A single role's `reach` routes never ask for that page, which
// is why two driver probes read clean beside it. Every 5xx carries its ray,
// the runtime's word if the tail delivered one, and whether the body is
// Cloudflare's 1102 page (`namesResourceLimit`), so a 1102 with no tail
// event is still recorded by ray rather than lost as "unaccounted".
//
// WHAT IT READS. The deploy sweep asks one dev isolate for every page as six
// roles inside twenty minutes and, on 2026-11-12/13, read `Dynamic import
// exceeded memory limits` on 21–28 requests a run across four commits —
// three doc-only, one the revert of the day's only code change — while
// production's persisted logs never held the outcome once in a week. The
// bundle, the code and the colo were each eliminated by reading. What is
// left is what an isolate holds when asked for every DISTINCT route, and no
// instrument here reads an isolate's memory. So this one reads the SHAPE:
//
//   ONE role, that role's `reach` routes from the §6.8 table in the table's
//   order, ONCE EACH (pass 1), then the SAME routes again (pass 2), which
//   loads nothing new. Per request: how many distinct routes the isolate has
//   been asked for so far, the status, and — ray by ray through `startTail` —
//   the runtime's wall, CPU and its own word for a failure.
//
// THE READING is two counts and a shape (`probeVerdict`): the 500 count of
// each pass, the distinct-route count at the first 500, and whether the tail
// accounted for every 500. A ceiling that is the parsed code of distinct
// routes shows a first 500 at some count and a second pass as red as the
// first's end; a ceiling that is per request shows 500s from the start; a
// clean probe is zero 500s on both passes with every ray accounted for.
//
// FAILS CLOSED. An undelivered ray is NAMED; a 500 the tail could not account
// for is NOT OK on its own, because "unreadable is not clean"; a tail that
// never saw its canary refuses the whole reading. The ids come from dev's
// branch only — `little-lake` in `DIRECT_DATABASE_URL`, refused otherwise —
// and `startTail` refuses the production worker by itself.
// ---------------------------------------------------------------------------
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  classify,
  credentialsFor,
  ID_SOURCES,
  MATRIX_ROLES,
  namesCeiling,
  readRouteMatrix,
} from './sweep.mjs'
import { startTail, trimEvent, workerNameFor } from './worker-tail.mjs'

export const DEFAULT_BASE = 'https://zebra-dev.tajikcargollc.workers.dev'
export const PASSES = 2
export const TAIL_WAIT_MS = 30_000
/** The `--role` value that runs the sweep's six-role sequence. */
export const ALL_ROLES = 'all'
/** Cloudflare's own page for a worker over its limits — error 1102. */
export const RESOURCE_LIMIT_WORDS =
  /Error 1102|Worker exceeded resource limits/i

/** `--role x --base y` as an object; an unknown flag is an error, not a default. */
export function parseArgs(argv) {
  const out = { role: 'accounting', base: DEFAULT_BASE }
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (flag === '--role' && value) out.role = value.toLowerCase()
    else if (flag === '--base' && value) out.base = value
    else throw new Error(`isolate-probe: unknown argument ${flag}`)
  }
  return out
}

/**
 * The routes one role reaches, in the table's own order — the fixed route
 * set. A role with no column throws (readRouteMatrix); a role that reaches
 * nothing is an empty set, which `probeVerdict` refuses to call clean.
 */
export function routesFor(matrix, role) {
  return [...matrix]
    .filter(([, row]) => row[role] === 'reach')
    .map(([route]) => route)
}

/**
 * The requests one probe makes in a pass, in order: for one role, its
 * `reach` routes; for `all`, every route of the table in the table's order
 * and, for each, every role in `MATRIX_ROLES` order whatever the cell says —
 * refused cells included, which is the sweep's own sequence.
 * @returns {{ route: string, role: string, expected: string }[]}
 */
export function sequenceFor(matrix, role) {
  if (role !== ALL_ROLES)
    return routesFor(matrix, role).map((route) => ({
      route,
      role,
      expected: 'reach',
    }))
  const out = []
  for (const [route, row] of matrix)
    for (const name of MATRIX_ROLES)
      out.push({ route, role: name, expected: row[name] })
  return out
}

/** Whether a response is Cloudflare's 1102 page — a 5xx whose body says so. */
export const namesResourceLimit = (status, body) =>
  status >= 500 && RESOURCE_LIMIT_WORDS.test(String(body ?? ''))

/**
 * The rows with their distinct-route counts: how many different routes the
 * isolate has been asked for up to and including this request. Pass 2 adds
 * nothing to the count, which is the point of pass 2.
 */
/**
 * @template {{ route: string }} T
 * @param {T[]} rows
 * @returns {(T & { distinct: number })[]}
 */
export function withDistinctCounts(rows) {
  const seen = new Set()
  return rows.map((row) => {
    seen.add(row.route)
    return { ...row, distinct: seen.size }
  })
}

/**
 * The reading. `rows` carry `pass`, `route`, `status`, `distinct`, `ray`,
 * and `worker` (a trimmed tail event, or null when the tail never delivered
 * the ray). A 500 is `status >= 500`; a ceiling 500 is one whose worker
 * account names the ceiling (`namesCeiling`).
 */
export function probeVerdict(rows) {
  /** @type {Record<number, { requests: number, failed: number, firstAtDistinct: number | null, ceiling: number, resourceLimit: number, unaccounted: number, otherFault: number }>} */
  const passes = {}
  for (const pass of [1, 2]) {
    const mine = rows.filter((row) => row.pass === pass)
    const failed = mine.filter((row) => row.status >= 500)
    const first = failed[0]
    passes[pass] = {
      requests: mine.length,
      failed: failed.length,
      firstAtDistinct: first ? first.distinct : null,
      ceiling: failed.filter((row) => namesCeiling(row.worker)).length,
      // Cloudflare's 1102 page, by the body — counted beside the ceiling and
      // the unaccounted, not instead of them: a 1102 with no tail event is
      // both, and the ray is in the row either way.
      resourceLimit: failed.filter((row) => row.resourceLimit).length,
      unaccounted: failed.filter((row) => !row.worker).length,
      otherFault: failed.filter(
        (row) => row.worker && !namesCeiling(row.worker),
      ).length,
    }
  }
  const undelivered = rows.filter((row) => !row.worker).map((row) => row.ray)
  const totalFailed = passes[1].failed + passes[2].failed
  const unaccounted = passes[1].unaccounted + passes[2].unaccounted
  const empty = rows.length === 0
  const shape = empty
    ? 'nothing fetched'
    : totalFailed === 0
      ? 'clean'
      : passes[1].firstAtDistinct !== null &&
          passes[1].firstAtDistinct > 1 &&
          passes[2].failed >= passes[1].failed
        ? 'rises with distinct routes, and stays up'
        : passes[1].firstAtDistinct === 1
          ? 'from the first request'
          : 'scattered'
  return {
    passes,
    undelivered,
    shape,
    // CLEAN needs all three: nothing failed, nothing was fetched into
    // silence, and the tail accounted for every ray — "sees no rows" is
    // true of an empty set, so an empty probe is not clean either.
    clean: !empty && totalFailed === 0 && undelivered.length === 0,
    notOk: empty || totalFailed > 0 || unaccounted > 0,
  }
}

/** One line a `tail -1` cannot misread. */
export function verdictLine(verdict, role) {
  const p1 = verdict.passes[1]
  const p2 = verdict.passes[2]
  const counts = `pass 1: ${p1.failed} of ${p1.requests} answered 5xx (first at distinct route ${p1.firstAtDistinct ?? '—'}, ${p1.ceiling} the ceiling, ${p1.resourceLimit} 1102, ${p1.unaccounted} unaccounted); pass 2: ${p2.failed} of ${p2.requests} (${p2.ceiling} the ceiling, ${p2.resourceLimit} 1102, ${p2.unaccounted} unaccounted)`
  if (verdict.clean)
    return `ISOLATE PROBE CLEAN — OK. role ${role}; ${counts}; every ray accounted for.`
  return `ISOLATE PROBE READ ${verdict.shape.toUpperCase()} — NOT OK. role ${role}; ${counts}; ${verdict.undelivered.length} ray(s) the tail never delivered.`
}

async function main() {
  const { role, base } = parseArgs(process.argv.slice(2))
  const here = dirname(fileURLToPath(import.meta.url))
  const root = join(here, '..')
  const { Pool } = await import('pg')
  const { chromium } = await import('playwright')

  const dbUrl = process.env.DIRECT_DATABASE_URL ?? ''
  if (!/little-lake/.test(dbUrl))
    throw new Error(
      'isolate-probe: DIRECT_DATABASE_URL is not the dev branch (little-lake) — refusing.',
    )
  const roles = role === ALL_ROLES ? MATRIX_ROLES : [role]
  const credentials = new Map()
  for (const name of roles) {
    const { email, password } = credentialsFor(name, process.env)
    if (!email || !password)
      throw new Error(`isolate-probe: no SEED_${name.toUpperCase()}_* in .env`)
    credentials.set(name, { email, password })
  }

  // ── the fixed route set, in the table's order ──────────────────────────
  const matrix = readRouteMatrix(
    readFileSync(join(root, 'TMS-DESIGN-SYSTEM.md'), 'utf8'),
  )
  const sequence = sequenceFor(matrix, role)
  console.log(
    role === ALL_ROLES
      ? `${sequence.length} request(s) a pass: ${matrix.size} route(s) × ${roles.length} roles, in §6.8's order, refused cells included`
      : `${sequence.length} route(s) reach for ${role}, in §6.8's order`,
  )

  // ── ids, from each role's own organization on dev ──────────────────────
  const pool = new Pool({ connectionString: dbUrl, max: 1 })
  const organizationOf = new Map()
  for (const [name, { email }] of credentials) {
    const { rows: who } = await pool.query(
      `select m."organizationId" from "Membership" m join "User" u on u.id = m."userId" where u.email = $1 limit 1`,
      [email],
    )
    if (!who[0]?.organizationId) {
      await pool.end()
      throw new Error(`isolate-probe: ${email} has no membership on dev`)
    }
    organizationOf.set(name, who[0].organizationId)
  }
  const models = new Map(ID_SOURCES)
  const idCache = new Map()
  const paths = []
  const skipped = []
  for (const entry of sequence) {
    const { route } = entry
    const model = models.get(route)
    if (!model) {
      if (/\[[^\]]+\]/.test(route))
        skipped.push(`${route} as ${entry.role} (no id source)`)
      else paths.push({ ...entry, path: route })
      continue
    }
    const organizationId = organizationOf.get(entry.role)
    const key = `${model}|${organizationId}`
    if (!idCache.has(key)) {
      const { rows } = await pool.query(
        `select id from "${model}" where "organizationId" = $1 order by "createdAt" desc limit 1`,
        [organizationId],
      )
      idCache.set(key, rows[0]?.id ?? null)
    }
    const id = idCache.get(key)
    if (id) paths.push({ ...entry, path: route.replace('[id]', id) })
    else skipped.push(`${route} as ${entry.role} (no ${model} row)`)
  }
  await pool.end()
  for (const line of skipped) console.log(`  skipped ${line}`)

  // ── the tail, proven ready ─────────────────────────────────────────────
  const worker = workerNameFor(base)
  const tail = startTail(worker, { maxMs: 20 * 60_000 })
  if (tail.failure()) throw new Error(tail.failure())
  const ready = await tail.ready(new URL('/login', base))
  if (!ready) {
    tail.stop()
    throw new Error('isolate-probe: the tail never saw its canary — NOT OK')
  }
  console.log(`tail ready on ${worker}`)

  // ── one sign-in per role, in MATRIX_ROLES order ────────────────────────
  const browser = await chromium.launch(
    process.env.SHOT_CHROME ? { executablePath: process.env.SHOT_CHROME } : {},
  )
  const cookies = new Map()
  for (const [name, { email, password }] of credentials) {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' })
    await page.fill('input[name="email"]', email)
    await page.fill('input[name="password"]', password)
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith('/login'), {
        timeout: 90_000,
      }),
      page.click('button[type="submit"]'),
    ])
    const cookie = (await context.cookies()).find(
      (c) => c.name === 'zebra_session',
    )
    await context.close()
    if (!cookie?.value) {
      await browser.close()
      tail.stop()
      throw new Error(
        `isolate-probe: no zebra_session after the ${name} sign-in`,
      )
    }
    cookies.set(name, cookie.value)
    console.log(`signed in as ${name}`)
  }
  await browser.close()

  // ── the two passes ─────────────────────────────────────────────────────
  const fetched = []
  for (let pass = 1; pass <= PASSES; pass++) {
    for (const { route, role: as, expected, path } of paths) {
      const started = performance.now()
      const response = await fetch(new URL(path, base), {
        headers: { cookie: `zebra_session=${cookies.get(as)}` },
        redirect: 'manual',
      })
      const body = await response.text()
      fetched.push({
        pass,
        route,
        role: as,
        expected,
        path,
        status: response.status,
        verdict: classify(response.status, body),
        resourceLimit: namesResourceLimit(response.status, body),
        ray: response.headers.get('cf-ray'),
        clientMs: Math.round(performance.now() - started),
      })
    }
  }
  const rows = withDistinctCounts(fetched)

  // ── the worker's account of every ray ──────────────────────────────────
  await tail.waitFor(rows.map((row) => row.ray).filter(Boolean), TAIL_WAIT_MS)
  for (const row of rows) {
    const event = row.ray ? tail.lookup(row.ray) : null
    row.worker = event ? trimEvent(event) : null
  }
  tail.stop()

  // ── the table ──────────────────────────────────────────────────────────
  console.log(
    '\npass distinct role        status  wall   cpu  route                               worker',
  )
  for (const row of rows) {
    const w = row.worker
    const said = row.resourceLimit
      ? `1102 RESOURCE LIMIT, ray ${row.ray}${w ? ` (${w.outcome})` : ', no tail event'}`
      : w
        ? namesCeiling(w)
          ? 'MEMORY CEILING'
          : (w.exceptions[0] &&
              `${w.exceptions[0].name}: ${w.exceptions[0].message}`) ||
            w.outcome
        : 'no tail event'
    console.log(
      `${String(row.pass).padStart(4)} ${String(row.distinct).padStart(8)} ${row.role.padEnd(11)} ${String(row.status).padStart(6)} ${String(w?.wallTime ?? '-').padStart(5)} ${String(w?.cpuTime ?? '-').padStart(5)}  ${row.route.padEnd(35)} ${String(said).slice(0, 60)}`,
    )
  }

  const verdict = probeVerdict(rows)
  const detail =
    process.env.RUN_STATUS_DETAIL ??
    join('.run-status', 'isolate-probe.detail.json')
  mkdirSync(dirname(detail), { recursive: true })
  writeFileSync(
    detail,
    JSON.stringify(
      {
        base,
        worker,
        role,
        at: new Date().toISOString(),
        skipped,
        rows,
        verdict,
      },
      null,
      2,
    ),
  )
  console.log(`\nrecorded in ${detail}`)
  console.log(verdictLine(verdict, role))
  return verdict.notOk ? 1 : 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(`isolate-probe: ${error.message} — NOT OK`)
      process.exit(1)
    },
  )
}
