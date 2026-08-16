import { describe, expect, it } from 'vitest'
// Plain .mjs tooling, deliberately outside the app's build. Typed at the call
// sites below rather than with a .d.ts nobody would keep in step.
import { classify, looksLikeCommit } from '../scripts/deploy-drift-rules.mjs'
import { credentialsFor, isProduction } from '../scripts/check-credentials.mjs'

// ---------------------------------------------------------------------------
// The two deployment guards, watched failing.
//
// Both exist because of the same incident: the Telegram share action passed
// its whole check suite, a live check and three screenshots on DEV while
// production carried the previous commit. Neither guard is worth anything if
// it has only ever been observed agreeing.
// ---------------------------------------------------------------------------

const HEAD = 'abc1234'

// The module is plain JavaScript tooling, so the shape is declared here rather
// than inferred through the @ts-expect-error above.
interface DriftInput {
  label: string
  deployedMessage: string | null
  head: string
  isKnownCommit: boolean
  changedSourceFiles: string[]
}
type Verdict = { state: string; loud: boolean }
const rule = classify as (input: DriftInput) => Verdict

const drift = (over: Partial<DriftInput> = {}): Verdict =>
  rule({
    label: 'production',
    deployedMessage: HEAD,
    head: HEAD,
    isKnownCommit: true,
    changedSourceFiles: [],
    ...over,
  })

describe('deploy drift', () => {
  it('is quiet when the deployed commit is HEAD', () => {
    expect(drift()).toEqual({ state: 'current', loud: false })
  })

  it('SHOUTS when production trails a change to src/', () => {
    // The one that matters, and the one nobody wants to stage by hand.
    expect(
      drift({
        deployedMessage: '01d1234',
        changedSourceFiles: ['src/lib/users.ts'],
      }),
    ).toEqual({ state: 'behind-source', loud: true })
  })

  it('does not shout when production trails only scripts and docs', () => {
    // The pair. Without it, "loud" could simply mean "behind", and the signal
    // would fire on every README commit until people stopped reading it.
    expect(
      drift({ deployedMessage: '01d1234', changedSourceFiles: [] }),
    ).toEqual({ state: 'behind-only', loud: false })
  })

  it('does not shout about DEV trailing src/, because that is normal', () => {
    expect(
      drift({
        label: 'dev',
        deployedMessage: '01d1234',
        changedSourceFiles: ['src/lib/users.ts'],
      }),
    ).toEqual({ state: 'behind-source', loud: false })
  })

  it('treats a dirty stamp as its commit', () => {
    expect(drift({ deployedMessage: `${HEAD}+dirty` })).toEqual({
      state: 'current',
      loud: false,
    })
  })

  it('says nothing useful about a version deployed without a message', () => {
    expect(drift({ deployedMessage: null })).toEqual({
      state: 'unstamped',
      loud: false,
    })
  })

  it('says nothing useful about a commit this clone does not have', () => {
    // Deployed from another machine, or from a branch since deleted. Not a
    // fault; just unanswerable, and answering anyway would be a lie.
    expect(drift({ deployedMessage: 'ffff999', isKnownCommit: false })).toEqual(
      { state: 'unknown-commit', loud: false },
    )
  })
})

describe('which credentials a verification run uses', () => {
  const dev = 'https://zebra-dev.tajikcargollc.workers.dev'
  const prod = 'https://zebra.tajikcargollc.workers.dev'

  it('knows the two workers apart', () => {
    const production = isProduction as (base: string) => boolean
    expect(production(dev)).toBe(false)
    expect(production(prod)).toBe(true)
    expect(production('http://localhost:3000')).toBe(false)
  })

  it('treats an unrecognised host as production', () => {
    // A custom domain nobody added to the list should demand the careful
    // credential, not the convenient one. Fail closed.
    const production = isProduction as (base: string) => boolean
    expect(production('https://tms.tajikcargollc.com')).toBe(true)
    expect(production('not a url at all')).toBe(true)
  })

  it('NEVER falls back to the seed owner for production', () => {
    // The rule this whole file exists for. SEED_OWNER_* is the owner account,
    // and on production its password is not even the one in .env any more.
    const resolved = (
      credentialsFor as (base: string) => {
        ok: boolean
        reason?: string
      }
    )(prod)
    // The environment running these tests has SEED_OWNER_* set and
    // PROD_CHECK_* unset, which is exactly the dangerous combination.
    if (!process.env.PROD_CHECK_PASSWORD) {
      expect(resolved.ok).toBe(false)
      expect(resolved.reason).toContain('PROD_CHECK_EMAIL')
    }
  })

  it('and does use the seed owner for dev', () => {
    // The pair: the refusal above is about production, not about the resolver
    // being unable to find anything.
    const resolved = (
      credentialsFor as (base: string) => {
        ok: boolean
        source?: string
      }
    )(dev)
    if (process.env.SEED_OWNER_PASSWORD) {
      expect(resolved.ok).toBe(true)
      expect(resolved.source).toBe('SEED_OWNER_*')
    }
  })
})

// ---------------------------------------------------------------------------
// A CONFIG VERSION IS NOT A DEPLOY, AND IT MUST NOT SILENCE THIS CHECK.
//
// Editing a secret in the Cloudflare dashboard creates a deployment that
// serves. Nobody deployed it from a commit, so it carries no commit message —
// observed on production 2026-08-16 with no message AT ALL, not merely a
// non-commit string. Left alone it resolved to `unstamped`, which is quiet,
// and the one loud signal in this file — production behind a change to src/ —
// would have gone missing for as long as that version kept serving.
// ---------------------------------------------------------------------------

describe('telling a deploy from a config version', () => {
  it.each([
    ['d09f001', true],
    ['6a97827+dirty', true],
    ['0123456789abcdef0123456789abcdef01234567', true],
  ])('%s is a commit', (message, expected) => {
    expect(looksLikeCommit(message)).toBe(expected)
  })

  it.each<[string | null, string]>([
    ['', 'empty'],
    [null, 'absent — the shape production actually had'],
    ['Updated secrets via dashboard', 'a sentence'],
    ['abc', 'too short to be a short SHA'],
  ])('%s is not a commit (%s)', (message: string | null) => {
    expect(looksLikeCommit(message)).toBe(false)
  })

  it('refuses to guess when the message is not a commit', () => {
    // The caller resolves the real deploy underneath and calls again with it.
    expect(
      classify({
        label: 'production',
        deployedMessage: 'Updated secrets via dashboard',
        head: 'abc1234',
        isKnownCommit: false,
        changedSourceFiles: [],
      }),
    ).toMatchObject({ state: 'config-version-unresolved', loud: false })
  })

  // THE POINT OF THE WHOLE THING. Once the real deploy is resolved, drift is
  // measured against the code actually running, and the alarm still fires.
  it('is still LOUD about src/ drift underneath a config version', () => {
    expect(
      classify({
        label: 'production',
        deployedMessage: 'd09f001',
        head: '6a97827',
        isKnownCommit: true,
        changedSourceFiles: ['src/lib/inbound-email.ts'],
      }),
    ).toMatchObject({ state: 'behind-source', loud: true })
  })
})
