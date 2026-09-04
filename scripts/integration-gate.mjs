import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { writeReceipt } from './integration-receipt.mjs'

// ---------------------------------------------------------------------------
// THE ONE PLACE THE INTEGRATION SUITE IS LAUNCHED.
//
// `deploy.mjs` calls it and `npm run test:integration` calls it, so a run that
// earns a receipt and a run that gates a deploy are THE SAME RUN, launched the
// same way, against the same database. Two launchers would be two answers to
// "where does this write", which is the question the whole incident was about.
//
// IT SCRUBS. `DATABASE_URL`, `DIRECT_DATABASE_URL` and `NEON_BRANCH` are
// deleted from the child's environment, so `.env` — read by `tests/setup.ts`
// through dotenv, which does not override — is the only possible source. A
// ritual terminal's leftovers cannot aim this at production; that is not a
// theory, it is what happened on 2026-08-14.
//
// AND IT CHECKS `.env` ANYWAY, because scrubbing says nothing about whether
// the file itself points somewhere dangerous.
// ---------------------------------------------------------------------------

/**
 * The failure names, written as they happen, read back after a crash.
 *
 * DECLARED HERE, WITH THE OTHER CONSTANTS. It first lived at the bottom of the
 * file beside the function that reads it, which put it in the temporal dead
 * zone for `runSuite` — the gate died on "Cannot access 'FAILURE_LOG' before
 * initialization" ten seconds in. Cheap, because it refused early rather than
 * fourteen minutes later; the shape to avoid is a `const` declared after its
 * first use.
 */
const FAILURE_LOG = '.integration-failures.log'
const SCRUBBED = ['DATABASE_URL', 'DIRECT_DATABASE_URL', 'NEON_BRANCH']

// A FILE PATH, NOT A PACKAGE SPECIFIER. `require.resolve('vitest/vitest.mjs')`
// throws ERR_PACKAGE_PATH_NOT_EXPORTED — the file is right there on disk and
// the package's `exports` map simply does not list it. Resolving relative to
// this file avoids asking the package's opinion about its own contents, and
// avoids `npx` and its shell along with it.
const VITEST_ENTRY = fileURLToPath(
  new URL('../node_modules/vitest/vitest.mjs', import.meta.url),
)

// ONE RUNNER PER DATABASE IS NO LONGER THIS FILE'S JOB. The lock moved into
// the suite itself — `tests/integration-lock.ts`, run by Vitest's globalSetup —
// because guarding only the two commands that go through here left a bare
// `vitest` invocation free to run beside a gate. It MUST NOT also be taken
// here: this process spawns the suite as a child, and a lock held by the
// parent is a lock the child cannot get.

