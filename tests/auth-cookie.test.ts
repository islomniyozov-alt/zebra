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
