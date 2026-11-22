#!/usr/bin/env node
// ---------------------------------------------------------------------------
// THE PACKET PROBE — Merge download's memory on a dev isolate (TMS §7.14
// item 5; BROKER-LOAD-BRIEF R9: "the assembly measured on dev with the
// isolate probe before step 4 ships (three runs, zero `exceededMemory`, as
// the argon2 rule)"; GAPS 44).
//
//   node --env-file=.env scripts/packet-probe.mjs [--runs 3] [--base <origin>]
//
// WHAT IT MEASURES IS THE BUILD, NOT THE REUSE. A packet whose inputs have
// not changed is answered from R2 without assembling anything, so a second
// GET of the same load measures nothing. Before each run the probe takes the
// load's live INVOICE_PACKET row off (soft delete, dev only, said by count)
// so the GET builds, stores and serves the packet in one invocation.
//
// THE LOAD IS THE HEAVIEST broker load on dev the owner's organization holds:
// live POD, BOL and rate-con documents summed by `sizeBytes`, under the 20 MB
// cap, so the reading is of the worst real case rather than a convenient one.
//
// THE READING, per run: the HTTP status, the PDF's bytes, and — ray by ray
// through `startTail` — the runtime's outcome, wall and CPU, and whether its
// account names the memory ceiling. OK is every run 200 with a tail event
// whose outcome is `ok` and which names no ceiling. A ray the tail never
// delivered is NOT OK: "unreadable is not clean".
//
// Dev only: `DIRECT_DATABASE_URL` must be dev's branch (`little-lake`), and
// `startTail` refuses the production worker by itself.
// ---------------------------------------------------------------------------
import { fileURLToPath } from 'node:url'
import { credentialsFor, namesCeiling } from './sweep.mjs'
import { startTail, trimEvent, workerNameFor } from './worker-tail.mjs'

export const DEFAULT_BASE = 'https://zebra-dev.tajikcargollc.workers.dev'
export const DEFAULT_RUNS = 3
const CAP = 20 * 1024 * 1024
const TAIL_WAIT_MS = 30_000

/** `--runs n --base url`; an unknown flag is an error, not a default. */
export function parseArgs(argv) {
  const out = { runs: DEFAULT_RUNS, base: DEFAULT_BASE }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (flag === '--runs' && value) {
      out.runs = Number(value)
      if (!Number.isInteger(out.runs) || out.runs < 1)
        throw new Error(`packet-probe: --runs ${value} is not a count`)
      i++
    } else if (flag === '--base' && value) {
      out.base = value
      i++
    } else throw new Error(`packet-probe: unknown argument ${flag}`)
  }
  return out
}

/**
 * The route's own `packet.timing` line from a trimmed tail event, or null.
 * It names the isolate (a tag drawn once per isolate) and how many packet
 * requests that isolate had served — so a CPU figure can be read as a fresh
 * isolate's or a warm one's (GAPS 44, 2026-11-22).
 */
export function packetLineOf(worker) {
  for (const entry of worker?.logs ?? []) {
    try {
      const line = JSON.parse(entry.message)
      if (line?.event === 'packet.timing') return line
    } catch {
      // not a JSON line
    }
  }
  return null
}

/** One run's verdict from its status and the worker's account of its ray. */
export function runVerdict(run) {
  if (run.status !== 200) return `HTTP ${run.status}`
  if (!run.worker) return 'no tail event — unreadable'
  if (namesCeiling(run.worker)) return 'MEMORY CEILING'
  if (run.worker.outcome !== 'ok') return `outcome ${run.worker.outcome}`
  // A RUN THAT DID NOT BUILD MEASURED NOTHING, and a run whose line is
  // missing cannot say whether it built.
  const line = packetLineOf(run.worker)
  if (!line) return 'no packet.timing line — unreadable'
  if (line.outcome !== 'built') return `served ${line.outcome}, not built`
  return 'ok'
}

export function probeLine(runs) {
  const bad = runs.filter((run) => runVerdict(run) !== 'ok')
  const ceiling = runs.filter((run) => runVerdict(run) === 'MEMORY CEILING')
  return bad.length === 0
    ? `PACKET PROBE CLEAN — OK. ${runs.length} build(s), 0 exceededMemory, every ray accounted for.`
    : `PACKET PROBE — NOT OK. ${bad.length} of ${runs.length} run(s) not clean, ${ceiling.length} naming the memory ceiling.`
}

