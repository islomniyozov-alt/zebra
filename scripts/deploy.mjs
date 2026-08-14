import { execFileSync, spawnSync } from 'node:child_process'
import { check as checkMigrationGap } from './check-migration-gap.mjs'
import { runIntegrationSuite, resolveEndpoint } from './integration-gate.mjs'
import {
  checkReceipt,
  readReceipt,
  workingCopy,
} from './integration-receipt.mjs'

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
const deployTarget = production ? 'production' : 'dev'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

const sha = git('rev-parse', '--short', 'HEAD')
const dirty = git('status', '--porcelain').length > 0
const message = dirty ? `${sha}+dirty` : sha

console.log(`Deploying ${message} to ${deployTarget}.`)
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

// THE INTEGRATION GATE (owner's ruling). Before the build, because a refusal
// after a thirty-second bundle is a refusal that trains people to skip it.
//
// A RECEIPT CAN STAND IN FOR THE RUN. The suite costs 54 minutes — measured,
// 405 tests, 3254 seconds — and proving the same commit twice in ten minutes
// is most of an hour spent learning nothing. `scripts/integration-receipt.mjs`
// holds the four conditions that keep that from becoming a hole.
if (process.argv.includes('--skip-integration')) {
  // AN ESCAPE HATCH THAT COSTS A SENTENCE. Neon can be down, or the machine
  // can have no credentials, and a gate with no way past it is a gate somebody
  // edits out of the script. It is loud, it is never the default, and it
  // EARNS NO RECEIPT — there is deliberately no path from "I did not run it"
  // to "it was run".
  console.log('')
  console.log('!! SKIPPING THE INTEGRATION SUITE.')
  console.log(
    '   Nothing has proved this build against a database. Say so in the report,',
  )
  console.log('   and run `npm run test:integration` when you can.')
  console.log('')
} else {
  const target = resolveEndpoint()
  if (!target.ok) {
    console.error('')
    console.error(`Refusing to deploy to ${deployTarget}: ${target.message}`)
    process.exit(1)
  }

  const { commit, clean } = workingCopy()
  const verdict = checkReceipt({
    receipt: readReceipt(),
    now: Date.now(),
    head: commit,
    clean,
    endpoint: target.endpoint,
  })

  if (verdict.ok) {
    console.log('')
    console.log('='.repeat(70))
    console.log(
      `USING A RECEIPT: ${commit.slice(0, 7)} passed the integration suite ${verdict.ageMinutes} minute(s) ago,`,
    )
    console.log(
      `on a clean tree, against ${target.endpoint}. The suite is NOT being re-run.`,
    )
    console.log('='.repeat(70))
    console.log('')
  } else {
    console.log('')
    console.log(`Running the integration suite: ${verdict.message}`)

    const outcome = runIntegrationSuite()
    if (!outcome.ok) {
      console.error('')
      console.error(
        `Refusing to deploy to ${deployTarget}: the integration suite is red.`,
      )
      console.error(
        'Fix it, or deploy with --skip-integration and say why in the report.',
      )
      process.exit(1)
    }
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
  `\nDeployed to ${deployTarget}. The OTHER worker is unchanged — that is the point` +
    ' of the two commands.\nRun `node scripts/check-deploy-drift.mjs` to see where both stand.',
)
