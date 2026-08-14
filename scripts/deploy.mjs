import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { check as checkMigrationGap } from './check-migration-gap.mjs'

// ---------------------------------------------------------------------------
// DEPLOY, WITH THE COMMIT STAMPED ON THE VERSION.
//
// Two problems, one wrapper.
//
// THE FIRST is that `npm run deploy` used to mean dev, and nothing said so.
// A change was written, checked, deployed, verified — all against the worker
// that does not carry freight — and production sat a commit behind while every
// signal said "shipped". There is no bare `deploy` script any more: the
// environment is in the name of the command and cannot be defaulted into.
//
// THE SECOND is that a Cloudflare version id says nothing about what is in it.
// `--message` stamps the short commit on the version, which is what
// scripts/check-deploy-drift.mjs reads to tell you the two have diverged. A
// deploy from a dirty tree is stamped as such, because "which commit is live"
// has to be answerable including when the answer is "not one".
//
// THE THIRD is that `npm run check` does not run the integration suite, and
// cannot: it needs a database, and check is the thing you run twenty times an
// afternoon without thinking about what it will touch. That gap was silent
// until it wasn't — four extraction tests had been red since the engine switch
// (flag 41) while every gate anybody ran stayed green.
//
// So the integration suite gates the DEPLOY instead, which is the moment it is
// worth waiting minutes to be sure. `tests/setup.ts` refuses to run against
// the production branch, so this is the dev database either way — deploying to
// production does not test against production.
//
//   npm run deploy:dev
//   npm run deploy:prod
//   npm run deploy:prod -- --skip-integration   (see below; say why out loud)
// ---------------------------------------------------------------------------

const production = process.argv.includes('--production')
const target = production ? 'production' : 'dev'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

const sha = git('rev-parse', '--short', 'HEAD')
const dirty = git('status', '--porcelain').length > 0
const message = dirty ? `${sha}+dirty` : sha

console.log(`Deploying ${message} to ${target}.`)
if (dirty) {
  console.log(
    'The working tree has uncommitted changes; the version is stamped +dirty\n' +
      'so nobody later mistakes it for the commit it nearly is.',
  )
}

// SCHEMA BEFORE CODE, for production only.
//
// Step 2 shipped a column reference to production before the column existed.
// Nothing broke, which is the problem: the window was silent and closed only
// because no request reached that path. Dev is exempt — `migrate dev` runs
// against it constantly and a gap there is the normal state of an afternoon.
if (production) {
  const gap = await checkMigrationGap({
    confirmed: process.argv.includes('--migrations-applied'),
  })
  if (!gap.ok) {
    console.error('')
    console.error('Refusing to deploy code that is ahead of the schema.')
    process.exit(1)
  }
}