/** `.env`, parsed just enough — never loaded into this process. */
function envFileValues() {
  let text = ''
  try {
    text = readFileSync('.env', 'utf8')
  } catch {
    return {}
  }
  const values = {}
  for (const line of text.split(/[\r\n]+/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    values[match[1]] = match[2].trim().replace(/^["']|["']$/g, '')
  }
  return values
}

/** The pooled and direct doors of one Neon endpoint fold to the same name. */
export function endpointOf(url) {
  const { hostname } = new URL(url)
  const [first, ...rest] = hostname.split('.')
  return [first.replace(/-pooler$/, ''), ...rest].join('.')
}

/**
 * Which endpoint `.env` names, or a refusal.
 *
 * The same two questions `tests/db-target.ts` asks, asked here as well so a
 * deploy can refuse BEFORE spending an hour rather than after.
 */
export function resolveEndpoint() {
  const file = envFileValues()
  const pooled = file.DATABASE_URL
  const direct = file.DIRECT_DATABASE_URL

  if (!pooled || !direct) {
    return {
      ok: false,
      message: '.env is missing DATABASE_URL or DIRECT_DATABASE_URL.',
    }
  }

  let a
  let b
  try {
    a = endpointOf(pooled)
    b = endpointOf(direct)
  } catch {
    return { ok: false, message: '.env has a DATABASE_URL that is not a URL.' }
  }

  if (a !== b) {
    return {
      ok: false,
      message:
        '.env names two different database endpoints:\n' +
        `  DATABASE_URL        -> ${a}\n` +
        `  DIRECT_DATABASE_URL -> ${b}`,
    }
  }

  if ((file.NEON_BRANCH ?? '').trim().toLowerCase() === 'production') {
    return { ok: false, message: '.env says NEON_BRANCH=production.' }
  }

  return { ok: true, endpoint: a }
}

/**
 * Run the suite. Returns `{ ok, endpoint, receipt }`.
 *
 * A RECEIPT IS WRITTEN ONLY ON A GREEN RUN, and only after the runner has
 * exited — the timestamp is the finish, not the start.
 */
export async function runIntegrationSuite() {
  const target = resolveEndpoint()
  if (!target.ok) {
    console.error('')
    console.error(`Refusing to run the integration suite: ${target.message}`)
    return { ok: false, endpoint: null, receipt: null }
  }

  const child = { ...process.env }
  const carried = SCRUBBED.filter((name) => child[name] !== undefined)
  for (const name of SCRUBBED) delete child[name]

  if (carried.length > 0) {
    console.log('')
    console.log(
      `Ignoring ${carried.join(', ')} from this terminal — the suite reads .env.`,
    )
  }
  console.log(`The suite will write to ${target.endpoint} (from .env).`)

  // WAKE IT BEFORE THE CLOCK STARTS. See warmCompute below.
  await warmCompute(envFileValues().DIRECT_DATABASE_URL)

  console.log('')

  try {
    const status = await new Promise((resolve) => {
      // NODE ON VITEST'S OWN ENTRY, NOT `npx` THROUGH A SHELL.
      //
      // `shell: true` made Node print DEP0190 on every single gate — "passing
      // args to a child process with shell option true can lead to security
      // vulnerabilities, as the arguments are not escaped, only concatenated"
      // — which is a real warning wearing out its welcome: fifty runs of noise
      // teaches the eye to skip the banner area, which is where the refusals
      // and the receipt line also live.
      //
      // The shell was only ever there to find `npx` on Windows, where it is
      // `npx.cmd`. Resolving the module entry removes both the shell and the
      // guessing: this is the exact vitest this repository installed.
      // The reporter and this script must agree on where the failure list goes.
      // Set ON `child` rather than spread at the call site, so the scrubbing
      // guard in db-target.test.ts still sees `env: child` — the whole point of
      // that assertion is that no OTHER environment can reach the suite.
      child.ZEBRA_FAILURE_LOG = FAILURE_LOG

      const proc = spawn(
        process.execPath,
        [VITEST_ENTRY, 'run', '--project', 'integration'],
        { stdio: 'inherit', env: child },
      )
      proc.on('close', (code) => resolve(code))
      proc.on('error', () => resolve(1))
    })

    if (status !== 0) {
      // WHAT FAILED, FROM THE FILE, BECAUSE THE REPORTER MAY NEVER HAVE
      // RENDERED.
      //
      // On 2026-09-04 a run printed "2 failed | 210 passed" and then died on a
      // dropped socket. Vitest writes its failure list when the run ENDS, so
      // the list was never produced and the two tests were unidentifiable —
      // flag 87's shape, a failure whose diagnosis is destroyed by how it was
      // reported. `tests/failure-reporter.ts` appends each failure the moment
      // it happens; this reads that back so the gate's own output carries the
      // names even when the process died mid-render.
      printFailureLog()
      return { ok: false, endpoint: target.endpoint, receipt: null }
    }

    const receipt = writeReceipt({ endpoint: target.endpoint })
    console.log('')
    console.log(
      `Receipt written: ${receipt.commit.slice(0, 7)}${receipt.clean ? '' : ' (DIRTY — will not be accepted)'} at ${receipt.finishedAt}`,
    )
    if (receipt.clean) {
      // A WALL-CLOCK TIME, NOT A DURATION. "For the next hour" is an hour from
      // a moment the reader has to find and then do arithmetic on, at the end
      // of a run that finishes whenever it finishes — frequently at 1am. Four
      // receipts expired unused before this line existed.
      const expires = new Date(
        new Date(receipt.finishedAt).getTime() + 60 * 60 * 1000,
      )
      console.log(
        `\`npm run deploy:prod\` will accept it until ${expires.toLocaleTimeString()} — ${expires.toLocaleString()}.`,
      )
    }

    return { ok: true, endpoint: target.endpoint, receipt }
  } catch (error) {
    // The suite refusing because another runner holds the lock arrives here as
    // a non-zero child exit, not as a throw; this catches anything else and
    // keeps the gate's contract of returning rather than exploding.
    console.error('')
    console.error(String(error))
    return { ok: false, endpoint: target.endpoint, receipt: null }
  }
}

// Runnable on its own: `npm run test:integration`.
if (process.argv[1] && process.argv[1].endsWith('integration-gate.mjs')) {
  const outcome = await runIntegrationSuite()
  process.exit(outcome.ok ? 0 : 1)
}

function printFailureLog() {
  let text = ''
  try {
    text = readFileSync(FAILURE_LOG, 'utf8').trim()
  } catch {
    // No file means the run never started a test, which the exit code and the
    // output above already say.
    return
  }
  if (text === '') return

  console.log('')
  console.log('What failed, recorded as it happened:')
  for (const line of text.split('\n')) console.log(`  ${line}`)
}

/**
 * Wake the compute, then wait, so a resume happens OUTSIDE the measured run.
 *
 * Neon suspends the dev compute after roughly five idle minutes, and a connect
 * resumes it — measured 2026-09-04, twice, by the postmaster being younger than
 * the query that found it. The first query then costs 1.8–7.8s, and multi-second
 * stalls cluster in the minutes after. Inside a 20-second transaction that is an
 * "expired transaction" error blamed on the code under test.
 *
 * WHAT THIS DOES AND DOES NOT DO, plainly: it moves the RESUME out of the run.
 * It does not clear the post-resume window in which stalls were observed — that
 * ran to about five minutes, and no gate is going to wait that long. With an
 * always-on compute this is a no-op that costs ten seconds; without one, or if
 * the setting is ever changed back, it removes the worst-timed failure.
 *
 * IT NEVER FAILS THE GATE. A warm-up that could refuse a run would be a new way
 * to lose fourteen minutes, and the suite is perfectly able to report a database
 * it cannot reach.
 */
async function warmCompute(directUrl) {
  const started = Date.now()
  try {
    const { neonConfig, Pool } = await import('@neondatabase/serverless')
    neonConfig.webSocketConstructor ??= WebSocket
    neonConfig.poolQueryViaFetch = false

    const pool = new Pool({ connectionString: directUrl, max: 1 })
    pool.on('error', () => {})
    try {
      const { rows } = await pool.query(
        'select extract(epoch from now() - pg_postmaster_start_time())::int as uptime_s',
      )
      const uptime = rows[0]?.uptime_s ?? -1
      const took = Date.now() - started
      console.log(
        `Compute awake in ${took}ms; it has been up ${uptime}s.` +
          (uptime < 30 ? ' (it had suspended — this run resumed it)' : ''),
      )
    } finally {
      await pool.end().catch(() => {})
    }
  } catch (error) {
    console.log(
      `Could not warm the compute (${error?.message ?? error}); ` +
        'running anyway — the suite reports a database it cannot reach.',
    )
  }

  // Ten seconds after the wake, not after the attempt: a resume that already
  // took eight should not then wait another ten.
  const settle = Math.max(0, 10_000 - (Date.now() - started))
  if (settle > 0) {
    console.log(`Letting it settle for ${Math.round(settle / 1000)}s.`)
    await new Promise((resolve) => setTimeout(resolve, settle))
  }
}
