import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// ARE THE CREDENTIALS I AM HOLDING THE RIGHT ONES, FOR THE TARGET I MEAN?
//
//   node scripts/verify-secrets.mjs --target=production
//   node scripts/verify-secrets.mjs --target=dev
//
// Written for `docs/SECRET-ROTATION.md` step "verify before revoking", which is
// the step whose absence is how a rotation takes an application down: the old
// token is deleted, the new one was never actually proved, and the first person
// to learn is a dispatcher uploading a POD.
//
// ── WHAT THIS ADDS OVER THE TWO SCRIPTS IT RUNS ──────────────────────────
//
// `check-connection.mjs` proves a connection string connects. `check-r2.mjs`
// proves a key pair can read and write a bucket. Both are good and neither asks
// the question a ROTATION turns on: IS THIS THE TARGET I MEANT?
//
// A rotation is exactly when that goes wrong. `.env` holds the DEV values, so
// the easy mistake — and the one this project has already made in other forms
// three times — is to verify dev, see a row of ticks, and revoke production's
// old token on the strength of it.
//
// So the expectations come from `wrangler.jsonc`, which is COMMITTED, diffable,
// and holds the bucket, the endpoint and the branch per environment because
// none of those is a secret. Nothing here asks the operator to retype what the
// target should be; it reads what the deployment says and compares.
//
// ── IT PRINTS NO SECRET, ON ANY PATH ─────────────────────────────────────
//
// Every line is a boolean, a count, a hostname or a bucket name. The children's
// output is passed through a scrubber keyed on the values this process holds —
// belt and braces, since both children are already careful, and because the one
// leak that mattered on this project came from a library printing a config
// object rather than from a line anybody wrote. `tests/verify-secrets.test.ts`
// runs this with canary values and greps the output for them.
//
// IT CHANGES NOTHING. Two reads and an R2 probe object that is deleted again.
// ---------------------------------------------------------------------------

const HERE = fileURLToPath(new URL('.', import.meta.url))

const target = (
  process.argv.find((a) => a.startsWith('--target=')) ?? ''
).split('=')[1]

if (target !== 'production' && target !== 'dev') {
  console.error(
    'Usage: node scripts/verify-secrets.mjs --target=production|dev\n' +
      '  The target is named explicitly and never inferred. A rotation is\n' +
      '  exactly when "whichever one is in my shell" is the wrong answer.',
  )
  process.exit(2)
}

// ── THE EXPECTATIONS, FROM THE COMMITTED DEPLOYMENT FILE ──────────────────
//
// JSONC: LINE COMMENTS AND TRAILING COMMAS BOTH COME OUT, and the second one is
// what the first version of this forgot — `JSON.parse` threw on a trailing comma
// three lines into the file.
//
// THE SAME STRIP AS `tests/audit-sink.test.ts`, deliberately, including what it
// does NOT handle: block comments are not used in that file, and a parser that
// accepts more than the file contains is a parser that can drift from what
// wrangler itself reads. Two copies of six lines rather than a shared module,
// because the alternative is a `scripts/` import from `tests/` or a new
// dependency, and this reads two strings out of a file in this repository.
function wranglerVars(environment) {
  const raw = readFileSync(
    new URL('../wrangler.jsonc', import.meta.url),
    'utf8',
  )
  const stripped = raw
    .split('\n')
    .map((line) => (line.trimStart().startsWith('//') ? '' : line))
    .join('\n')
    .replace(/,(\s*[}\]])/g, '$1')
  const config = JSON.parse(stripped)
  return environment === 'production'
    ? { ...config.vars, ...(config.env?.production?.vars ?? {}) }
    : config.vars
}

const expected = wranglerVars(target)
const expectedBucket = expected.R2_BUCKET
const expectedBranch = expected.NEON_BRANCH
const expectedEndpoint = expected.R2_ENDPOINT

console.log(`target            ${target}`)
console.log(`expected bucket   ${expectedBucket}`)
console.log(`expected branch   ${expectedBranch}`)
console.log('')

