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
// `checkDbTarget` is imported here rather than restated. A test that asserted
// its own idea of a good URL would pass while CI kept failing — that is flag
// 88's mistake, the instrument inheriting the belief it exists to test.
// ---------------------------------------------------------------------------

const HOST = 'ep-orange-hall-a1b2c3.c-2.us-east-2.aws.neon.tech'

/** Run the composer the workflow runs, and read what it would hand GitHub. */
function compose(devUrl: string): {
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
      env: {
        ...process.env,
        ENDPOINT_HOST: HOST,
        DATABASE_NAME: 'neondb',
        OWNER_ROLE: 'neondb_owner',
        OWNER_PASSWORD: 'npg_owner_secret',
        DEV_DATABASE_URL: devUrl,
        GITHUB_OUTPUT: file,
      },
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

const CLEAN = `postgresql://zebra_app:npg_app_secret@ep-old-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require`

describe('the connection strings CI composes for a branch', () => {
  it('are accepted by the guard that refused the last attempt', () => {
    const { status, outputs } = compose(CLEAN)
    expect(status).toBe(0)

    // THE REAL CHECK, not a restatement of it.
    const outcome = checkDbTarget({
      DATABASE_URL: outputs.pooled,
      DIRECT_DATABASE_URL: outputs.direct,
      NEON_BRANCH: 'ci-35307302962',
    })
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true)
  })

  it('name the pooled and direct doors of ONE endpoint', () => {
    const { outputs } = compose(CLEAN)
    expect(new URL(outputs.pooled!).hostname).toBe(
      `ep-orange-hall-a1b2c3-pooler.c-2.us-east-2.aws.neon.tech`,
    )
    expect(new URL(outputs.direct!).hostname).toBe(HOST)
  })

  // ── THE APPLICATION NEVER CONNECTS AS THE OWNER ─────────────────────
  //
  // Run 35301618293 composed both as the owner. BYPASSRLS would have taken
  // every tenant boundary with it and the isolation suite would have passed on
  // an empty promise.
  it('connect as zebra_app and as the owner, never both as the owner', () => {
    const { outputs } = compose(CLEAN)
    expect(new URL(outputs.pooled!).username).toBe('zebra_app')
    expect(new URL(outputs.direct!).username).toBe('neondb_owner')
  })

  it('refuse a dev URL that is not zebra_app, rather than composing it', () => {
    const owner = CLEAN.replace('zebra_app', 'neondb_owner')
    const { status, out, outputs } = compose(owner)
    expect(status).toBe(1)
    expect(out).toContain('must never connect as the database owner')
    expect(outputs.pooled).toBeUndefined()
  })

  // ── WHAT PEOPLE ACTUALLY PASTE INTO A SECRET BOX ────────────────────
  //
  // Neon's console hands the string out inside a `psql '...'` snippet, and
  // GitHub stores whatever is pasted. Each of these used to yield a string
  // that `new URL` could not read and that nothing objected to until the
  // suite met it.
  it.each([
    ['surrounding whitespace', `\n  ${CLEAN}  \n`],
    ['wrapping single quotes', `'${CLEAN}'`],
    ['wrapping double quotes', `"${CLEAN}"`],
    ['the console psql snippet', `psql '${CLEAN}'`],
    // RUN 35308066954, the real one: 190 characters starting `DATABASE_URL=p`,
    // because copying a connection string out of `.env` copies its line.
    ['the whole .env line, key and all', `DATABASE_URL=${CLEAN}`],
    ['a .env line whose value is quoted', `DIRECT_DATABASE_URL="${CLEAN}"`],
  ])('survive %s in the secret', (_label, raw) => {
    const { status, outputs } = compose(raw)
    expect(status).toBe(0)
    expect(
      checkDbTarget({
        DATABASE_URL: outputs.pooled,
        DIRECT_DATABASE_URL: outputs.direct,
      }).ok,
    ).toBe(true)
  })

  // ── TIDYING IS NOT THE SAME AS FORGIVING ────────────────────────────
  //
  // Stripping `DATABASE_URL=` must not become stripping any `SOMETHING=`. A
  // secret holding a different key is a secret holding the wrong thing, and it
  // should say so here rather than connect to somewhere unexamined.
  it('refuse a key that is not one a connection string sits behind', () => {
    const { status, out } = compose(`POSTGRES_PRISMA_URL=${CLEAN}`)
    expect(status).toBe(1)
    expect(out).toContain('IS NOT A URL')
  })

  it('say so, with the shape and not the password, when it is no URL at all', () => {
    const { status, out } = compose('zebra_app:npg_app_secret@ep-old/neondb')
    expect(status).toBe(1)
    expect(out).toContain('IS NOT A URL')
    expect(out).toContain('length 38')
    // THE PASSWORD IS NOT IN THE LOG. A diagnostic that prints the secret is
    // one nobody may paste into an issue.
    expect(out).not.toContain('npg_app_secret')
  })

  // ── A PASSWORD IS NOT PROMISED TO BE URL-SAFE ───────────────────────
  it('encode an owner password containing @ and /', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'ci-urls-')), 'output.txt')
    writeFileSync(file, '')
    execFileSync(process.execPath, ['scripts/ci-compose-urls.mjs'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ENDPOINT_HOST: HOST,
        DATABASE_NAME: 'neondb',
        OWNER_ROLE: 'neondb_owner',
        OWNER_PASSWORD: 'npg_a@b/c',
        DEV_DATABASE_URL: CLEAN,
        GITHUB_OUTPUT: file,
      },
    })
    const direct = readFileSync(file, 'utf8')
      .split('\n')
      .find((line) => line.startsWith('direct='))!
      .slice('direct='.length)

    // The raw `@` would have retargeted the host; the `/` would have ended the
    // authority. Both survive as escapes, and the host is still the branch.
    expect(new URL(direct).hostname).toBe(HOST)
    expect(new URL(direct).password).toBe('npg_a%40b%2Fc')
    expect(decodeURIComponent(new URL(direct).password)).toBe('npg_a@b/c')
  })
})
