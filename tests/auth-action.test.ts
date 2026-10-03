import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { translator, type MessageKey } from '@/lib/i18n'
import { resetRetryCount, retryCount } from '@/lib/socket-retry'

// ---------------------------------------------------------------------------
// WHAT THE LOGIN FORM SAYS, FOR EVERY WAY SIGNING IN CAN FAIL. §7.5.1.
//
// ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────
//
// Nothing referenced `signInAction` before today. The owner reported a correct
// password refused with no message on production, and the audit of the action
// found FOUR paths that showed nothing: a dropped socket inside `login`, a
// dropped socket in the locale read AFTER the cookie was set, a corrupt stored
// hash, and a failure in `getSession` on the page itself. Each of them threw,
// and a thrown server action shows whatever the framework shows.
//
// So this is one case per row of that table, and each asserts the WORDS — not
// that an error happened, but which sentence the person reads.
//
// ── THE DEPENDENCIES ARE MOCKED, THE ACTION IS NOT ───────────────────────
//
// `login` is covered against real Postgres in `tests/integration/auth.test.ts`,
// including the rate limit and the new reset. What is covered here is the thing
// a person touches: the mapping from an outcome to a sentence, and the promise
// that NOTHING escapes as a throw.
// ---------------------------------------------------------------------------

const cookieStore = {
  get: vi.fn(() => undefined as { value: string } | undefined),
  set: vi.fn(),
  delete: vi.fn(),
}

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve(cookieStore),
  headers: () =>
    Promise.resolve(new Headers({ 'cf-connecting-ip': '203.0.113.7' })),
}))

// `redirect` THROWS IN NEXT, and that throw is how a server action navigates.
// The mock throws a recognisable marker so a test can tell "navigated" from
// "returned a refusal" — and so a redirect can never be mistaken for a success
// that said nothing.
const REDIRECT = 'NEXT_REDIRECT'
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`${REDIRECT}:${to}`)
  },
}))

const login = vi.fn()
vi.mock('@/lib/auth', () => ({
  login: (...args: unknown[]) => login(...args) as unknown,
  logout: vi.fn(),
}))

vi.mock('@/lib/auth-db', () => ({
  unauthenticatedDb: () => ({ user: { findUnique: vi.fn() } }),
}))

const setSessionCookie = vi.fn()
vi.mock('@/lib/auth-context', () => ({
  setSessionCookie: (token: string) => setSessionCookie(token) as unknown,
  clearSessionCookie: vi.fn(),
  requestMetadata: () =>
    Promise.resolve({ ip: '203.0.113.7', userAgent: 'test' }),
}))

const { signInAction } = await import('@/app/(auth)/actions')

const form = (email: string, password: string): FormData => {
  const data = new FormData()
  data.append('email', email)
  data.append('password', password)
  return data
}

const submit = (email = 'islom@example.test', password = 'correct horse') =>
  signInAction({ error: null }, form(email, password))

/** A dropped Neon socket, in the shape the driver actually produces. */
const droppedSocket = () => {
  const error = new Error('')
  error.stack =
    'TypeError\n    at WebSocket.#onSocketClose (node:internal/deps/undici)'
  return error
}

const ok = (locale: string | null = 'en') => ({
  ok: true as const,
  locale,
  token: 'tok_abc',
  context: { userId: 'usr_1' },
})

beforeEach(() => {
  vi.clearAllMocks()
  resetRetryCount()
  cookieStore.get.mockReturnValue(undefined)
})

describe('every refusal names itself on the form', () => {
  it('an empty field is a worded refusal, not a silent one', async () => {
    expect(await submit('', '')).toEqual({ error: 'auth.invalid' })
    // AND THE CREDENTIALS WERE NEVER CHECKED, so an empty box costs no argon2.
    expect(login).not.toHaveBeenCalled()
  })

  it('a wrong password says the same thing as an unknown address', async () => {
    login.mockResolvedValue({ ok: false, reason: 'invalid_credentials' })
    expect(await submit()).toEqual({ error: 'auth.invalid' })
  })

  it('a refusal by the limit says the limit refused it', async () => {
    login.mockResolvedValue({
      ok: false,
      reason: 'rate_limited',
      retryAfterMs: 900_000,
    })
    expect(await submit()).toEqual({ error: 'auth.rateLimited' })
  })

  it('correct credentials with no way in get their own sentence', async () => {
    login.mockResolvedValue({ ok: false, reason: 'no_membership' })
    expect(await submit()).toEqual({ error: 'auth.noMembership' })
  })

  it('an unknown reason falls back to the credential message, not to silence', async () => {
    // A REASON NOBODY MAPPED must still produce words. This is the branch that
    // would otherwise be added later and quietly return nothing.
    login.mockResolvedValue({ ok: false, reason: 'something_new' })
    expect(await submit()).toEqual({ error: 'auth.invalid' })
  })
})