async function main() {
  const { runs, base } = parseArgs(process.argv.slice(2))
  const dbUrl = process.env.DIRECT_DATABASE_URL ?? ''
  if (!/little-lake/.test(dbUrl))
    throw new Error(
      'packet-probe: DIRECT_DATABASE_URL is not the dev branch (little-lake) — refusing.',
    )
  const { email, password } = credentialsFor('owner', process.env)
  if (!email || !password)
    throw new Error('packet-probe: no SEED_OWNER_* in .env')

  const { Pool } = await import('pg')
  const pool = new Pool({ connectionString: dbUrl, max: 1 })
  const { rows: who } = await pool.query(
    `select m."organizationId" from "Membership" m join "User" u on u.id = m."userId" where u.email = $1 limit 1`,
    [email],
  )
  const organizationId = who[0]?.organizationId
  if (!organizationId) {
    await pool.end()
    throw new Error(`packet-probe: ${email} has no membership on dev`)
  }
  // The heaviest broker load: not direct-settled, not Amazon by name, live
  // packet paper summed, under the cap.
  const { rows: loads } = await pool.query(
    `select l.id, l."loadNumber", count(d.id)::int as files,
            sum(d."sizeBytes")::bigint as bytes
       from "Load" l
       join "Customer" c on c.id = l."customerId"
       join "Document" d on d."loadId" = l.id and d."deletedAt" is null
                        and d.type in ('POD', 'BOL', 'RATE_CONFIRMATION')
      where l."organizationId" = $1 and l."deletedAt" is null
        and not l."directSettled" and c.name not ilike '%amazon%'
      group by l.id
     having sum(d."sizeBytes") <= $2
      order by sum(d."sizeBytes") desc
      limit 1`,
    [organizationId, CAP],
  )
  const load = loads[0]
  if (!load) {
    await pool.end()
    throw new Error(
      'packet-probe: no broker load on dev carries a POD, BOL or rate con — nothing to measure',
    )
  }
  console.log(
    `load ${load.loadNumber} (${load.id}): ${load.files} file(s), ${(Number(load.bytes) / 1_048_576).toFixed(2)} MB of source`,
  )

  const worker = workerNameFor(base)
  const tail = startTail(worker, { maxMs: 10 * 60_000 })
  if (tail.failure()) throw new Error(tail.failure())
  if (!(await tail.ready(new URL('/login', base)))) {
    tail.stop()
    await pool.end()
    throw new Error('packet-probe: the tail never saw its canary — NOT OK')
  }

  const { chromium } = await import('playwright')
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
  const session = (await context.cookies()).find(
    (cookie) => cookie.name === 'zebra_session',
  )?.value
  await browser.close()
  if (!session) {
    tail.stop()
    await pool.end()
    throw new Error('packet-probe: sign-in did not complete — NOT OK')
  }

  const results = []
  for (let run = 1; run <= runs; run++) {
    const cleared = await pool.query(
      `update "Document" set "deletedAt" = now()
        where "loadId" = $1 and type = 'INVOICE_PACKET' and "deletedAt" is null`,
      [load.id],
    )
    const started = performance.now()
    const response = await fetch(
      new URL(`/api/loads/${load.id}/invoice-packet`, base),
      { headers: { cookie: `zebra_session=${session}` }, redirect: 'manual' },
    )
    const body = new Uint8Array(await response.arrayBuffer())
    results.push({
      run,
      cleared: cleared.rowCount,
      status: response.status,
      bytes: body.byteLength,
      ray: response.headers.get('cf-ray'),
      clientMs: Math.round(performance.now() - started),
      detail:
        response.status === 200
          ? null
          : new TextDecoder().decode(body).slice(0, 200),
    })
  }
  await pool.end()

  await tail.waitFor(
    results.map((row) => row.ray).filter(Boolean),
    TAIL_WAIT_MS,
  )
  for (const row of results) {
    const event = row.ray ? tail.lookup(row.ray) : null
    row.worker = event ? trimEvent(event) : null
  }
  tail.stop()

  console.log(
    '\nrun cleared status    bytes  client   wall    cpu  isolate  nth  worker',
  )
  for (const row of results) {
    const line = packetLineOf(row.worker)
    console.log(
      `${String(row.run).padStart(3)} ${String(row.cleared).padStart(7)} ${String(row.status).padStart(6)} ${String(row.bytes).padStart(8)} ${String(row.clientMs).padStart(7)} ${String(row.worker?.wallTime ?? '-').padStart(6)} ${String(row.worker?.cpuTime ?? '-').padStart(6)}  ${String(line?.isolateTag ?? '-').padEnd(8)} ${String(line?.isolatePacketRequests ?? '-').padStart(4)}  ${runVerdict(row)}${row.detail ? ` — ${row.detail}` : ''}`,
    )
  }
  const line = probeLine(results)
  console.log(`\n${line}`)
  if (!line.includes('— OK.')) process.exitCode = 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`packet-probe: ${error.message} — NOT OK`)
    process.exitCode = 1
  })
}