const run = (args) => {
  const result = spawnSync('npx', args, { stdio: 'inherit', shell: true })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

// ---------------------------------------------------------------------------
// THE GATE RUNS AGAINST `.env`, AND NOTHING THE TERMINAL IS CARRYING.
//
// `deploy:prod` was once run in a ritual terminal whose `DIRECT_DATABASE_URL`
// pointed at production. The child process inherited it, `DATABASE_URL` still
// came from `.env`, and the suite ran SPLIT-BRAINED — fixtures written to
// production, the application reading dev. 237 of 405 failed with foreign-key
// violations and organizations that could not see their own rows. The gate
// refused and nothing shipped, which is the system working; that the suite got
// as far as writing to production is the part that must never repeat.
//
// SCRUBBED, NOT WARNED ABOUT. The three variables that decide where the suite
// writes are DELETED from the child's environment, so `.env` — read by
// `tests/setup.ts` through dotenv, which does not override — is the only
// possible source. A terminal's leftovers cannot aim this at anything.
//
// AND THEN CHECKED ANYWAY, because scrubbing only fixes the environment; it
// says nothing about whether `.env` ITSELF is pointing somewhere dangerous.
// ---------------------------------------------------------------------------

/** `.env`, parsed just enough. Not loaded into this process — deploy needs the
 *  ambient environment for wrangler, and importing dotenv here would merge the
 *  two things this function exists to keep apart. */
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
function endpointOf(url) {
  const { hostname } = new URL(url)
  const [first, ...rest] = hostname.split('.')
  return [first.replace(/-pooler$/, ''), ...rest].join('.')
}

const SCRUBBED = ['DATABASE_URL', 'DIRECT_DATABASE_URL', 'NEON_BRANCH']

function integrationEnv() {
  const child = { ...process.env }
  const carried = SCRUBBED.filter((name) => child[name] !== undefined)
  for (const name of SCRUBBED) delete child[name]

  if (carried.length > 0) {
    console.log('')
    console.log(
      `Ignoring ${carried.join(', ')} from this terminal — the gate reads .env.`,
    )
  }

  // What the child WILL see, which is `.env` and only `.env`.
  const file = envFileValues()
  const pooled = file.DATABASE_URL
  const direct = file.DIRECT_DATABASE_URL

  if (!pooled || !direct) {
    console.error('')
    console.error('.env is missing DATABASE_URL or DIRECT_DATABASE_URL.')
    process.exit(1)
  }

  let a
  let b
  try {
    a = endpointOf(pooled)
    b = endpointOf(direct)
  } catch {
    console.error('')
    console.error('.env has a DATABASE_URL that is not a URL.')
    process.exit(1)
  }

  // THE CHECK THAT WOULD HAVE CAUGHT THE INCIDENT even without the scrub: two
  // different endpoints means the fixtures and the application are looking at
  // two different databases, whatever any label says.
  if (a !== b) {
    console.error('')
    console.error('Refusing: .env names two different database endpoints.')
    console.error(`  DATABASE_URL        -> ${a}`)
    console.error(`  DIRECT_DATABASE_URL -> ${b}`)
    process.exit(1)
  }

  if ((file.NEON_BRANCH ?? '').trim().toLowerCase() === 'production') {
    console.error('')
    console.error('Refusing: .env says NEON_BRANCH=production.')
    process.exit(1)
  }

  console.log(`The gate will write to ${a} (from .env).`)
  return child
}

// THE INTEGRATION GATE (owner's ruling). Before the build, because a refusal
// after a thirty-second bundle is a refusal that trains people to skip it.
if (process.argv.includes('--skip-integration')) {
  // AN ESCAPE HATCH THAT COSTS A SENTENCE. Neon can be down, or the machine
  // can have no credentials, and a gate with no way past it is a gate somebody
  // edits out of the script. It is loud, it is never the default, and it is
  // not stamped on the version — `check-deploy-drift` reports commits, and
  // what was verified before a deploy belongs in the report you are reading
  // now rather than encoded in a version message.
  console.log('')
  console.log('!! SKIPPING THE INTEGRATION SUITE.')
  console.log(
    '   Nothing has proved this build against a database. Say so in the report,',
  )
  console.log('   and run `npm run test:integration` when you can.')
  console.log('')
} else {
  console.log('')
  console.log('Running the integration suite before anything is built.')
  console.log(
    'It writes to the DEV branch — tests/setup.ts refuses production.',
  )
  const integration = spawnSync(
    'npx',
    ['vitest', 'run', '--project', 'integration'],
    { stdio: 'inherit', shell: true, env: integrationEnv() },
  )
  if (integration.status !== 0) {
    console.error('')
    console.error(
      `Refusing to deploy to ${target}: the integration suite is red.`,
    )
    console.error(
      'Fix it, or deploy with --skip-integration and say why in the report.',
    )
    process.exit(1)
  }
}

run(['opennextjs-cloudflare', 'build'])
run([
  'opennextjs-cloudflare',
  'deploy',
  '--',
  ...(production ? ['--env', 'production'] : []),
  '--message',
  message,
])

console.log(
  `\nDeployed to ${target}. The OTHER worker is unchanged — that is the point` +
    ' of the two commands.\nRun `node scripts/check-deploy-drift.mjs` to see where both stand.',
)