describe('the request was fine and the system was not', () => {
  it('a dropped socket says the database was unreachable', async () => {
    login.mockRejectedValue(droppedSocket())
    expect(await submit()).toEqual({ error: 'auth.unavailable' })
  })

  it('and it retried exactly once before saying so', async () => {
    login.mockRejectedValue(droppedSocket())
    await submit()
    // ONE retry. Two attempts in total, one counted retry — a loop here would
    // be a form that hangs (§7.5.1).
    expect(login).toHaveBeenCalledTimes(2)
    expect(retryCount()).toBe(1)
  })

  it('a socket that drops once and then works signs the person in', async () => {
    login.mockRejectedValueOnce(droppedSocket()).mockResolvedValueOnce(ok())
    await expect(submit()).rejects.toThrow(`${REDIRECT}:/dashboard`)
    expect(setSessionCookie).toHaveBeenCalledWith('tok_abc')
  })

  it('a failure that is NOT a socket is not retried, and still has words', async () => {
    // A corrupt stored hash, a null dereference, anything: the action still may
    // not throw. But it must not retry either — a retry that swallowed a real
    // defect would turn it into a slow refusal nobody investigates.
    login.mockRejectedValue(new TypeError('parsed is not a function'))
    expect(await submit()).toEqual({ error: 'auth.unavailable' })
    expect(login).toHaveBeenCalledTimes(1)
    expect(retryCount()).toBe(0)
  })

  it('never leaves a session behind when it refuses', async () => {
    // THE DEFECT THAT PRODUCED TWO COMPLAINTS: a throw after the cookie was set
    // left somebody signed in and staring at a refusal. A refusal sets nothing.
    login.mockRejectedValue(droppedSocket())
    await submit()
    expect(setSessionCookie).not.toHaveBeenCalled()
    expect(cookieStore.set).not.toHaveBeenCalled()
  })
})

describe('a success sets the cookies and then does nothing else', () => {
  it('redirects to the dashboard', async () => {
    login.mockResolvedValue(ok())
    await expect(submit()).rejects.toThrow(`${REDIRECT}:/dashboard`)
  })

  it('writes the locale from the login result, with no second read', async () => {
    login.mockResolvedValue(ok('ru'))
    await expect(submit()).rejects.toThrow(REDIRECT)
    expect(cookieStore.set).toHaveBeenCalledWith(
      'zebra_locale',
      'ru',
      expect.objectContaining({ path: '/' }),
    )
  })

  it('sets the locale BEFORE the session, so nothing fallible follows it', async () => {
    // §7.5.1's ordering rule, asserted rather than trusted: the locale write is
    // a cookie-store write and cannot reach the network, but the ORDER is what
    // guarantees no future reader is tempted to put a query between them.
    const order: string[] = []
    cookieStore.set.mockImplementation(() => void order.push('locale'))
    setSessionCookie.mockImplementation(() => void order.push('session'))
    login.mockResolvedValue(ok('en'))

    await expect(submit()).rejects.toThrow(REDIRECT)
    expect(order).toEqual(['locale', 'session'])
  })

  it('leaves the locale cookie alone when the user has not chosen one', async () => {
    login.mockResolvedValue(ok(null))
    await expect(submit()).rejects.toThrow(REDIRECT)
    expect(cookieStore.set).not.toHaveBeenCalled()
  })
})

describe('every key the action can return is renderable', () => {
  // THE FALLBACK IS THE HAZARD. `LoginForm` renders `errors[state.error] ??
  // errors['auth.invalid']`, so a key the PAGE forgot to pass renders as "wrong
  // password" — which is what would have happened to `auth.unavailable`.
  const KEYS: MessageKey[] = [
    'auth.invalid',
    'auth.rateLimited',
    'auth.noMembership',
    'auth.unavailable',
  ]

  it.each(KEYS)('%s exists in all three locales', (key) => {
    for (const locale of ['en', 'ru', 'fa'] as const) {
      const value = translator(locale)(key)
      expect(typeof value).toBe('string')
      expect(value.length).toBeGreaterThan(0)
    }
  })

  it('and the login page passes every one of them to the form', () => {
    const source = readPage()
    for (const key of KEYS) {
      expect(source).toContain(`'${key}': t('${key}')`)
    }
  })
})

function readPage(): string {
  // Read rather than imported: the page is a server component that would pull
  // the whole shell in, and what is being checked is the literal map.
  return readFileSync('src/app/(auth)/login/page.tsx', 'utf8')
}
