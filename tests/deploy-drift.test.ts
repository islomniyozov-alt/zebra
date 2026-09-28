import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// Plain .mjs tooling, deliberately outside the app's build. Typed at the call
// sites below rather than with a .d.ts nobody would keep in step.
import {
  classify,
  commitFromStamp,
  isMissingCredentials,
  looksLikeCommit,
  stampFor,
  unreadableRefusal,
  STAMP_PREFIX,
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

// ---------------------------------------------------------------------------
// A SHORT SHA THAT IS ALSO A NUMBER. Owner's ruling, 2026-09-28.
//
// Production deployed `9838e03` and `check:drift` read it back as `9838000` —
// the sha parsed as scientific notation, 9838 × 10³, because a bare
// `--message 9838e03` is a numeric-looking CLI argument and is coerced before it
// reaches Cloudflare. Nothing on the reading side can undo that: `9838000` could
// have been `9838e03`, `98380e02` or `983800e01`.
//
// IT FAILED LOUDLY, which is why it cost an hour and not a week. But it left the
// one instrument that says where production stands unable to say it.
//
// THE FIX IS THE PREFIX, and these are the tests that would have caught it.
// ---------------------------------------------------------------------------

describe('a stamp can never parse as a number', () => {
  // THE SHA THAT BROKE IT, and the shape of the class: `^\d+e\d+$`.
  const NUMERIC_SHA = '9838e03'

  it('the sha alone IS a number, which is the whole problem', () => {
    // Stated in the test rather than trusted: this is the premise everything
    // below rests on, and it is one line to check.
    expect(Number(NUMERIC_SHA)).toBe(9_838_000)
    expect(Number.isNaN(Number(NUMERIC_SHA))).toBe(false)
  })

  it('the STAMPED form is not', () => {
    const stamp = stampFor(NUMERIC_SHA, false)
    expect(stamp).toBe('sha-9838e03')
    // NaN is the assertion: any parser that tries to make this a number fails,
    // which is exactly what the CLI argument needed.
    expect(Number.isNaN(Number(stamp))).toBe(true)
  })

  it('and the reader gets the sha back out of it', () => {
    expect(commitFromStamp(stampFor(NUMERIC_SHA, false))).toBe(NUMERIC_SHA)
  })

  it('carries +dirty through the prefix', () => {
    expect(stampFor(NUMERIC_SHA, true)).toBe('sha-9838e03+dirty')
    expect(commitFromStamp('sha-9838e03+dirty')).toBe('9838e03+dirty')
  })

  // ── EVERY SHORT SHA STAMPS TO SOMETHING NON-NUMERIC ─────────────────────
  //
  // Not just the one that bit. A sha is seven hex characters, so the numeric
  // ones are those matching `^\d+e\d+$`; this walks a handful of that shape
  // plus ordinary ones and asserts the property for all of them.
  it.each([
    '9838e03',
    '1234e56',
    '123e456',
    '0e00000',
    '2819d73',
    'abc1234',
    '0123456789abcdef0123456789abcdef01234567',
  ])('%s stamps to a non-numeric string', (sha) => {
    expect(Number.isNaN(Number(stampFor(sha, false)))).toBe(true)
    expect(commitFromStamp(stampFor(sha, false))).toBe(sha)
  })

  // ── THE LEGACY BARE FORM STILL READS ────────────────────────────────────
  //
  // Every version already deployed carries an unprefixed sha. A reader that only
  // understood the new shape would call the whole deployment history unstamped
  // the moment this shipped — which is the loudest possible way to fix a quiet
  // bug and still be wrong.
  it('still reads a bare sha from before the prefix existed', () => {
    expect(commitFromStamp('2819d73')).toBe('2819d73')
    expect(commitFromStamp('9838e03')).toBe('9838e03')
    expect(looksLikeCommit('2819d73')).toBe(true)
  })

  // A COERCED NUMBER IS NOT RECOVERABLE AND IS NOT PRETENDED TO BE. `9838000`
  // is seven hex digits, so it reads as a commit and git then says it is not one
  // in this clone — loud, which is what happened and what should happen.
  it('hands a coerced number on rather than guessing what it was', () => {
    expect(commitFromStamp('9838000')).toBe('9838000')
    expect(commitFromStamp('9838000')).not.toBe('9838e03')
  })

  it('refuses a message that names no commit at all', () => {
    for (const message of ['', null, 'Updated secrets via dashboard', 'sha-']) {
      expect(commitFromStamp(message)).toBeNull()
      expect(looksLikeCommit(message)).toBe(false)
    }
  })

  // ── AND `classify` COMPARES THE STRIPPED COMMIT ─────────────────────────
  //
  // The end of the chain: a prefixed stamp of HEAD has to read as `current`, or
  // every deploy from now on would report itself behind.
  it('calls a prefixed stamp of HEAD current', () => {
    expect(
      classify({
        label: 'production',
        deployedMessage: stampFor(NUMERIC_SHA, false),
        head: NUMERIC_SHA,
        isKnownCommit: true,
        changedSourceFiles: [],
      }),
    ).toEqual({ state: 'current', loud: false })
  })

  it('and still measures a prefixed stamp that IS behind', () => {
    const verdict = classify({
      label: 'production',
      deployedMessage: stampFor('2819d73', false),
      head: '9838e03',
      isKnownCommit: true,
      changedSourceFiles: ['src/lib/this-week.ts'],
    })
    expect(verdict.state).toBe('behind-source')
    expect(verdict.loud).toBe(true)
  })

  it('states the prefix once, where both sides read it', () => {
    expect(STAMP_PREFIX).toBe('sha-')
    expect(stampFor('abc1234', false).startsWith(STAMP_PREFIX)).toBe(true)
  })

  // ── AND THE DEPLOY DOES NOT BUILD THE MESSAGE ITSELF ────────────────────
  //
  // The rules module can be perfect and the bug still ship: what reached
  // Cloudflare on 2026-09-28 was a string `deploy.mjs` composed on its own line.
  // A prefix agreed by two files that each spell it is the same class of bug one
  // layer up, so this reads the deploy's source and checks it asks.
  //
  // SOURCE-GREPPED because `deploy.mjs` shells out to git, wrangler and the
  // integration gate on import — the rules module exists precisely so a test can
  // import something that does not.
  it('has the deploy stamp through stampFor rather than composing it', () => {
    const source = readFileSync('scripts/deploy.mjs', 'utf8')
    expect(source).toContain("from './deploy-drift-rules.mjs'")
    expect(source).toContain('stampFor(sha, dirty)')
    // THE SHAPE THAT WAS THERE BEFORE, asserted absent by its own text.
    expect(source).not.toContain('`${sha}+dirty`')
  })
})
