import { execFileSync } from 'node:child_process'
import { classify } from './deploy-drift-rules.mjs'

// ---------------------------------------------------------------------------
// WHERE EACH WORKER STANDS AGAINST THIS COMMIT.
//
// A version id tells you a deploy happened. It does not tell you what is in
// it, and it certainly does not tell you that PRODUCTION is a commit behind
// while dev is current — which is how the Telegram share action came to pass
// every check, every screenshot and a live check, on the worker that carries
// no freight.
//
// `scripts/deploy.mjs` stamps the short commit on the version with
// `--message`. This reads it back for both workers and says the three things
// worth knowing: what is deployed, whether it matches HEAD, and — the part
// that matters — whether the commits in between touched `src/`.
//
// INFORMATIONAL, AND IT EXITS 0 EVEN WHEN IT SHOUTS. It runs inside
// `npm run check`, which runs constantly during development, where being
// ahead of production is the normal state of the world rather than a fault. A
// gate that fails on the normal state is a gate people learn to skip. It is
// loud when production trails a src/ change and quiet otherwise, and the
// loudness is the whole mechanism.
//
// It is also quiet about NETWORK failure. No Cloudflare, no answer, no
// opinion — `npm run check` must work on a plane.
// ---------------------------------------------------------------------------

const ENVIRONMENTS = [
  { label: 'dev', worker: 'zebra-dev', args: [] },
  { label: 'production', worker: 'zebra', args: ['--env', 'production'] },
]

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

const wrangler = (args) => {
  const out = execFileSync(
    'npx',
    ['wrangler', ...args, '--json'],
    // Wrangler writes its banner to stderr; only stdout is parsed.
    { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'ignore'] },
  )
  return JSON.parse(out)
}

const head = git('rev-parse', '--short', 'HEAD')
console.log(`HEAD is ${head}`)

let productionTrailsSource = false

for (const environment of ENVIRONMENTS) {
  let deployedMessage = null
  let versionId = null

  try {
    // The DEPLOYED version, not merely the most recently uploaded one — an
    // upload that was never promoted is not what anybody is serving.
    const deployments = wrangler(['deployments', 'list', ...environment.args])
    const newest = [...deployments].sort((a, b) =>
      String(b.created_on).localeCompare(String(a.created_on)),
    )[0]
    versionId = newest?.versions?.[0]?.version_id ?? null

    const versions = wrangler(['versions', 'list', ...environment.args])
    const version = versions.find((candidate) => candidate.id === versionId)
    deployedMessage = version?.annotations?.['workers/message'] ?? null
  } catch {
    console.log(`  ${environment.label.padEnd(11)} could not be read`)
    continue
  }

  const shortVersion = versionId ? versionId.slice(0, 8) : '(unknown)'

  if (!deployedMessage) {
    // Deployed before this stamping existed, or by something other than
    // scripts/deploy.mjs. Not a fault, just unanswerable.
    console.log(
      `  ${environment.label.padEnd(11)} ${shortVersion}  commit unknown (deployed without a message)`,
    )
    continue
  }

  const commit = deployedMessage.replace('+dirty', '')
  const isKnownCommit = (() => {
    try {
      git('cat-file', '-e', `${commit}^{commit}`)
      return true
    } catch {
      return false
    }
  })()

  const changedSourceFiles = isKnownCommit
    ? git('diff', '--name-only', `${commit}..HEAD`, '--', 'src/')
        .split('\n')
        .filter(Boolean)
    : []

  const verdict = classify({
    label: environment.label,
    deployedMessage,
    head,
    isKnownCommit,
    changedSourceFiles,
  })
  const prefix = `  ${environment.label.padEnd(11)} ${shortVersion}  ${deployedMessage}`

  if (verdict.state === 'current') {
    console.log(`${prefix} — matches HEAD`)
    continue
  }
  if (verdict.state === 'unknown-commit') {
    console.log(`${prefix} — not a commit in this clone`)
    continue
  }

  const behind = git('rev-list', '--count', `${commit}..HEAD`)
  console.log(
    `${prefix} — ${behind} commit(s) behind HEAD` +
      (changedSourceFiles.length > 0
        ? `, ${changedSourceFiles.length} file(s) under src/`
        : ', none under src/'),
  )

  if (verdict.loud) {
    productionTrailsSource = true
    for (const file of changedSourceFiles.slice(0, 8))
      console.log(`                  ${file}`)
    if (changedSourceFiles.length > 8)
      console.log(
        `                  ... and ${changedSourceFiles.length - 8} more`,
      )
  }
}

if (productionTrailsSource) {
  console.log(
    '\n  ' +
      '='.repeat(70) +
      '\n  PRODUCTION IS BEHIND, AND THE DIFFERENCE INCLUDES APPLICATION CODE.' +
      '\n  If you meant to ship it:  npm run deploy:prod' +
      '\n  ' +
      '='.repeat(70),
  )
}

// Always 0. See the note at the top: this reports, it does not gate.
process.exit(0)
