import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ITERATIONS,
  dummyHash,
  hashPassword,
  needsRehash,
  verifyPassword,
} from '@/lib/password'

// ---------------------------------------------------------------------------
// These run in workerd, not Node. That is the entire point: the brief's
// warning is that password hashing is exactly where "works locally, fails on
// deploy" happens, and a Node-only suite would have caught none of it.
// ---------------------------------------------------------------------------

describe('hashPassword', () => {
  it('produces a self-describing hash', async () => {
    const encoded = await hashPassword('correct horse battery staple')
    const [algorithm, digest, iterations, salt, hash] = encoded.split('$')

    expect(algorithm).toBe('pbkdf2')
    expect(digest).toBe('sha256')
    expect(Number(iterations)).toBe(DEFAULT_ITERATIONS)
    expect(salt).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(hash).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('salts, so the same password never hashes twice the same way', async () => {
    const [a, b] = await Promise.all([
      hashPassword('same'),
      hashPassword('same'),
    ])
    expect(a).not.toBe(b)
    expect(await verifyPassword('same', a)).toBe(true)
    expect(await verifyPassword('same', b)).toBe(true)
  })

  it('runs 600,000 iterations inside workerd without complaint', async () => {
    // Some runtimes cap PBKDF2 iterations. workerd does not — measured at
    // roughly 0.7s of CPU, which is affordable for an operation that happens
    // once per login and is rate limited.
    const started = Date.now()
    const encoded = await hashPassword('x', DEFAULT_ITERATIONS)
    const elapsed = Date.now() - started

    expect(await verifyPassword('x', encoded)).toBe(true)
    expect(elapsed).toBeLessThan(10_000)
  })
})

describe('verifyPassword', () => {
  it('accepts the right password and refuses the wrong one', async () => {
    const encoded = await hashPassword('s3cret-passphrase')
    expect(await verifyPassword('s3cret-passphrase', encoded)).toBe(true)
    expect(await verifyPassword('s3cret-passphras', encoded)).toBe(false)
    expect(await verifyPassword('S3cret-passphrase', encoded)).toBe(false)
    expect(await verifyPassword('', encoded)).toBe(false)
  })

  it('handles unicode and normalises it', async () => {
    // é as one code point vs e + combining accent. A user typing the same
    // password on a Mac and on Windows must get in both times.
    const composed = 'contraseña-café'
    const decomposed = composed.normalize('NFD')
    expect(composed).not.toBe(decomposed)

    const encoded = await hashPassword(composed)
    expect(await verifyPassword(decomposed, encoded)).toBe(true)
  })

  it('survives a long passphrase', async () => {
    const long = 'a'.repeat(4096)
    const encoded = await hashPassword(long)
    expect(await verifyPassword(long, encoded)).toBe(true)
    expect(await verifyPassword('a'.repeat(4095), encoded)).toBe(false)
  })

  it.each([
    ['empty', ''],
    ['not a hash', 'hunter2'],
    ['too few parts', 'pbkdf2$sha256$600000$abc'],
    ['wrong algorithm', 'bcrypt$sha256$600000$YWJj$ZGVm'],
    ['wrong digest', 'pbkdf2$sha512$600000$YWJj$ZGVm'],
    ['zero iterations', 'pbkdf2$sha256$0$YWJj$ZGVm'],
    ['negative iterations', 'pbkdf2$sha256$-1$YWJj$ZGVm'],
    ['non-numeric iterations', 'pbkdf2$sha256$many$YWJj$ZGVm'],
  ])('returns false for a malformed hash: %s', async (_label, encoded) => {
    // A corrupt row is a failed login, never a 500 that tells the caller
    // their account is worth a second look.
    expect(await verifyPassword('anything', encoded)).toBe(false)
  })
})

describe('needsRehash', () => {
  it('flags a hash made with weaker parameters', async () => {
    const weak = await hashPassword('x', 1_000)
    expect(needsRehash(weak)).toBe(true)
    // ...and it still verifies, so nobody is locked out by the upgrade.
    expect(await verifyPassword('x', weak)).toBe(true)
  })

  it('leaves a current hash alone', async () => {
    expect(needsRehash(await hashPassword('x'))).toBe(false)
  })

  it('flags anything it cannot parse', () => {
    expect(needsRehash('garbage')).toBe(true)
  })
})

describe('dummyHash', () => {
  it('costs the same as a real verify, so a missing user is not faster', async () => {
    const real = await hashPassword('x')
    const dummy = await dummyHash()

    const timeOf = async (fn: () => Promise<unknown>) => {
      const started = Date.now()
      await fn()
      return Date.now() - started
    }

    const realMs = await timeOf(() => verifyPassword('wrong', real))
    const dummyMs = await timeOf(() => verifyPassword('wrong', dummy))

    // Same iteration count, so the same work. Generous bound — this is
    // asserting the same order of magnitude, not a stopwatch.
    expect(Math.max(realMs, dummyMs)).toBeLessThan(
      Math.min(realMs, dummyMs) * 4 + 250,
    )
  })
})