/**
 * Nothing derived from a secret may reach the output. Children included.
 *
 * ── DEFENCE IN DEPTH, AND NOT A WATCHED GUARD ────────────────────────────
 *
 * Removing this scrubber leaks nothing today: `check-connection.mjs` and
 * `check-r2.mjs` both scrub their own output carefully, the first of them after
 * a real leak that printed two passwords into scrollback. A break that deletes
 * these lines was watched and did NOT fire, so it is not claimed as a guard —
 * what the canary tests prove is that the OUTPUT is clean, which is the property
 * that matters whichever layer achieves it.
 *
 * It stays because the next child added here may not be as careful, and because
 * the one leak that mattered on this project came from a library printing a
 * config object rather than from a line anybody wrote.
 */
const secrets = [
  process.env.ZEBRA_TEST_URL,
  process.env.R2_ACCESS_KEY_ID,
  process.env.R2_SECRET_ACCESS_KEY,
].filter((value) => typeof value === 'string' && value.length > 0)

function scrub(text) {
  let safe = text
  for (const secret of secrets) safe = safe.replaceAll(secret, '<redacted>')
  // The password inside the connection string, which is not the whole string
  // and therefore not caught by the loop above.
  const password = process.env.ZEBRA_TEST_URL?.match(
    /^[^:]+:\/\/[^:]+:([^@]+)@/,
  )?.[1]
  if (password) safe = safe.replaceAll(password, '<redacted>')
  return safe
}

/** Run one of the existing checks, scrubbed, and report whether it passed. */
function runCheck(label, script, env) {
  const result = spawnSync(process.execPath, [`${HERE}${script}`], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  })
  const output = scrub(`${result.stdout ?? ''}${result.stderr ?? ''}`)
  for (const line of output.split('\n')) {
    if (line.trim() !== '') console.log(`  ${line}`)
  }
  const ok = result.status === 0
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  console.log('')
  return ok
}

const failures = []

// ── 1. THE DATABASE URL ───────────────────────────────────────────────────
console.log('── DATABASE_URL ─────────────────────────────────────────────')
const url = process.env.ZEBRA_TEST_URL
if (!url) {
  console.log(
    '  SKIPPED — set ZEBRA_TEST_URL to the connection string you are about to\n' +
      '  store, or have just stored, on the worker. It is passed on the command\n' +
      '  and never written to .env.',
  )
  failures.push('DATABASE_URL not checked')
} else {
  let parsed = null
  try {
    parsed = new URL(url)
  } catch {
    // The value is deliberately not described here: `check-connection.mjs`
    // already does that carefully, and it is about to run.
    console.log('  not a URL — see the detail below')
  }

  if (parsed) {
    // THE ROLE IS THE WHOLE POINT. `src/lib/db.ts` refuses to start unless the
    // application connects as `zebra_app`, so a rotation that produced an owner
    // URL would deploy and then fail closed on the first request.
    const roleOk = parsed.username === 'zebra_app'
    console.log(
      `  ${roleOk ? 'ok  ' : 'FAIL'}  role is ${parsed.username}${roleOk ? '' : ' — expected zebra_app'}`,
    )
    if (!roleOk) failures.push('DATABASE_URL role is not zebra_app')

    // POOLED, because that is what the worker uses. A direct URL here still
    // connects, so nothing would fail until the pool was the thing that mattered.
    const pooledOk = parsed.hostname.includes('-pooler')
    console.log(
      `  ${pooledOk ? 'ok  ' : 'FAIL'}  endpoint ${parsed.hostname.split('.')[0]}${
        pooledOk ? '' : ' — expected the POOLED host for the application'
      }`,
    )
    if (!pooledOk) failures.push('DATABASE_URL is not the pooled endpoint')

    // ── AND IT MUST NOT BE THE ONE `.env` POINTS AT, WHEN THE TARGET IS
    //    PRODUCTION ─────────────────────────────────────────────────────────
    //
    // NOTHING COMMITTED NAMES PRODUCTION'S DATABASE ENDPOINT — it only exists
    // inside the secret — so this cannot assert the endpoint is right. What it
    // CAN do is catch the mistake that actually happens: `.env` loaded, the dev
    // URL pasted, and the operator believing they are verifying production. The
    // bucket check below would catch it too; this catches it when only the
    // database half is being rotated.
    //
    // THE SAME FOLD AS `endpointOf` IN `tests/db-target.ts`, which exists
    // because the pooled and direct hostnames are two doors of one endpoint.
    // Four lines rather than an import, because that module is TypeScript and
    // this is a `.mjs` script; its twin is named here so neither drifts alone.
    const endpointOf = (value) => {
      const [first, ...rest] = new URL(value).hostname.split('.')
      return [(first ?? '').replace(/-pooler$/, ''), ...rest].join('.')
    }
    const envUrl = process.env.DATABASE_URL
    if (target === 'production' && envUrl) {
      try {
        const same = endpointOf(envUrl) === endpointOf(url)
        if (same) {
          console.log(
            '  FAIL  this is the endpoint DATABASE_URL in .env points at —\n' +
              "        .env holds DEV, so this is dev's database, not production's",
          )
          failures.push('ZEBRA_TEST_URL names the same endpoint as .env (dev)')
        } else {
          console.log('  ok    not the endpoint .env points at')
        }
      } catch {
        // An unparseable `.env` value is not this script's problem to report.
      }
    }
  }

  if (!runCheck('DATABASE_URL connects', 'check-connection.mjs', {})) {
    failures.push('DATABASE_URL did not connect')
  }
}

