import { spawnSync } from 'node:child_process'
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
export function runIntegrationSuite() {
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

  const result = spawnSync(
    'npx',
    ['vitest', 'run', '--project', 'integration'],
    { stdio: 'inherit', shell: true, env: child },
  )

  if (result.status !== 0) {
    return { ok: false, endpoint: target.endpoint, receipt: null }
  }

  const receipt = writeReceipt({ endpoint: target.endpoint })
  console.log('')
  console.log(
    `Receipt written: ${receipt.commit.slice(0, 7)}${receipt.clean ? '' : ' (DIRTY — will not be accepted)'} at ${receipt.finishedAt}`,
  )
  if (receipt.clean) {
    console.log('`npm run deploy:prod` will accept it for the next hour.')
  }

  return { ok: true, endpoint: target.endpoint, receipt }
}

// Runnable on its own: `npm run test:integration`.
if (process.argv[1] && process.argv[1].endsWith('integration-gate.mjs')) {
  const outcome = runIntegrationSuite()
  process.exit(outcome.ok ? 0 : 1)
}
