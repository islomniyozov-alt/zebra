import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// THE ROTATION HELPER MUST NOT PRINT A SECRET. ON ANY PATH.
//
// ── WHY A CANARY AND NOT A READING ───────────────────────────────────────
//
// Every line `verify-secrets.mjs` writes is already careful, and that was true
// of `check-connection.mjs` too — which leaked a password anyway, because an
// idle Neon client emitted an `error` event whose default handler printed the
// client object, and the client carries `config.connectionString`. No reading of
// the script would have found it. A canary and a grep did.
//
// So these tests hand the script values that cannot occur naturally and assert
// they are nowhere in stdout or stderr, on the paths that FAIL — which is where
// a diagnostic is most tempted to quote the value it is complaining about.
//
// ── THEY TOUCH NOTHING ───────────────────────────────────────────────────
//
// Unresolvable hosts and a `--target` whose expectations come out of
// `wrangler.jsonc`. No network succeeds, no bucket is written, and nothing here
// knows a real credential.
// ---------------------------------------------------------------------------

const SCRIPT = 'scripts/verify-secrets.mjs'

/** Values that cannot appear by accident, so a single hit is a real leak. */
const CANARY_PASSWORD = 'Canary-PW-9f2b7c4e-DO-NOT-PRINT'
const CANARY_KEY = 'ab'.repeat(16) // 32 hex, the right SHAPE for an R2 key id
const CANARY_SECRET = 'cd'.repeat(32) // 64 hex

function run(env: Record<string, string>, target = 'production') {
  const result = spawnSync(process.execPath, [SCRIPT, `--target=${target}`], {
    encoding: 'utf8',
    // A CLEAN ENVIRONMENT, so `.env` and the developer's shell cannot supply a
    // value the test did not choose — and so this cannot accidentally reach a
    // real endpoint.
    //
    // THE THREE DEFAULTS ARE REQUIRED BY THIS PROJECT'S `ProcessEnv` TYPE, not
    // by the script: `NODE_ENV`, `NEON_BRANCH` and `R2_BUCKET` are declared
    // non-optional, so a minimal object is a type error. They are listed rather
    // than cast away, which also makes it explicit what the child is allowed to
    // see — and `...env` last means a test can still override any of them.
    env: {
      PATH: process.env.PATH ?? '',
      SystemRoot: process.env.SystemRoot ?? '',
      NODE_ENV: 'test',
      NEON_BRANCH: 'dev',
      // DEV'S BUCKET as the default, because the type narrows this to the two
      // real names and the empty string is not one of them. It is the safe one to
      // default to, and the cases that care override it.
      R2_BUCKET: 'zebra-docs-dev',
      ...env,
    },
  })
  return {
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  }
}

describe('no secret reaches the output', () => {
  it('not the database password, on the path where the host does not resolve', () => {
    const { output } = run({
      ZEBRA_TEST_URL: `postgresql://zebra_app:${CANARY_PASSWORD}@ep-nowhere-canary-pooler.invalid/neondb`,
    })
    expect(output).not.toContain(CANARY_PASSWORD)
    // AND THE OUTPUT IS NOT EMPTY, which is the way this test could pass while
    // proving nothing: a script that printed nothing at all would satisfy the
    // assertion above.
    expect(output).toContain('DATABASE_URL')
  })

  it('not the password, on the path where the URL does not parse', () => {
    // THE WORST CASE FOR A DIAGNOSTIC: the value is malformed, so the temptation
    // is to show it. A broken connection string is still a password — and the
    // strings that fail to parse are disproportionately the ones whose password
    // contains the character that broke it.
    const { output } = run({
      ZEBRA_TEST_URL: `not a url at all ${CANARY_PASSWORD}`,
    })
    expect(output).not.toContain(CANARY_PASSWORD)
    expect(output).toContain('not a URL')
  })

  it('not the R2 key pair, on the path where the bucket is wrong', () => {
    const { output } = run({
      R2_ACCESS_KEY_ID: CANARY_KEY,
      R2_SECRET_ACCESS_KEY: CANARY_SECRET,
      R2_BUCKET: 'zebra-docs-dev',
      R2_ENDPOINT: 'https://canary.r2.cloudflarestorage.com',
    })
    expect(output).not.toContain(CANARY_KEY)
    expect(output).not.toContain(CANARY_SECRET)
    expect(output).toContain('expected zebra-docs')
  })

  it('and not the R2 secret when the round trip itself fails', () => {
    // THE BUCKET MATCHES, so the probe runs and R2 answers — against a hostname
    // that does not resolve. The failure text comes from a library rather than
    // from this script, which is the half a careful author cannot cover by being
    // careful.
    const { output } = run({
      R2_ACCESS_KEY_ID: CANARY_KEY,
      R2_SECRET_ACCESS_KEY: CANARY_SECRET,
      R2_BUCKET: 'zebra-docs',
      R2_ENDPOINT: 'https://canary-does-not-resolve.invalid',
    })
    expect(output).not.toContain(CANARY_KEY)
    expect(output).not.toContain(CANARY_SECRET)
  })
})

