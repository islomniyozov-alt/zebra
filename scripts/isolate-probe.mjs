#!/usr/bin/env node
// ---------------------------------------------------------------------------
// THE ISOLATE PROBE — the memory ceiling's own instrument (§6.10 v10.94;
// owner's ruling 2026-11-13 on GAPS 43; GAPS 44).
//
//   node scripts/isolate-probe.mjs [--role accounting] [--base <origin>]
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
  namesCeiling,
  readRouteMatrix,
} from './sweep.mjs'
import { startTail, trimEvent, workerNameFor } from './worker-tail.mjs'

export const DEFAULT_BASE = 'https://zebra-dev.tajikcargollc.workers.dev'
export const PASSES = 2
export const TAIL_WAIT_MS = 30_000

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
  /** @type {Record<number, { requests: number, failed: number, firstAtDistinct: number | null, ceiling: number, unaccounted: number, otherFault: number }>} */
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
  const counts = `pass 1: ${p1.failed} of ${p1.requests} answered 5xx (first at distinct route ${p1.firstAtDistinct ?? '—'}, ${p1.ceiling} the ceiling, ${p1.unaccounted} unaccounted); pass 2: ${p2.failed} of ${p2.requests} (${p2.ceiling} the ceiling, ${p2.unaccounted} unaccounted)`
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
  const { email, password } = credentialsFor(role, process.env)
  if (!email || !password)
    throw new Error(`isolate-probe: no SEED_${role.toUpperCase()}_* in .env`)

  // ── the fixed route set, in the table's order ──────────────────────────
  const matrix = readRouteMatrix(
    readFileSync(join(root, 'TMS-DESIGN-SYSTEM.md'), 'utf8'),
  )
  const routes = routesFor(matrix, role)
  console.log(`${routes.length} route(s) reach for ${role}, in §6.8's order`)

  // ── ids, from the role's own organization on dev ───────────────────────
  const pool = new Pool({ connectionString: dbUrl, max: 1 })
  const { rows: who } = await pool.query(
    `select m."organizationId" from "Membership" m join "User" u on u.id = m."userId" where u.email = $1 limit 1`,
    [email],
  )
  const organizationId = who[0]?.organizationId
  if (!organizationId) {
    await pool.end()
    throw new Error(`isolate-probe: ${email} has no membership on dev`)
  }
  const models = new Map(ID_SOURCES)
  const paths = []
  const skipped = []
  for (const route of routes) {
    const model = models.get(route)
    if (!model) {
      if (/\[[^\]]+\]/.test(route)) skipped.push(`${route} (no id source)`)
      else paths.push({ route, path: route })
      continue
    }
    const { rows } = await pool.query(
      `select id from "${model}" where "organizationId" = $1 order by "createdAt" desc limit 1`,
      [organizationId],
    )
    if (rows[0]) paths.push({ route, path: route.replace('[id]', rows[0].id) })
    else skipped.push(`${route} (no ${model} row)`)
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

  // ── one sign-in, one role ──────────────────────────────────────────────
  const browser = await chromium.launch(
    process.env.SHOT_CHROME ? { executablePath: process.env.SHOT_CHROME } : {},
  )
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
  await browser.close()
  if (!cookie?.value) {
    tail.stop()
    throw new Error(`isolate-probe: no zebra_session after the ${role} sign-in`)
  }
  console.log(`signed in as ${role}`)

  // ── the two passes ─────────────────────────────────────────────────────
  const fetched = []
  for (let pass = 1; pass <= PASSES; pass++) {
    for (const { route, path } of paths) {
      const started = performance.now()
      const response = await fetch(new URL(path, base), {
        headers: { cookie: `zebra_session=${cookie.value}` },
        redirect: 'manual',
      })
      const body = await response.text()
      fetched.push({
        pass,
        route,
        path,
        status: response.status,
        verdict: classify(response.status, body),
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
    '\npass distinct status  wall   cpu  route                               worker',
  )
  for (const row of rows) {
    const w = row.worker
    const said = w
      ? namesCeiling(w)
        ? 'MEMORY CEILING'
        : (w.exceptions[0] &&
            `${w.exceptions[0].name}: ${w.exceptions[0].message}`) ||
          w.outcome
      : 'no tail event'
    console.log(
      `${String(row.pass).padStart(4)} ${String(row.distinct).padStart(8)} ${String(row.status).padStart(6)} ${String(w?.wallTime ?? '-').padStart(5)} ${String(w?.cpuTime ?? '-').padStart(5)}  ${row.route.padEnd(35)} ${String(said).slice(0, 60)}`,
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
