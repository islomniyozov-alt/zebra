import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkDbTarget } from './db-target'

// ---------------------------------------------------------------------------
// THE URLS CI COMPOSES ARE RUN PAST THE CHECK THAT REFUSED THEM.
//
// Run 35307302962 created its Neon branch, measured a 16ms round trip, wrote
// its `.env` — and then 108 test FILES failed to load, every one of them
// saying `DATABASE_URL or DIRECT_DATABASE_URL is not a URL`. The string was
// built by shell prefix-stripping, which cannot fail, so the first thing that
// could object was `assertSafeDbTarget`, three steps and four minutes away.
//
// Run 35308232556 then passed 1,915 of 1,939 tests and failed two on
// `password authentication failed for user zebra_app` — the password was
// dev's, and a password can be wrong in ways parsing cannot see. The branch
// now gets its own, so the composer takes parts rather than a string.
//
// `checkDbTarget` is imported here rather than restated. A test that asserted
// its own idea of a good URL would pass while CI kept failing — that is flag
// 88's mistake, the instrument inheriting the belief it exists to test.
// ---------------------------------------------------------------------------

const HOST = 'ep-orange-hall-a1b2c3.c-2.us-east-2.aws.neon.tech'
const POOLED_HOST = 'ep-orange-hall-a1b2c3-pooler.c-2.us-east-2.aws.neon.tech'

const PARTS = {
  ENDPOINT_HOST: HOST,
  DATABASE_NAME: 'neondb',
  OWNER_ROLE: 'neondb_owner',
  OWNER_PASSWORD: 'npg_owner_secret',
  APP_ROLE: 'zebra_app',
  APP_PASSWORD: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
}

/** Run the composer the workflow runs, and read what it would hand GitHub. */
function compose(overrides: Partial<typeof PARTS> = {}): {
  status: number
  out: string
  outputs: Record<string, string>
} {
  const file = join(mkdtempSync(join(tmpdir(), 'ci-urls-')), 'output.txt')
  writeFileSync(file, '')
  let out = ''
  let status = 0
  try {
    out = execFileSync(process.execPath, ['scripts/ci-compose-urls.mjs'], {
      encoding: 'utf8',
      env: { ...process.env, ...PARTS, ...overrides, GITHUB_OUTPUT: file },
    })
  } catch (error) {
    const failure = error as { status?: number; stdout?: string }
    status = failure.status ?? 1
    out = failure.stdout ?? ''
  }
  const outputs: Record<string, string> = {}
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const at = line.indexOf('=')
    if (at > 0) outputs[line.slice(0, at)] = line.slice(at + 1)
  }
  return { status, out, outputs }
}

describe('the connection strings CI composes for a branch', () => {
  it('are accepted by the guard that refused the last attempt', () => {
    const { status, outputs } = compose()
    expect(status).toBe(0)

    // THE REAL CHECK, not a restatement of it.
    const outcome = checkDbTarget({
      DATABASE_URL: outputs.pooled,
      DIRECT_DATABASE_URL: outputs.direct,
      NEON_BRANCH: 'ci-35308232556',
    })
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true)
  })

  it('name the pooled and direct doors of ONE endpoint', () => {
    const { outputs } = compose()
    expect(new URL(outputs.pooled!).hostname).toBe(POOLED_HOST)
    expect(new URL(outputs.direct!).hostname).toBe(HOST)
  })

  // ── THE APPLICATION NEVER CONNECTS AS THE OWNER ─────────────────────
  //
  // Run 35301618293 composed both as the owner. BYPASSRLS would have taken
  // every tenant boundary with it and the isolation suite would have passed on
  // an empty promise.
  it('connect as zebra_app and as the owner, never both as the owner', () => {
    const { outputs } = compose()
    expect(new URL(outputs.pooled!).username).toBe('zebra_app')
    expect(new URL(outputs.direct!).username).toBe('neondb_owner')
  })

  it('refuse outright when the two roles are the same', () => {
    const { status, out, outputs } = compose({
      APP_ROLE: 'neondb_owner',
      OWNER_ROLE: 'neondb_owner',
    })
    expect(status).toBe(1)
    expect(out).toContain('BYPASSRLS')
    expect(outputs.pooled).toBeUndefined()
  })

  it('refuse an application role that is not zebra_app', () => {
    const { status, out } = compose({ APP_ROLE: 'postgres' })
    expect(status).toBe(1)
    expect(out).toContain('not zebra_app')
  })

  // ── A MISSING PART IS NAMED, NOT SUBSTITUTED ────────────────────────
  //
  // The whole cost of run 35307302962 was a step that produced a wrong string
  // instead of a complaint. Each part is required by name.
  it.each([
    'ENDPOINT_HOST',
    'DATABASE_NAME',
    'OWNER_ROLE',
    'OWNER_PASSWORD',
    'APP_ROLE',
    'APP_PASSWORD',
  ])('say which part is missing when %s is empty', (name) => {
    const { status, out, outputs } = compose({ [name]: '' })
    expect(status).toBe(1)
    expect(out).toContain(`${name} is empty`)
    expect(outputs.pooled).toBeUndefined()
  })

  it('refuse a host with no domain part rather than compose one', () => {
    const { status, out } = compose({ ENDPOINT_HOST: 'localhost' })
    expect(status).toBe(1)
    expect(out).toContain('no domain part')
  })

  // ── A PASSWORD IS NOT PROMISED TO BE URL-SAFE ───────────────────────
  it('encode a password containing @ and /, so it cannot retarget the host', () => {
    const { outputs } = compose({ OWNER_PASSWORD: 'npg_a@b/c' })
    const direct = new URL(outputs.direct!)

    // The raw `@` would have retargeted the host; the `/` would have ended the
    // authority. Both survive as escapes, and the host is still the branch.
    expect(direct.hostname).toBe(HOST)
    expect(direct.password).toBe('npg_a%40b%2Fc')
    expect(decodeURIComponent(direct.password)).toBe('npg_a@b/c')
  })

  // A `#` is where run 35308232556's password could have died unseen: to a URL
  // parser it starts a fragment, so everything after it stops being a password.
  it('encode a password containing # and ?, which a parser would eat', () => {
    const { outputs } = compose({ APP_PASSWORD: 'pw#frag?query' })
    const pooled = new URL(outputs.pooled!)
    expect(decodeURIComponent(pooled.password)).toBe('pw#frag?query')
    expect(pooled.hash).toBe('')
    expect(pooled.search).toBe('?sslmode=require')
  })

  // ── WHAT A PERSON READS NEVER CARRIES A PASSWORD ────────────────────
  //
  // `::add-mask::` lines are the exception and cannot be otherwise: the only
  // way to register a value with the runner is to send it the value, and the
  // runner redacts those lines. Everything a person actually reads in the log
  // is what this is about — a diagnostic printing a secret is one nobody may
  // paste into an issue.
  it('never print a password in a line anybody reads', () => {
    const secret = 'npg_do_not_print_me'
    const readable = (out: string) =>
      out
        .split('\n')
        .filter((line) => !line.startsWith('::add-mask::'))
        .join('\n')

    expect(readable(compose({ APP_PASSWORD: secret }).out)).not.toContain(
      secret,
    )

    // And on the refusal path, where the temptation to dump the input is
    // strongest.
    const bad = compose({ APP_PASSWORD: secret, ENDPOINT_HOST: 'localhost' })
    expect(bad.status).toBe(1)
    expect(readable(bad.out)).not.toContain(secret)
    // Nothing was masked on that path because nothing was written, so the
    // filter cannot be what makes this pass.
    expect(bad.out).not.toContain('::add-mask::')
  })
})
