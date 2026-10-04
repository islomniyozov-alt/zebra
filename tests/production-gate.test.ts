import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  assertProductionWrite,
  checkProductionWrite,
  isProductionLabel,
} from '../prisma/production-gate'

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
    const verdict = checkProductionWrite(
      env({ NEON_BRANCH: 'production', NODE_ENV: 'production' }),
      'seed',
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
    expect(verdict.message).toContain('MISSING: ALLOW_PROD_MIGRATION=1')
    expect(verdict.message).toContain('seed')
    expect(verdict.message).toContain('NEVER in .env')
  })

  it('and says "migration" when it is a migration being refused', () => {
    const verdict = checkProductionWrite(
      env({ NEON_BRANCH: 'production', NODE_ENV: 'production' }),
      'migration',
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
  it('with the label, NODE_ENV and the override all present', () => {
    expect(
      checkProductionWrite(
        {
          NEON_BRANCH: 'production',
          NODE_ENV: 'production',
          ALLOW_PROD_MIGRATION: '1',
        },
        'migration',
      ),
    ).toEqual({ ok: true, production: true })
  })

  it('and the assertion throws for a refusal and returns for a pass', () => {
    expect(() =>
      assertProductionWrite(env({ NEON_BRANCH: 'production' }), 'seed'),
    ).toThrow(/NODE_ENV is not production/)

    expect(() => assertProductionWrite(env(), 'seed')).not.toThrow()
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
          `^\\s*assertProductionWrite\\(process\\.env, '${operation}'\\)`,
          'm',
        ),
      )
    },
  )

  it('and the seed asks BEFORE it builds a client or reads the URL', () => {
    // A REFUSAL THAT HAS ALREADY OPENED A SOCKET TO PRODUCTION has already done
    // the thing it was refusing. Order is the claim, so order is the assertion.
    const source = readFileSync('prisma/seed.ts', 'utf8')
    const gate = source.indexOf("assertProductionWrite(process.env, 'seed')")
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
    const gate = source.indexOf("assertProductionWrite(process.env, 'seed')")
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