// ── 2. THE R2 KEY PAIR ────────────────────────────────────────────────────
console.log('── R2 ───────────────────────────────────────────────────────')
const bucket = process.env.R2_BUCKET
const endpoint = process.env.R2_ENDPOINT

if (!process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
  console.log(
    '  SKIPPED — set R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY to the pair you\n' +
      '  are about to store, or have just stored, on the worker.',
  )
  failures.push('R2 not checked')
} else {
  // ── THE CHECK THAT MAKES THIS WORTH HAVING ──────────────────────────────
  //
  // `.env` holds the DEV bucket. Running the R2 check with `.env` loaded while
  // meaning to verify production proves a dev token works and says PASS, and
  // the next step in the runbook is "revoke the old production token".
  const bucketOk = bucket === expectedBucket
  console.log(
    `  ${bucketOk ? 'ok  ' : 'FAIL'}  bucket ${bucket ?? '(not set)'}${
      bucketOk ? '' : ` — expected ${expectedBucket} for ${target}`
    }`,
  )
  if (!bucketOk) failures.push(`R2_BUCKET is not ${target}'s bucket`)

  const endpointOk =
    expectedEndpoint === undefined || endpoint === expectedEndpoint
  console.log(
    `  ${endpointOk ? 'ok  ' : 'FAIL'}  endpoint ${
      endpoint === undefined ? '(not set)' : new URL(endpoint).hostname
    }${endpointOk ? '' : ' — does not match wrangler.jsonc'}`,
  )
  if (!endpointOk) failures.push('R2_ENDPOINT does not match wrangler.jsonc')

  if (bucketOk && endpointOk) {
    if (
      !runCheck('R2 pair can read and write the bucket', 'check-r2.mjs', {})
    ) {
      failures.push('R2 round trip failed')
    }
  } else {
    console.log('  not probing R2 — the target is wrong, so a PASS would lie.')
    console.log('')
  }
}

// ── THE VERDICT, IN CAPITALS, BECAUSE THE NEXT STEP IS IRREVERSIBLE ───────
console.log('─────────────────────────────────────────────────────────────')
if (failures.length === 0) {
  console.log(`ALL CHECKS PASSED for ${target}.`)
  console.log(
    'It is now safe to revoke the OLD credentials. Not before — see\n' +
      'docs/SECRET-ROTATION.md.',
  )
  process.exit(0)
}

console.log(`NOT VERIFIED for ${target}. ${failures.length} problem(s):`)
for (const failure of failures) console.log(`  - ${failure}`)
console.log(
  '\nDO NOT REVOKE ANYTHING. The old credentials are what is still working.',
)
process.exit(1)
