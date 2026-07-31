import { ARGON2_PARAMS, verifyPassword } from '@/lib/password'

// ---------------------------------------------------------------------------
// ONE ARGON2ID HASH, COMPUTED ONCE, CHECKED IN.
//
// argon2id costs about half a second by design — that is the entire point of
// it. Most tests do not care: they need a User row so that a membership, a
// session or an audit attribution has something to hang from, and the password
// is never typed. Paying 500ms per fixture user, and again in every `afterEach`
// that resets one, took the integration suite from roughly two minutes to nine.
//
// So the hash is precomputed. Only tests that are ABOUT hashing, or that
// actually sign in, pay the real cost — and they must, because that cost is
// the thing they are checking.
//
// NOT A SECRET. It is the hash of a public string, in a repository, for a test
// user in a throwaway organization. If it ever protects anything real, that is
// the bug, not this file.
// ---------------------------------------------------------------------------

export const FIXTURE_PASSWORD = 'fixture-passphrase-not-a-secret'

export const FIXTURE_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$QWPZfjPNHX7SzkzEhN7lmA$cIktCmqh5BDzNiX/oDLSz2ZjmT/QWflqP2N5X2XR+hg'

/**
 * The two ways this constant can rot, both silent without a check:
 *
 *   1. `ARGON2_PARAMS` is retuned and the fixture is left at the old cost. It
 *      still verifies, so nothing fails — but `needsRehash` starts returning
 *      true for every fixture user and any test asserting a stable hash gets
 *      mysterious. Hence the parameter assertion.
 *   2. Someone edits the string. Then every login test fails at once with an
 *      unhelpful "invalid_credentials", far from the cause.
 *
 * `tests/fixtures.test.ts` runs this. It is the cheapest possible guard on the
 * thing every other test now depends on.
 */
export async function fixtureHashIsCurrent(): Promise<{
  verifies: boolean
  matchesCurrentParams: boolean
}> {
  return {
    verifies: await verifyPassword(FIXTURE_PASSWORD, FIXTURE_PASSWORD_HASH),
    matchesCurrentParams: FIXTURE_PASSWORD_HASH.includes(
      `m=${ARGON2_PARAMS.m},t=${ARGON2_PARAMS.t},p=${ARGON2_PARAMS.p}`,
    ),
  }
}
