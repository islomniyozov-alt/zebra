import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readFileSync, rmSync } from 'node:fs'
import { workingCopy, writeReceipt } from './integration-receipt.mjs'

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
 * What changed under a run, or `null` if nothing did.
 *
 * A FUNCTION RATHER THAN AN INLINE COMPARISON, so both of its answers can be
 * watched. The "nothing moved" branch is exercised by every green gate; the
 * "something moved" branch would otherwise only ever run on the day it matters,
 * which is the definition of a guard nobody has seen work.
 */
export function describeTreeMovement(before, after) {
  if (after.commit !== before.commit) {
    return (
      `The working tree MOVED during the run: started at ` +
      `${before.commit.slice(0, 7)}, finished at ${after.commit.slice(0, 7)}.`
    )
  }
  if (!after.clean) {
    return (
      `The working tree was EDITED during the run: still at ` +
      `${before.commit.slice(0, 7)}, but no longer clean.`
    )
  }
  return null
}

/**
 * Run the suite. Returns `{ ok, endpoint, receipt }`.
 *
 * A RECEIPT IS WRITTEN ONLY ON A GREEN RUN, and only after the runner has
 * exited — the timestamp is the finish, not the start.
 */
export async function runIntegrationSuite() {
  // ---------------------------------------------------------------------
  // REFUSE TO START ON A DIRTY TREE, AND REMEMBER WHAT WAS COMMITTED.
  //
  // A receipt describes a commit. A gate started on a dirty tree can only ever
  // produce `clean: false` — fourteen minutes spent to learn something knowable
  // in nine milliseconds — and a gate whose tree MOVES mid-run is worse: it
  // finishes green and writes a receipt for a commit the suite never ran.
  //
  // THIS EXISTS BECAUSE THE AUTHOR DID IT THREE TIMES IN ONE DAY (2026-09-05),
  // each time knowing the rule. The third was minutes after writing the note
  // saying not to. That is the session's own lesson applied inward: the answer
  // to a repeated lapse is a mechanism, not a firmer intention — so the gate
  // now holds the constraint instead of the person starting it.
  // ---------------------------------------------------------------------
  const before = workingCopy()
  if (!before.clean) {
    console.error('')
    console.error(
      'Refusing to start: the working tree is dirty. A gate on a dirty tree ' +
        'can only produce a receipt that will be rejected.',
    )
    console.error(
      execFileSync('git', ['status', '--short'], {
        encoding: 'utf8',
      }).trimEnd(),
    )
    console.error('Commit or stash, then re-run.')
    return { ok: false, endpoint: null, receipt: null }
  }
  console.log(`Tree clean at ${before.commit.slice(0, 7)}.`)

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

  // WAKE IT AND WAIT FOR READY BEFORE THE CLOCK STARTS. See warmCompute below.
  if (!(await warmCompute(envFileValues().DIRECT_DATABASE_URL))) {
    console.error('')
    console.error(
      'Refusing to run the integration suite: the compute never reached a ' +
        'steady state. Running now would spend fourteen minutes producing ' +
        'failures that describe the database rather than the code — which is ' +
        'what five of eight gates on 2026-09-05 did.',
    )
    return { ok: false, endpoint: target.endpoint, receipt: null }
  }

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
      // THIS RUN OWNS THE LOG, SO THIS RUN CLEARS IT. The reporter only ever
      // appends: it used to clear on init, and a node-project run started while
      // a gate was mid-flight wiped fourteen recorded failures and left one of
      // its own, which the gate then printed as though it were the gate's.
      child.ZEBRA_FAILURE_LOG = FAILURE_LOG
      try {
        rmSync(FAILURE_LOG, { force: true })
      } catch {
        // A log that will not clear is one this run will append to. Not worth
        // refusing a fourteen-minute gate over.
      }

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

    // DID THE TREE MOVE UNDER THE RUN? `writeReceipt` reads HEAD when it is
    // called, so a commit made during the fourteen minutes would be stamped as
    // the thing that passed — a green receipt for code no test ever saw. That
    // is the one failure mode here that is silent AND wrong, so it is checked
    // rather than trusted.
    const moved = describeTreeMovement(before, workingCopy())
    if (moved) {
      console.error('')
      console.error(moved)
      console.error(
        'No receipt written. The suite ran the earlier tree, so a receipt ' +
          'would vouch for code that was never tested. Re-run on a settled tree.',
      )
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
 * WHAT THIS DOES, plainly: it moves the RESUME out of the run, AND THEN WAITS
 * FOR THE COMPUTE TO BE READY RATHER THAN MERELY AWAKE. Those are different
 * states and the difference cost four gates.
 *
 * "AWAKE" WAS THE WRONG READING OF ITS OWN NUMBERS. This function used to wake
 * the compute and settle for a flat ten seconds, while the comment three lines
 * up recorded a degraded window of about five minutes. Ten seconds does not
 * cross five minutes; it just enters it holding a receipt that says "awake". On
 * 2026-09-05 a gate printed `Compute awake in 2636ms; it has been up 0s` and
 * then lost all 29 files in twelve seconds, having warmed the compute
 * successfully and walked straight into the window.
 *
 * THIS IS PERMANENT, NOT A STOPGAP. Scale-to-zero after five idle minutes is
 * fixed on the Neon Launch plan; only Scale makes it configurable, at a typical
 * $701/mo, which is not a price for a test database. The owner decided against
 * it on 2026-09-04. So this, the socket-crash guard, the failure log and the
 * `withOrg` start-transaction retry are the answer rather than the interim
 * measure — nobody is coming to remove the condition they exist for.
 *
 * THE RESIDUAL IS A DROP DURING `globalSetup`, which nothing at this layer can
 * survive: there is no test running to fail, so the run dies before it starts.
 * Five of eight gates on 2026-09-05 died exactly there.
 *
 * SO IT NOW REFUSES, AND THAT REVERSES WHAT THIS COMMENT USED TO SAY. The old
 * text argued that a warm-up able to refuse would be "a new way to lose fourteen
 * minutes". That was wrong in one direction: refusing costs the five minutes
 * already spent probing and says why, while proceeding into a degraded compute
 * costs the fourteen AND produces 29 red files that name the wrong culprit. The
 * expensive outcome was always the quiet one.
 *
 * THE THRESHOLDS BELOW ARE MEASURED, NOT CHOSEN. Each cites where its number
 * came from; none of them is a feel. If they need changing, re-measure with
 * `scripts/measure-neon.mjs` and change the citation with the constant.
 */

/**
 * TWO NUMBERS, BECAUSE A PROBE MEASURES TWO DIFFERENT THINGS.
 *
 * THIS IS THE CORRECTION OF A REAL MISTAKE, RECORDED BECAUSE IT NEARLY
 * SHIPPED. The first version of this check timed a fresh connection and
 * compared it against 400ms, citing `measure-neon.mjs`'s 193–203ms. But that
 * baseline was taken on an ESTABLISHED pool: it is query latency alone, while
 * the probe was measuring TCP + TLS + WebSocket + auth + query. Threshold from
 * one quantity, measurement of a superset of it — flags 88 and 92's shape,
 * applied to a brand-new instrument.
 *
 * It was caught by watching it run against a HEALTHY compute, where it sat at
 * a metronomic 795, 791, 792, 784ms and refused to be satisfied. As written it
 * would have refused every gate forever, and the refusal would have looked
 * exactly like the Neon instability it was built to detect.
 *
 * MEASURED 2026-09-05, ten fresh pools, three queries each, same branch:
 *   first query on a fresh pool  — min 735, median 759, max 1409 ms
 *   subsequent queries on it     — min 184, median 192, max  205 ms
 *
 * The second row reproduces `measure-neon.mjs` exactly, which is what makes
 * the first row trustworthy: the compute was healthy while both were taken.
 * So connecting costs ~560ms more than querying, always, and that cost is not
 * a symptom of anything.
 */

/** Fresh connect + first query. Median 759ms healthy; 2× that, rounded. */
const READY_CONNECT_MS = 1_500

/** Steady-state query on that same pool. Median 192ms healthy; 2× that. */
const READY_QUERY_MS = 400

/**
 * A single probe cannot outlive this, so the cap below means what it says.
 * Found by watching the refusal path: `READY_CAP_MS` bounds the LOOP, and a
 * connect that hangs rather than failing would sail past it — the guard's own
 * budget escaping through the one call it does not bound.
 */
const READY_PROBE_TIMEOUT_MS = 10_000

/**
 * THREE CONSECUTIVE, because the failure being screened for is intermittent.
 * The post-resume window is not uniformly slow; it is normal-then-stalling, so
 * ONE fast probe proves nothing at all — it is the state the dead gates were in
 * when they started. Three in a row, a second apart, is the cheapest evidence
 * that the compute is steadily fast rather than momentarily fast.
 */
const READY_STREAK = 3

/** A second between probes, so the streak spans time instead of one instant. */
const READY_PROBE_GAP_MS = 1_000

/**
 * FIVE MINUTES, because that is the measured width of the degraded window
 * (2026-09-04). A cap shorter than the window would refuse computes that were
 * about to become healthy; a cap longer would wait past the point where
 * something other than a resume is wrong. Waiting five minutes and refusing
 * beats spending fourteen and blaming the code.
 */
const READY_CAP_MS = 300_000

/** How often to say it is still waiting. Silence reads as a hang. */
const READY_REPORT_EVERY_MS = 30_000
export async function warmCompute(directUrl) {
  const started = Date.now()
  const { neonConfig, Pool } = await import('@neondatabase/serverless')
  neonConfig.webSocketConstructor ??= WebSocket
  neonConfig.poolQueryViaFetch = false

  const samples = []
  let streak = 0
  let announced = false
  let lastSpoke = 0

  const elapsed = () => Date.now() - started
  const seconds = (ms) => (ms / 1000).toFixed(1)
  /** The last handful, which is the part that decided the outcome. */
  const recent = () => samples.slice(-8).join(', ')

  while (elapsed() < READY_CAP_MS) {
    // A FRESH POOL PER PROBE, DELIBERATELY. Reusing one would measure an
    // established socket, and an established socket is not what the suite
    // opens: eight workers each connect from cold. The degraded window drops
    // NEW connections, so the probe has to be a new connection to see it.
    const pool = new Pool({ connectionString: directUrl, max: 1 })
    pool.on('error', () => {})
    const probeStarted = Date.now()
    try {
      // BOUNDED, so a connect that hangs cannot outlast the cap.
      const deadline = new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`no answer in ${READY_PROBE_TIMEOUT_MS}ms`)),
          READY_PROBE_TIMEOUT_MS,
        ).unref(),
      )

      // FIRST QUERY: pays the connection. SECOND: pays only the round trip.
      // Both are judged, against their own measured baselines, because the
      // suite does both — eight workers connect from cold and then run
      // thousands of queries on what they opened.
      const { rows } = await Promise.race([
        pool.query(
          'select extract(epoch from now() - pg_postmaster_start_time())::int as uptime_s',
        ),
        deadline,
      ])
      const connectMs = Date.now() - probeStarted

      const queryStarted = Date.now()
      await Promise.race([pool.query('select 1'), deadline])
      const queryMs = Date.now() - queryStarted

      samples.push(`${connectMs}/${queryMs}ms`)
      streak =
        connectMs <= READY_CONNECT_MS && queryMs <= READY_QUERY_MS
          ? streak + 1
          : 0

      if (!announced) {
        announced = true
        const uptime = rows[0]?.uptime_s ?? -1
        console.log(
          `Compute answered after ${seconds(elapsed())}s; it has been up ${uptime}s.` +
            (uptime < 30 ? ' (it had suspended — this run resumed it)' : ''),
        )
      }
    } catch (error) {
      // NAME IT EVEN WHEN IT HAS NO MESSAGE. Neon's dropped-socket failure
      // arrives as an `ErrorEvent` whose `message` is the empty string, so
      // `error?.message ?? error` printed "Could not warm the compute ()" — a
      // line that says something went wrong and refuses to say what. The
      // constructor name is the part that identifies it.
      const said =
        (error && typeof error === 'object' && 'message' in error
          ? String(error.message)
          : '') || `${error?.constructor?.name ?? typeof error} with no message`
      samples.push(`FAILED(${said})`)
      // A REFUSED CONNECTION IS THE STRONGEST "NOT READY" THERE IS, so it
      // resets the streak rather than ending the wait. This is the one place a
      // dropped socket is information instead of a casualty.
      streak = 0
    } finally {
      await pool.end().catch(() => {})
    }

    // SAY SOMETHING WHILE WAITING. Found by watching this refuse: against an
    // unreachable compute it printed NOTHING for five minutes, which is
    // indistinguishable from a hang — and a gate that looks hung gets killed by
    // the person who most needs to read its verdict.
    if (elapsed() - lastSpoke >= READY_REPORT_EVERY_MS) {
      lastSpoke = elapsed()
      console.log(
        `  still waiting at ${seconds(elapsed())}s of ${seconds(READY_CAP_MS)}s ` +
          `(streak ${streak}/${READY_STREAK}): ${recent()}`,
      )
    }

    if (streak >= READY_STREAK) {
      console.log(
        `Compute READY after ${seconds(elapsed())}s — ` +
          `${READY_STREAK} consecutive probes under ${READY_CONNECT_MS}ms connect / ${READY_QUERY_MS}ms query. ` +
          `Saw: ${recent()}`,
      )
      return true
    }

    await new Promise((resolve) => setTimeout(resolve, READY_PROBE_GAP_MS))
  }

  // REFUSE, LOUDLY, AND SAY WHAT IT SAW. The samples are the diagnosis: all
  // FAILED means the branch is unreachable, alternating means the post-resume
  // window is still open, uniformly slow means something else is wrong. A bare
  // "not ready" would send the next person to measure what this already knows.
  console.log(
    `Compute NOT READY after ${seconds(elapsed())}s (cap ${seconds(READY_CAP_MS)}s). ` +
      `Never saw ${READY_STREAK} consecutive probes under ${READY_CONNECT_MS}ms connect / ${READY_QUERY_MS}ms query. ` +
      `Last probes: ${recent()}`,
  )
  return false
}
