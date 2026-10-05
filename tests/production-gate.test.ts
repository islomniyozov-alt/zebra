import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  assertProductionWrite,
  checkProductionWrite,
  isProductionLabel,
  latestMigrationNumber,
} from '../prisma/production-gate'
import {
  PERSISTENT_NAMES,
  readLatestMigrationNumber,
  readPersistedScopes,
  type ScopeRun,
} from '../prisma/gate-readers'

// ---------------------------------------------------------------------------
// WHAT REFUSES A LOCAL WRITE TO THE PRODUCTION BRANCH, AND WHAT DOES NOT.
//
// ── THE GAP THIS CLOSES ──────────────────────────────────────────────────
//
// `prisma.config.ts` has refused `NEON_BRANCH=production` without
// `NODE_ENV=production` and `ALLOW_PROD_MIGRATION=1` since Phase 1, and nothing
// could test it: the checks were `if`s in a file only the Prisma CLI loads. So
// nobody noticed that `prisma/seed.ts` — which writes rows into the carrier's
// own database — had a weaker rule. It ran, upserted the operating group, and
// printed "skipping the isolation counterpart", which is a line about the ONE
// organization it declined to create.
//
// ── CI MUST KEEP WORKING, AND THAT IS A TEST, NOT A HOPE ─────────────────
//
// `ci.yml` sets `NEON_BRANCH=ci-<run id>` against a per-run branch forked from
// dev. A gate that constrained the label to `dev | production` would refuse
// every CI run, so the shape of the CI value is asserted below.
// ---------------------------------------------------------------------------

const env = (over: Record<string, string | undefined> = {}) => ({
  NEON_BRANCH: 'dev',
  NODE_ENV: 'development',
  ...over,
})

/**
 * The two readings a caller takes (owner's ruling 2026-10-05): which migration is
 * being applied, and which variables sit in a persistent Windows scope.
 *
 * `persisted: []` IS NOT THE DEFAULT ANYWHERE IN THE GATE, deliberately — an
 * absent reading is refused on the production path, so every test that wants a
 * pass has to say out loud that the scopes were checked and were clean.
 */
const ctx = (over: Record<string, unknown> = {}) => ({
  expected: 61,
  persisted: [] as string[],
  ...over,
})

describe('a local write to a non-production branch is allowed', () => {
  it('on dev', () => {
    expect(checkProductionWrite(env(), 'seed')).toEqual({
      ok: true,
      production: false,
    })
  })

  it("and on CI's per-run branches, which is what keeps CI working", () => {
    // THE EXACT SHAPES THE WORKFLOWS SET. An allowlist of dev|production would
    // refuse both, and the failure would be every pull request.
    for (const branch of ['ci-1234567890', 'ci-prod-1234567890']) {
      expect(
        checkProductionWrite(env({ NEON_BRANCH: branch }), 'migration'),
      ).toEqual({ ok: true, production: false })
    }
  })

  it('and it does not care about the override when the branch is not production', () => {
    // A LEFTOVER `ALLOW_PROD_MIGRATION` IN A SHELL MUST NOT CHANGE DEV. The
    // override is permission to touch production, not a mode.
    expect(
      checkProductionWrite(env({ ALLOW_PROD_MIGRATION: '1' }), 'seed'),
    ).toEqual({ ok: true, production: false })
  })
})

