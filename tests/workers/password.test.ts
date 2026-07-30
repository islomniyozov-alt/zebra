import { describe, expect, it } from 'vitest'
import {
  ARGON2_PARAMS,
  dummyHash,
  hashPassword,
  needsRehash,
  verifyPassword,
} from '@/lib/password'

// ---------------------------------------------------------------------------
// These run in workerd, not Node. That is most of the point — password hashing
// is exactly where "works locally, fails on deploy" happens.
//
// It is NOT all of the point, and Phase 1 learned the difference the expensive
// way. The vitest workers pool is workerd, but it is not the deployed runtime:
// it does not enforce the 100,000-iteration PBKDF2 cap that production does,
// so a test asserting "600,000 iterations run in workerd without complaint"
// passed here and failed on the live worker. Nothing in this file may be read
// as evidence about a platform LIMIT. It tests behaviour; limits are settled
// against the deployed worker and written down in the step report.
// ---------------------------------------------------------------------------

/** A hash in the old format, built the way the old code built it. */
async function legacyPbkdf2Hash(
  password: string,
  iterations: number,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password.normalize('NFKC')),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  )
  const b64url = (bytes: Uint8Array) => {
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  }
  return `pbkdf2$sha256$${iterations}$${b64url(salt)}$${b64url(new Uint8Array(bits))}`
}

describe('hashPassword', () => {
  it('produces a PHC-format argon2id string', async () => {
    const encoded = await hashPassword('correct horse battery staple')
    const [empty, id, version, params, salt, hash] = encoded.split('$')

    expect(empty).toBe('')
    expect(id).toBe('argon2id')
    expect(version).toBe('v=19')
    expect(params).toBe(
      `m=${ARGON2_PARAMS.m},t=${ARGON2_PARAMS.t},p=${ARGON2_PARAMS.p}`,
    )
    // PHC base64: no padding, and the standard alphabet rather than base64url.
    expect(salt).toMatch(/^[A-Za-z0-9+/]+$/)
    expect(hash).toMatch(/^[A-Za-z0-9+/]+$/)
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

  it('completes at the configured parameters inside workerd', async () => {
    // Asserts that it RUNS and that the answer round-trips. It deliberately
    // asserts nothing about how long it took: the honest cost number comes
    // from the deployed worker, not from this pool.
    const encoded = await hashPassword('x')
    expect(await verifyPassword('x', encoded)).toBe(true)
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
    ['argon2 with too few parts', '$argon2id$v=19$m=19456,t=2,p=1$YWJj'],
    [
      'argon2i, which we never issue',
      '$argon2i$v=19$m=19456,t=2,p=1$YWJj$ZGVm',
    ],
    ['unknown argon2 version', '$argon2id$v=16$m=19456,t=2,p=1$YWJj$ZGVm'],
    ['missing a cost parameter', '$argon2id$v=19$m=19456,t=2$YWJj$ZGVm'],
    ['non-numeric cost', '$argon2id$v=19$m=lots,t=2,p=1$YWJj$ZGVm'],
    ['legacy, too few parts', 'pbkdf2$sha256$600000$abc'],
    ['legacy, wrong algorithm', 'bcrypt$sha256$600000$YWJj$ZGVm'],
    ['legacy, wrong digest', 'pbkdf2$sha512$600000$YWJj$ZGVm'],
    ['legacy, zero iterations', 'pbkdf2$sha256$0$YWJj$ZGVm'],
    ['legacy, negative iterations', 'pbkdf2$sha256$-1$YWJj$ZGVm'],
    ['legacy, non-numeric iterations', 'pbkdf2$sha256$many$YWJj$ZGVm'],
  ])('returns false for a malformed hash: %s', async (_label, encoded) => {
    // A corrupt row is a failed login, never a 500 that tells the caller
    // their account is worth a second look.
    expect(await verifyPassword('anything', encoded)).toBe(false)
  })
})

describe('the PBKDF2 migration', () => {
  it('still verifies a hash written by the old code', async () => {
    // The rolling upgrade only rolls if the old format keeps working. If this
    // test fails, every existing user is locked out.
    const legacy = await legacyPbkdf2Hash('the-old-passphrase', 100_000)
    expect(await verifyPassword('the-old-passphrase', legacy)).toBe(true)
    expect(await verifyPassword('not-it', legacy)).toBe(false)
  })

  it('flags every PBKDF2 hash as stale, however many iterations it had', async () => {
    // Including one at the 600k the code briefly claimed to use: the objection
    // is the algorithm, not the count.
    for (const iterations of [1_000, 100_000, 600_000]) {
      expect(needsRehash(await legacyPbkdf2Hash('x', iterations))).toBe(true)
    }
  })
})

describe('needsRehash', () => {
  it('flags a hash made with weaker parameters', async () => {
    const weak = await hashPassword('x', { m: 8192, t: 1, p: 1 })
    expect(needsRehash(weak)).toBe(true)
    // ...and it still verifies, so nobody is locked out by the upgrade.
    expect(await verifyPassword('x', weak)).toBe(true)
  })

  it('leaves a current hash alone', async () => {
    expect(needsRehash(await hashPassword('x'))).toBe(false)
  })

  it('leaves a STRONGER hash alone', async () => {
    // Someone tuning the parameters up and then rolling back must not cause a
    // rehash storm that quietly weakens every password it touches.
    const stronger = await hashPassword('x', { m: 32768, t: 3, p: 1 })
    expect(needsRehash(stronger)).toBe(false)
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

    // Same parameters, so the same work. Generous bound — this asserts the
    // same order of magnitude, not a stopwatch.
    expect(Math.max(realMs, dummyMs)).toBeLessThan(
      Math.min(realMs, dummyMs) * 4 + 250,
    )
  })
})
