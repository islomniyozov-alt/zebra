import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// Plain .mjs tooling, deliberately outside the app's build. Typed at the call
// sites below rather than with a .d.ts nobody would keep in step.
import {
  classify,
  isMissingCredentials,
  looksLikeCommit,
  unreadableRefusal,
} from '../scripts/deploy-drift-rules.mjs'
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

// ---------------------------------------------------------------------------
// "I COULD NOT LOOK" AND "I LOOKED AND IT IS FINE" ARE DIFFERENT ANSWERS.
//
// On 2026-09-18, two minutes after a production deploy, `check:drift` printed
//
//     dev         could not be read
//     production  could not be read
//     production  artifact   not reached (fetch failed)
//
// and exited 0. Both workers were fine; this machine could not reach
// Cloudflare. But an exit code of 0 from a drift check is read as "no drift"
// by a person skimming, by `npm run check`, and by CI — and nothing in that
// output stops it being read that way. It is the `cmd | tail` failure for the
// fifth time in this repository: a status that belongs to a different question
// than the one asked.
//
// The rule is tested here rather than through the script, because a check
// about what to do when Cloudflare is unreachable must not need Cloudflare to
// prove it works. The WIRING is checked separately, below.
// ---------------------------------------------------------------------------

describe('a drift run that could not read Cloudflare', () => {
  it('exits 1 rather than reporting no drift', () => {
    const refusal = unreadableRefusal([
      { what: 'production version', why: 'fetch failed' },
    ])
    expect(refusal.ok).toBe(false)
    expect(refusal.exitCode).toBe(1)
  })

  it('says it is unreadable, in the words a skimmer would need', () => {
    const text = unreadableRefusal([
      { what: 'dev version', why: 'fetch failed' },
    ]).lines.join('\n')

    expect(text).toContain('UNREADABLE')
    // THE SENTENCE THAT MATTERS. The old output said 'could not be read' too,
    // and was still read as a clean bill of health, because nothing told the
    // reader what the absence of a verdict meant.
    expect(text).toContain('THIS IS NOT A REPORT OF NO DRIFT')
  })

  it('names every thing it could not read, and why', () => {
    const text = unreadableRefusal([
      { what: 'dev version', why: 'fetch failed' },
      { what: 'production artifact probe', why: 'ETIMEDOUT' },
    ]).lines.join('\n')

    expect(text).toContain('dev version: fetch failed')
    expect(text).toContain('production artifact probe: ETIMEDOUT')
  })

  it('stays silent and exits 0 when everything was read', () => {
    // THE OTHER HALF OF THE RULING, and the reason this is not simply a
    // stricter check: drift itself still does not gate. Being ahead of
    // production is the normal state of development, and a gate that fails on
    // the normal state is a gate people learn to skip.
    const refusal = unreadableRefusal([])
    expect(refusal.ok).toBe(true)
    expect(refusal.exitCode).toBe(0)
    expect(refusal.lines).toEqual([])
  })
})

// ── AND THE SCRIPT ACTUALLY USES IT ────────────────────────────────────
//
// A rule nothing calls is a rule that passes its own tests forever. The three
// places that matter are read out of the source, the same way
// `net-pay-guard.test.ts` reads its fence: both unreadable paths must record,
// and the exit code must come from the refusal rather than from a literal.
// ── THE ONE EXEMPTION, AND ITS POLARITY ────────────────────────────────
//
// CI scopes CLOUDFLARE_API_TOKEN to the deploy step, so the gate has never
// been able to read either worker — run 35310541290 printed `could not be
// read` for both while nothing at all was wrong. Making unreadability fatal
// without this exemption would fail every CI run on a condition that is
// configuration rather than breakage.
//
// The polarity is the part worth guarding: everything NOT recognised here is
// fatal. Written the other way round — a list of fatal errors, everything
// else benign — the next unfamiliar failure would exit 0 and the ruling would
// be back where it started.
describe('wrangler failing for want of a credential', () => {
  const recognise = isMissingCredentials as (text: string) => boolean

  it('recognises what CI actually gets', () => {
    // Captured from wrangler by running it with an empty home directory.
    expect(
      recognise(
        'In a non-interactive environment, it is necessary to set a ' +
          'CLOUDFLARE_API_TOKEN environment variable for wrangler to work.',
      ),
    ).toBe(true)
  })

  it('does NOT recognise the failure the ruling is about', () => {
    // The 2026-09-18 output, verbatim from wrangler.
    expect(
      recognise(
        'A fetch request failed, likely due to a connectivity issue. ' +
          'Common causes: - No internet connection',
      ),
    ).toBe(false)
  })

  it.each([
    ['fetch failed'],
    ['getaddrinfo ENOTFOUND api.cloudflare.com'],
    ['connect ETIMEDOUT'],
    ['socket hang up'],
    [''],
  ])('treats %s as fatal, not as a missing credential', (text) => {
    expect(recognise(text)).toBe(false)
  })
})

describe('check-deploy-drift.mjs', () => {
  const source = readFileSync('scripts/check-deploy-drift.mjs', 'utf8')

  // EACH CALL SITE READ ON ITS OWN, because the first attempt did not and the
  // break harness caught it. `unreadable.push({[\s\S]*?artifact probe` matched
  // from the FIRST push forward to the second site's words, so breaking the
  // artifact push changed nothing and the guard went on passing — an
  // instrument satisfying itself from the thing next door, which is flag 88 in
  // miniature. Split on the call, then read each one alone.
  const pushes = source
    .split('unreadable.push({')
    .slice(1)
    .map((chunk) => chunk.slice(0, 200))

  it('records both unreadable paths and no others', () => {
    expect(pushes).toHaveLength(2)
  })

  it('records the version read that threw', () => {
    expect(pushes.filter((chunk) => /\} version`/.test(chunk))).toHaveLength(1)
  })

  it('records the artifact probe it could not reach', () => {
    expect(
      pushes.filter((chunk) => /artifact probe`/.test(chunk)),
    ).toHaveLength(1)
  })

  it('takes its exit code from the refusal, not from a literal 0', () => {
    expect(source).toContain('process.exit(refusal.exitCode)')
    // The old `process.exit(0)` at the bottom is what this replaced. If one
    // comes back, the refusal above it is decoration.
    expect(source).not.toMatch(/\nprocess\.exit\(0\)/)
  })
})