describe('the production label refuses without the one-shot override', () => {
  it('refuses when NODE_ENV is not production', () => {
    const verdict = checkProductionWrite(
      env({ NEON_BRANCH: 'production' }),
      'migration',
    )
    expect(verdict.ok).toBe(false)
    expect(verdict).toMatchObject({ reason: 'node_env' })
  })

  it('refuses when the override is absent, naming the variable', () => {
    // `ctx()` SAYS THE SCOPES WERE CHECKED AND WERE CLEAN. Without it this
    // refuses with `scopes_unknown` first, which is the fail-closed ordering
    // working — and is how this test caught the new rule rather than ignoring it.
    const verdict = checkProductionWrite(
      env({ NEON_BRANCH: 'production', NODE_ENV: 'production' }),
      'seed',
      ctx(),
    )
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return

    expect(verdict.reason).toBe('missing_override')
    // THE MESSAGE HAS A JOB: name the missing variable, name the operation, and
    // say where it must never be stored. A refusal that does not say what to do
    // gets worked around rather than understood.
    // THE 'MISSING:' LINE SPECIFICALLY. The example command underneath also
    // contains the variable name, so a message that stopped saying WHAT IS
    // MISSING still satisfied a bare toContain — watched, and fixed.
    expect(verdict.message).toContain('MISSING: ALLOW_PROD_MIGRATION=61')
    expect(verdict.message).toContain('seed')
    expect(verdict.message).toContain('NEVER in .env')
  })

  it('and says "migration" when it is a migration being refused', () => {
    const verdict = checkProductionWrite(
      env({ NEON_BRANCH: 'production', NODE_ENV: 'production' }),
      'migration',
      ctx(),
    )
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.message).toContain('migration')
  })

  it('refuses a label nobody set at all', () => {
    const verdict = checkProductionWrite(
      { NEON_BRANCH: undefined, NODE_ENV: 'development' },
      'seed',
    )
    expect(verdict).toMatchObject({ reason: 'missing_branch' })
  })

  it('and an empty or blank label counts as unset rather than as dev', () => {
    for (const branch of ['', '   ']) {
      expect(
        checkProductionWrite(env({ NEON_BRANCH: branch }), 'seed'),
      ).toMatchObject({ reason: 'missing_branch' })
    }
  })
})

describe('the label is folded before it is compared', () => {
  it('catches PRODUCTION, Production and a stray space', () => {
    // `prisma.config.ts` COMPARED IT RAW, so ` Production` would have been waved
    // through as a non-production branch — while `tests/db-target.ts`, which
    // already folds, would have refused the same value. Two guards disagreeing
    // about what the production label looks like is the gap.
    for (const branch of ['PRODUCTION', 'Production', ' production ']) {
      expect(isProductionLabel({ NEON_BRANCH: branch })).toBe(true)
      expect(
        checkProductionWrite(env({ NEON_BRANCH: branch }), 'seed'),
      ).toMatchObject({ ok: false })
    }
  })

  it('and does not mistake a branch that merely contains the word', () => {
    // `pre-production` IS NOT PRODUCTION. A `includes('production')` test would
    // refuse it, which would be a different bug in the safe direction — and
    // still wrong, because it would also refuse a legitimate branch name.
    expect(isProductionLabel({ NEON_BRANCH: 'pre-production' })).toBe(false)
  })
})

describe('the deliberate one-shot production write is allowed', () => {
  it('with the label, NODE_ENV and the override naming the migration', () => {
    expect(
      checkProductionWrite(
        {
          NEON_BRANCH: 'production',
          NODE_ENV: 'production',
          ALLOW_PROD_MIGRATION: '61',
        },
        'migration',
        ctx(),
      ),
    ).toEqual({ ok: true, production: true })
  })

  it('and the assertion throws for a refusal and returns for a pass', () => {
    expect(() =>
      assertProductionWrite(env({ NEON_BRANCH: 'production' }), 'seed', ctx()),
    ).toThrow(/NODE_ENV is not production/)

    expect(() => assertProductionWrite(env(), 'seed', ctx())).not.toThrow()
  })
})

