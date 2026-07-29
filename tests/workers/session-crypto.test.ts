import { describe, expect, it } from 'vitest'
import { generateSessionToken, hashSessionToken } from '@/lib/session'

// The token half of session handling is pure WebCrypto and therefore has to
// be proven on workerd, same as password hashing. The database half cannot run
// here — no socket — and is covered by tests/auth.integration.test.ts.

describe('generateSessionToken', () => {
  it('is url-safe, so it survives a cookie unescaped', () => {
    expect(generateSessionToken()).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('carries 256 bits of entropy', () => {
    // 32 bytes, base64url, unpadded.
    expect(generateSessionToken().length).toBe(43)
  })

  it('does not repeat', () => {
    const tokens = new Set(Array.from({ length: 500 }, generateSessionToken))
    expect(tokens.size).toBe(500)
  })
})

describe('hashSessionToken', () => {
  it('produces a stable sha256 hex digest', async () => {
    // Fixed vector: if this changes, every live session silently stops
    // resolving, which is a bad way to find out.
    expect(await hashSessionToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('is deterministic and differs per token', async () => {
    const token = generateSessionToken()
    expect(await hashSessionToken(token)).toBe(await hashSessionToken(token))
    expect(await hashSessionToken(token)).not.toBe(
      await hashSessionToken(generateSessionToken()),
    )
  })

  it('never returns the token it was given', async () => {
    const token = generateSessionToken()
    expect(await hashSessionToken(token)).not.toBe(token)
  })
})
