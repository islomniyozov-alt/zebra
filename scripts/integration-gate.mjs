import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { neonConfig, Pool } from '@neondatabase/serverless'
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

const SCRUBBED = ['DATABASE_URL', 'DIRECT_DATABASE_URL', 'NEON_BRANCH']

// ---------------------------------------------------------------------------
// ONE RUNNER PER DATABASE, ENFORCED BY POSTGRES RATHER THAN BY REMEMBERING.
//
// On 2026-08-19 a gate and a `deploy:prod` started FIFTEEN SECONDS APART
// against the same dev database. One reported 417 passed and the other failed
// in the audit suite; both results were void, because two suites mutating one
// database are not two experiments, they are one experiment with no control.
//
// THE GREEN ONE IS THE DANGEROUS HALF. A red run tells you something is wrong.
// A green run earned while another process was writing to the same tables
// tells you nothing at all and looks exactly like proof — it even wrote a
// receipt, which `deploy:prod` would have accepted.
//
// SO THE SUITE NOW TAKES A LOCK. `pg_try_advisory_lock` is session-scoped:
// held for as long as the connection lives, released the instant it dies, and
// therefore impossible to leave behind by killing the run with ^C — which is
// exactly what a lock row in a table would have got wrong the first time
// somebody interrupted a gate.
//
// The key is an arbitrary constant. It only has to be the same number in every
// copy of this file.
// ---------------------------------------------------------------------------

const RUNNER_LOCK_KEY = 8127346501

/** Keeps the lock's connection from being reaped during a ~55 minute run. */
const KEEPALIVE_MS = 60_000

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
 * Take the one-runner lock, or report who has it.
 *
 * Uses the DIRECT url from `.env` — the same file the suite itself reads, so
 * the lock is held on the database the suite will actually write to rather
 * than on whatever a terminal happened to export.
 */
async function acquireRunnerLock(directUrl) {
  neonConfig.poolQueryViaFetch = false
  const pool = new Pool({ connectionString: directUrl, max: 1 })

  // ONE CLIENT, CHECKED OUT AND HELD. An advisory lock belongs to a SESSION,
  // so it must be the same connection for the whole run; handing the query to
  // a pool that might rotate connections would take a lock and immediately
  // lose it.
  const client = await pool.connect()

  try {
    const held = await client.query('select pg_try_advisory_lock($1) as got', [
      RUNNER_LOCK_KEY,
    ])
    if (held.rows[0]?.got !== true) {
      // Who else is on it. Best-effort and purely for the message: the answer
      // can be stale by the time it is printed, and a wrong name is still more
      // useful than "locked".
      let who = ''
      try {
        const other = await client.query(
          `select application_name, client_addr, backend_start
             from pg_stat_activity
            where pid <> pg_backend_pid()
              and application_name like 'zebra-integration%'
            order by backend_start asc
            limit 1`,
        )
        const row = other.rows[0]
        if (row) {
          who =
            `
  The other runner: ${row.application_name}` +
            `${row.client_addr ? ` from ${row.client_addr}` : ''}` +
            `, started ${new Date(row.backend_start).toLocaleString()}.`
        }
      } catch {
        // pg_stat_activity is a nicety, not the mechanism.
      }
      client.release()
      await pool.end()
      return { ok: false, who }
    }

    // The name the OTHER runner will read out of pg_stat_activity.
    await client.query(
      `set application_name = 'zebra-integration ${hostname()} pid ${process.pid}'`,
    )

    const keepalive = setInterval(() => {
      client.query('select 1').catch(() => {})
    }, KEEPALIVE_MS)
    keepalive.unref?.()

    return {
      ok: true,
      async release() {
        clearInterval(keepalive)
        try {
          await client.query('select pg_advisory_unlock($1)', [RUNNER_LOCK_KEY])
        } catch {
          // Releasing on a dead connection is already released.
        }
        client.release()
        await pool.end().catch(() => {})
      },
    }
  } catch (error) {
    client.release()
    await pool.end().catch(() => {})
    throw error
  }
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

  // THE LOCK BEFORE THE FIFTY-FIVE MINUTES, not after them.
  const lock = await acquireRunnerLock(envFileValues().DIRECT_DATABASE_URL)
  if (!lock.ok) {
    console.error('')
    console.error('='.repeat(70))
    console.error('ANOTHER INTEGRATION RUN IS ALREADY USING THIS DATABASE.')
    console.error('')
    console.error(
      'Two suites mutating one database do not produce two results. They',
    )
    console.error(
      'produce one void result that can still come back GREEN — which is how',
    )
    console.error('a receipt got written for an uncontrolled run on')
    console.error('2026-08-19.')
    if (lock.who) console.error(lock.who)
    console.error('')
    console.error('Wait for it to finish, then run this again.')
    console.error('='.repeat(70))
    return { ok: false, endpoint: target.endpoint, receipt: null }
  }

  console.log('')

  try {
    const status = await new Promise((resolve) => {
      const proc = spawn('npx', ['vitest', 'run', '--project', 'integration'], {
        stdio: 'inherit',
        shell: true,
        env: child,
      })
      proc.on('close', (code) => resolve(code))
      proc.on('error', () => resolve(1))
    })

    if (status !== 0) {
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
  } finally {
    // RELEASED WHATEVER HAPPENED. A red suite that kept the lock would make
    // the next attempt look like a concurrency problem instead of a failure.
    await lock.release()
  }
}

// Runnable on its own: `npm run test:integration`.
if (process.argv[1] && process.argv[1].endsWith('integration-gate.mjs')) {
  const outcome = await runIntegrationSuite()
  process.exit(outcome.ok ? 0 : 1)
}