// ── THE VALUE IS THE MIGRATION NUMBER (owner's ruling 2026-10-05) ──────────
//
// `=1` is a value that stays true forever: set it once in a shell profile and the
// gate is off from then on without anybody deciding that. A number expires on its
// own, and naming it means reading what you are about to apply.
describe('the override names the migration being applied', () => {
  const prod = {
    NEON_BRANCH: 'production',
    NODE_ENV: 'production',
  }

  it('refuses the old value by name, because it is what everybody will type', () => {
    const verdict = checkProductionWrite(
      { ...prod, ALLOW_PROD_MIGRATION: '1' },
      'migration',
      ctx({ expected: 62 }),
    )
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.reason).toBe('stale_override')
    expect(verdict.message).toContain('no longer accepted')
    expect(verdict.message).toContain('ALLOW_PROD_MIGRATION=62')
  })

  it('refuses a number that has already landed', () => {
    const verdict = checkProductionWrite(
      { ...prod, ALLOW_PROD_MIGRATION: '61' },
      'migration',
      ctx({ expected: 62 }),
    )
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.reason).toBe('stale_override')
    // THE SENTENCE THAT EXPLAINS THE SURPRISE: a terminal set up for last
    // week's migration.
    expect(verdict.message).toContain('already landed')
  })

  it('accepts the number being applied, and tolerates whitespace around it', () => {
    for (const given of ['62', ' 62 ']) {
      expect(
        checkProductionWrite(
          { ...prod, ALLOW_PROD_MIGRATION: given },
          'migration',
          ctx({ expected: 62 }),
        ),
      ).toEqual({ ok: true, production: true })
    }
  })

  it('names the number in the message when the override is missing entirely', () => {
    const verdict = checkProductionWrite(
      { ...prod },
      'migration',
      ctx({ expected: 62 }),
    )
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.reason).toBe('missing_override')
    expect(verdict.message).toContain('MISSING: ALLOW_PROD_MIGRATION=62')
    expect(verdict.message).toContain('NOT 1')
  })

  it('and asks for the number rather than inventing one when it cannot be read', () => {
    // A MISSING MIGRATIONS DIRECTORY IS NOT MIGRATION ZERO. `expected:
    // undefined` must not become `ALLOW_PROD_MIGRATION=0`, which would be a
    // forever-true value again by another route.
    const verdict = checkProductionWrite(
      { ...prod },
      'migration',
      ctx({ expected: undefined }),
    )
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.message).toContain('<the migration number being applied>')
    expect(verdict.message).not.toContain('ALLOW_PROD_MIGRATION=0')
  })

  it('counts the migrations the way this repository numbers them', () => {
    // 61 directories today and the newest is named `migration_61`. Counted from
    // the listing, not parsed out of a prefix, because the ordinal is the number
    // the owner and AGENTS.md both say out loud.
    expect(
      latestMigrationNumber([
        '20260101010000_first',
        '20260201010000_second',
        'migration_lock.toml',
        'README.md',
      ]),
    ).toBe(2)
    // AND AGAINST THE REAL DIRECTORY, so the number in the message is the number
    // on disk.
    //
    // COUNTED A SECOND WAY rather than pinned to a literal. `toBe(61)` was right
    // for one day and failed on the morning migration 62 landed — a test that
    // has to be edited by every migration is a test people edit without reading.
    // This counts the directories with a different method and compares, which is
    // the claim that actually matters: the number in the refusal is the number on
    // disk.
    const onDisk = readdirSync('prisma/migrations').filter((name) =>
      /^\d{14}_/.test(name),
    ).length
    expect(onDisk).toBeGreaterThanOrEqual(62)
    expect(readLatestMigrationNumber()).toBe(onDisk)
  })
})

