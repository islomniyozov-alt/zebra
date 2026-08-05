import { execFileSync, spawnSync } from 'node:child_process'
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
//   npm run deploy:dev
//   npm run deploy:prod
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
