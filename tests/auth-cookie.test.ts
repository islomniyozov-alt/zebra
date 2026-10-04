import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SESSION_COOKIE, SESSION_TTL_MS } from '@/lib/session'

// ---------------------------------------------------------------------------
// THE SESSION COOKIE'S ATTRIBUTES, AND THE ONE THAT MUST NEVER APPEAR.
//
// ── WHY `Domain` IS THE WHOLE POINT OF THIS FILE ──────────────────────────
//
// `zebra_session` carries no `Domain`, which makes it HOST-ONLY: the browser
// returns it to the exact origin that set it and nowhere else. That is what
// makes the session correct per ORIGIN rather than per literal host — dev, prod
// and `zebratms.com` when it lands each hold their own, and the move to the
// custom domain costs one fresh sign-in and leaks nothing.
//
// ADDING A `Domain` WILL LOOK LIKE A CONVENIENCE, and it is the failure mode:
// `Domain=zebratms.com` sends an operator's session to every subdomain that name
// ever acquires, including whatever a marketing page or a staging box is served
// from. AGENTS.md names this test as the thing that refuses it.
//
// ── TWO CHECKS, BECAUSE ONE OF THEM CAN BE WALKED AROUND ──────────────────
//
// The behavioural check calls `setSessionCookie` and inspects the options it
// passed. A `domain` added behind a condition — on a hostname, on an env var —
// would pass it in whichever branch the test does not take, so the SOURCE is
// also asserted not to mention the attribute at all.
// ---------------------------------------------------------------------------

const cookieStore = {
  get: vi.fn(() => undefined),
  set: vi.fn(),
  delete: vi.fn(),
}

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve(cookieStore),
  headers: () => Promise.resolve(new Headers()),
}))

const { setSessionCookie, clearSessionCookie } = await import(
  '@/lib/auth-context'
)

const AUTH_CONTEXT = 'src/lib/auth-context.ts'

const optionsPassed = (): Record<string, unknown> => {
  const call = cookieStore.set.mock.calls.at(-1)
  expect(call).toBeDefined()
  return (call?.[2] ?? {}) as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('zebra_session is host-only, by origin and not by literal host', () => {
  it('never sets Domain', async () => {
    await setSessionCookie('tok_abc')
    const options = optionsPassed()

    // NOT `toBeUndefined`: passing `domain: undefined` explicitly would satisfy
    // that and still be somebody reaching for the attribute. The key must not
    // be there at all.
    expect(Object.keys(options)).not.toContain('domain')
    expect(Object.keys(options)).not.toContain('Domain')
  })

  it('and the source does not mention the attribute in any branch', () => {
    // A conditional `domain` would pass the check above in whichever branch the
    // test did not take. There is no legitimate reason for the word to appear in
    // this file, so its absence is the assertion.
    const source = readFileSync(AUTH_CONTEXT, 'utf8')
    const code = source
      .split('\n')
      // Comments may discuss it — this very rule is explained in prose nearby.
      .filter(
        (line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'),
      )
      .join('\n')
    expect(code).not.toMatch(/\bdomain\s*:/i)
  })

  it('carries the five attributes it is supposed to', async () => {
    await setSessionCookie('tok_abc')
    const options = optionsPassed()

    expect(cookieStore.set.mock.calls.at(-1)?.[0]).toBe(SESSION_COOKIE)
    expect(options.httpOnly).toBe(true)
    expect(options.sameSite).toBe('lax')
    expect(options.path).toBe('/')
    // FROM THE TTL, not a literal: a cookie that outlives its session row is a
    // sign-in that looks fine and resolves to nothing.
    expect(options.maxAge).toBe(Math.floor(SESSION_TTL_MS / 1000))
  })

  it('keys Secure to the environment rather than to the host', async () => {
    // RIGHT AS IT IS: the only origin Zebra is served from over http is
    // localhost, so this is off exactly there. Keyed to a HOSTNAME it would have
    // to learn every future origin's protocol.
    await setSessionCookie('tok_abc')
    expect(optionsPassed().secure).toBe(process.env.NODE_ENV === 'production')
  })

  it('and clearing it names the same cookie', async () => {
    await clearSessionCookie()
    expect(cookieStore.delete).toHaveBeenCalledWith(SESSION_COOKIE)
  })
})

// ---------------------------------------------------------------------------
// AND THE LOGIN PATH NEVER DELETES AN ATTEMPT ROW. Flag 48.
//
// The first fix for "a correct password is refused" deleted that email's failed
// rows on success. It worked and it erased the signature of a guess that worked.
// The ruling replaced it with a moved counter, and this is what stops the delete
// coming back the next time somebody meets the lockout and reaches for the
// obvious tool.
//
// `clearLoginFailures` KEEPS ITS DELETE and must: it is the operator action for
// unlocking somebody who is genuinely locked out, deliberate and attributed.
// What is forbidden is a delete on the path a stranger can trigger by typing a
// password.
// ---------------------------------------------------------------------------
describe('the login success path deletes nothing', () => {
  const AUTH = 'src/lib/auth.ts'

  it('has no deleteMany between recording the success and returning it', () => {
    const source = readFileSync(AUTH, 'utf8')
    const from = source.indexOf('record(db, email, true')
    const to = source.indexOf('return { ok: true')
    expect(from).toBeGreaterThan(-1)
    expect(to).toBeGreaterThan(from)
    expect(source.slice(from, to)).not.toContain('deleteMany')
  })

  it('and the operator unlock still has one', () => {
    // THE CONTROL. Without it this file would pass against an auth.ts that had
    // lost the ability to unlock anybody at all.
    const source = readFileSync(AUTH, 'utf8')
    const from = source.indexOf('export async function clearLoginFailures')
    expect(from).toBeGreaterThan(-1)
    expect(source.slice(from)).toContain('deleteMany')
  })

  it('counts failures since the last success, not since the window opened', () => {
    // THE MECHANISM THAT REPLACED THE DELETE, asserted at the source because the
    // behaviour is covered against real Postgres in
    // `tests/integration/auth.test.ts` and what can regress silently here is the
    // CLAUSE: a `gte: since` would restore the bug without failing a type check.
    const source = readFileSync(AUTH, 'utf8')
    const counter = source.slice(
      source.indexOf('async function countRecentFailures'),
      source.indexOf('async function record('),
    )
    expect(counter).toContain('succeeded: true')
    expect(counter).toContain('createdAt: { gt: from }')
  })
})