// ── AND IT MUST NOT BE SET WHERE IT OUTLIVES THE TERMINAL ─────────────────
describe('a persisted variable is a refusal', () => {
  const prod = {
    NEON_BRANCH: 'production',
    NODE_ENV: 'production',
    ALLOW_PROD_MIGRATION: '61',
  }

  it.each([...PERSISTENT_NAMES])(
    'refuses when %s is in a Windows hive',
    (name) => {
      const verdict = checkProductionWrite(
        prod,
        'migration',
        ctx({ persisted: [name] }),
      )
      expect(verdict.ok).toBe(false)
      if (verdict.ok) return
      expect(verdict.reason).toBe('persisted_variable')
      expect(verdict.message).toContain(name)
      // THE WAY OUT IS IN THE MESSAGE, because the registry is not somewhere
      // anybody browses by habit.
      expect(verdict.message).toContain('reg delete')
    },
  )

  it('refuses before it looks at the value, so a correct number cannot excuse it', () => {
    // A VALID OVERRIDE IN A PERMANENT PLACE IS STILL A PERMANENT OVERRIDE. If the
    // order were reversed this would pass, and the operator would be told their
    // setup was fine.
    const verdict = checkProductionWrite(
      { ...prod, ALLOW_PROD_MIGRATION: '61' },
      'migration',
      ctx({ persisted: ['ALLOW_PROD_MIGRATION'] }),
    )
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.reason).toBe('persisted_variable')
  })

  it('and refuses when the hives could not be read at all', () => {
    // FAIL CLOSED. A check that did not happen must not read as a check that
    // passed — the same rule `run-status --check` follows for a missing file.
    const verdict = checkProductionWrite(
      prod,
      'migration',
      ctx({ persisted: undefined }),
    )
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.reason).toBe('scopes_unknown')
    expect(verdict.message).toContain('not a check that passed')
  })

  it('but says nothing about dev, where the override is not permission for anything', () => {
    expect(
      checkProductionWrite(
        env({ ALLOW_PROD_MIGRATION: '1' }),
        'seed',
        ctx({ persisted: ['NEON_BRANCH'] }),
      ),
    ).toEqual({ ok: true, production: false })
  })

  it('and the reader fails closed on every way the shell can not answer', () => {
    // THE BRANCH NO MACHINE REACHES. PowerShell works here, so this refusal is
    // unreachable in practice — and a break that deleted it was watched NOT
    // firing, which is how it got a test. Each shape means the hives were not
    // read, and each must come back `undefined` rather than an empty list,
    // because an empty list says "checked, clean".
    const shapes: { name: string; run: () => ScopeRun }[] = [
      { name: 'no shell at all', run: () => ({ error: new Error('ENOENT') }) },
      { name: 'a non-zero exit', run: () => ({ status: 1, stdout: '' }) },
      {
        name: 'a killed process',
        run: () => ({ status: null, stdout: undefined }),
      },
      { name: 'no output at all', run: () => ({ status: 0 }) },
    ]
    for (const shape of shapes) {
      expect(
        readPersistedScopes(['ALLOW_PROD_MIGRATION'], shape.run, 'win32'),
        shape.name,
      ).toBeUndefined()
    }

    // AND THE HAPPY PATH THROUGH THE SAME SEAM, so the test above is not just
    // asserting that everything returns undefined.
    expect(
      readPersistedScopes(
        ['ALLOW_PROD_MIGRATION'],
        () => ({ status: 0, stdout: 'ALLOW_PROD_MIGRATION\r\n' }),
        'win32',
      ),
    ).toEqual(['ALLOW_PROD_MIGRATION'])

    // A NAME THE SHELL DID NOT ASK ABOUT IS IGNORED, so a chatty profile line
    // cannot invent a refusal.
    expect(
      readPersistedScopes(
        ['ALLOW_PROD_MIGRATION'],
        () => ({ status: 0, stdout: 'Windows PowerShell\nCopyright\n' }),
        'win32',
      ),
    ).toEqual([])
  })

  it('and off Windows there are no such hives, which is an answer not a failure', () => {
    expect(
      readPersistedScopes(
        ['ALLOW_PROD_MIGRATION'],
        () => ({ status: 0 }),
        'linux',
      ),
    ).toEqual([])
  })

  it('and the reader actually sees a persisted variable, asked of one that is', () => {
    // A POSITIVE CONTROL THAT MUTATES NOTHING. If this came back empty the reader
    // cannot see the hives at all, and every refusal above would be unreachable
    // in the only environment that has them. PATH is in the Machine hive on
    // Windows; elsewhere there are no hives and the honest answer is none.
    const found = readPersistedScopes(['PATH'])
    if (process.platform === 'win32') expect(found).toEqual(['PATH'])
    else expect(found).toEqual([])

    expect(readPersistedScopes(['ZEBRA_NO_SUCH_VARIABLE'])).toEqual([])
  })
})

