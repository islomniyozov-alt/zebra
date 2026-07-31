import { describe, expect, it } from 'vitest'
import {
  FIXTURE_PASSWORD,
  FIXTURE_PASSWORD_HASH,
  fixtureHashIsCurrent,
} from './fixtures/password'
import { needsRehash } from '@/lib/password'

// Every integration test that needs a user now leans on one checked-in hash.
// This is the guard on it. Without this file the failure mode is a suite full
// of "invalid_credentials" pointing nowhere near the cause.

describe('the precomputed argon2id fixture', () => {
  it('actually verifies against its plaintext', async () => {
    const { verifies } = await fixtureHashIsCurrent()
    expect(verifies).toBe(true)
  })

  it('was made with the parameters the code uses today', async () => {
    // If this fails, ARGON2_PARAMS moved and the fixture did not. Regenerate:
    //   npx tsx -e "import {hashPassword} from './src/lib/password'; ..."
    const { matchesCurrentParams } = await fixtureHashIsCurrent()
    expect(matchesCurrentParams).toBe(true)
    expect(needsRehash(FIXTURE_PASSWORD_HASH)).toBe(false)
  })

  it('is a hash, not a password', async () => {
    // Cheap, and it would have caught the obvious copy-paste slip.
    expect(FIXTURE_PASSWORD_HASH).not.toContain(FIXTURE_PASSWORD)
    expect(FIXTURE_PASSWORD_HASH).toMatch(/^\$argon2id\$v=19\$/)
  })
})