describe('it refuses to guess the target', () => {
  it('exits 2 with no target', () => {
    const result = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' })
    expect(result.status).toBe(2)
    expect(`${result.stdout}${result.stderr}`).toContain('--target=')
  })

  it('and on a target it does not know', () => {
    const { status } = run({}, 'staging')
    expect(status).toBe(2)
  })
})

describe('it never says PASSED without having checked both halves', () => {
  it('reports NOT VERIFIED when nothing was supplied', () => {
    const { status, output } = run({})
    expect(status).toBe(1)
    expect(output).toContain('NOT VERIFIED')
    // THE SENTENCE THAT MATTERS, because the next step in the runbook destroys
    // the credential that is still working.
    expect(output).toContain('DO NOT REVOKE ANYTHING')
    expect(output).not.toContain('ALL CHECKS PASSED')
  })

  it('and a skipped half is a failure, not a silence', () => {
    // R2 supplied, database not. A helper that said PASSED here would license a
    // revoke on half an answer.
    const { status, output } = run({
      R2_ACCESS_KEY_ID: CANARY_KEY,
      R2_SECRET_ACCESS_KEY: CANARY_SECRET,
      R2_BUCKET: 'zebra-docs',
      R2_ENDPOINT: 'https://canary-does-not-resolve.invalid',
    })
    expect(status).toBe(1)
    expect(output).toContain('DATABASE_URL not checked')
  })
})

describe('the runbook and the helper stay attached to each other', () => {
  it('the helper points at the runbook', () => {
    expect(readFileSync(SCRIPT, 'utf8')).toContain('docs/SECRET-ROTATION.md')
  })

  it('the runbook names the helper and the revoke-last rule', () => {
    const doc = readFileSync('docs/SECRET-ROTATION.md', 'utf8')
    expect(doc).toContain('scripts/verify-secrets.mjs')
    expect(doc).toContain('ALL CHECKS PASSED')
    // THE RULE THE WHOLE DOCUMENT EXISTS FOR.
    //
    // WHITESPACE-COLLAPSED, because prettier reflows prose: the sentence is one
    // sentence in the document and was two lines by the time this ran, so the
    // first version of this assertion failed on the line wrap rather than on a
    // missing rule.
    const prose = doc.toLowerCase().replace(/\s+/g, ' ')
    expect(prose).toContain('only after the new one is confirmed working')
  })

  it('and the README sends an operator to it from BOTH places', () => {
    // TWO LINKS, ASSERTED SEPARATELY. The README mentions the runbook twice —
    // once in the production bring-up section and once at the head of the
    // dev-oriented "Rotating them" — so a single `toContain` was satisfied by
    // either, and deleting the production one left this green. That is the link
    // the task is actually about.
    const readme = readFileSync('README.md', 'utf8')
    expect(readme).toContain('Replacing these later is its own procedure')
    expect(readme).toContain('This section is the DEV worker')
    // THE LINK TARGETS, not the mentions: each markdown link spells the path
    // twice — once as the label and once as the href — so counting the bare
    // path gives four for two links, which is how this assertion first failed.
    expect(readme.split('](docs/SECRET-ROTATION.md)').length - 1).toBe(2)
  })

  it('the runbook contains no credential-shaped value', () => {
    // A RUNBOOK IS WHERE A REAL VALUE GETS PASTED "just as an example". 32- and
    // 64-character hex runs are what an R2 pair looks like; a long base64-ish
    // run is what a password looks like.
    const doc = readFileSync('docs/SECRET-ROTATION.md', 'utf8')
    expect(doc).not.toMatch(/\b[0-9a-f]{32,}\b/)
    expect(doc).not.toMatch(/postgresql:\/\/[^<\s]*:[^<@\s]{12,}@/)
  })
})
