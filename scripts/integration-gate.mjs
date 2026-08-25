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
      const proc = spawn(
        process.execPath,
        [VITEST_ENTRY, 'run', '--project', 'integration'],
        { stdio: 'inherit', env: child },
      )
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