// ── AND BOTH CALL SITES ACTUALLY ASK IT ────────────────────────────────────
//
// The verdicts above are worth nothing if a file stops consulting them. These
// are source assertions because neither file can be imported here: loading
// `prisma.config.ts` executes its checks against the real environment, and
// `prisma/seed.ts` connects to a database at import time.
describe('the gate is asked by every local path that can write', () => {
  const callers = [
    { file: 'prisma.config.ts', operation: 'migration' },
    { file: 'prisma/seed.ts', operation: 'seed' },
  ]

  it.each(callers)(
    '$file asserts it, naming $operation',
    ({ file, operation }) => {
      const source = readFileSync(file, 'utf8')
      // ANCHORED TO THE START OF A LINE, so a COMMENTED-OUT call does not
      // satisfy it. `toContain` did, and the break that comments the call out
      // was watched PASSING — which would have left the gate unreachable with
      // this guard green.
      expect(source).toMatch(
        new RegExp(
          `^\\s*assertProductionWrite\\(process\\.env, '${operation}', \\{`,
          'm',
        ),
      )
    },
  )

  // ── AND IT HANDS OVER THE REAL READINGS, NOT A STUB ─────────────────────
  //
  // THIS IS THE GUARD THAT MATTERS NOW. `persisted: []` written literally at a
  // call site would mean "the hives were checked and were clean" without anybody
  // having looked — turning the 2026-10-05 rule off while every unit test above
  // still passed, because those test the gate and this tests the caller.
  it.each(callers)('$file takes both readings for real', ({ file }) => {
    const source = readFileSync(file, 'utf8')
    expect(source).toMatch(/^\s*expected: readLatestMigrationNumber\(\),$/m)
    expect(source).toMatch(/^\s*persisted: readPersistedScopes\(\),$/m)
    // AND NEITHER IS SPELLED OUT AS A LITERAL, which is the shortcut somebody
    // takes when the registry read is slow or awkward on their machine.
    expect(source).not.toMatch(/persisted:\s*\[/)
    expect(source).not.toMatch(/expected:\s*\d/)
  })

  it('and the seed asks BEFORE it builds a client or reads the URL', () => {
    // A REFUSAL THAT HAS ALREADY OPENED A SOCKET TO PRODUCTION has already done
    // the thing it was refusing. Order is the claim, so order is the assertion.
    const source = readFileSync('prisma/seed.ts', 'utf8')
    const gate = source.indexOf("assertProductionWrite(process.env, 'seed'")
    const client = source.indexOf('createPrismaClient(url)')
    expect(gate).toBeGreaterThan(-1)
    expect(client).toBeGreaterThan(gate)
  })

  it('and the soft skip is gone from the seed', () => {
    // The old behaviour: run against production, write everything, and print a
    // line about the one organization it declined to create. The line survives
    // for the override case; what must not survive is it being the ONLY
    // production-specific behaviour.
    const source = readFileSync('prisma/seed.ts', 'utf8')
    // THE `console.log`, NOT THE PHRASE. The comment above the gate explains
    // what the soft skip used to be and therefore contains the words — so
    // `indexOf` on the phrase found the explanation and the assertion failed
    // against prose rather than against code.
    const skip = source.indexOf(
      "console.log('  skipping the isolation counterpart",
    )
    const gate = source.indexOf("assertProductionWrite(process.env, 'seed'")
    expect(gate).toBeGreaterThan(-1)
    expect(skip).toBeGreaterThan(-1)
    expect(gate).toBeLessThan(skip)
  })
})

// ── AND THE OVERRIDE IS IN NO COMMITTED FILE AS A VALUE ───────────────────
describe('ALLOW_PROD_MIGRATION is never stored', () => {
  it.each(['.env.example', 'prisma.config.ts', 'prisma/seed.ts'])(
    '%s does not assign it',
    (file) => {
      const source = readFileSync(file, 'utf8')
      // NAMING IT IS FINE — the refusal message and the README both must. What
      // is forbidden is an ASSIGNMENT, which is what would leave it set.
      expect(source).not.toMatch(/ALLOW_PROD_MIGRATION\s*=/)
    },
  )
})
