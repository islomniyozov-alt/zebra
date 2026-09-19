import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  parentBranchVerdict,
  REQUIRED_PARENT,
} from '../scripts/ci-parent-branch.mjs'

// ---------------------------------------------------------------------------
// CI MUST FORK dev, AND SAY SO WHEN IT IS NOT.
//
// `NEON_PARENT_BRANCH` is an opaque id in a secret. When it pointed two
// migrations behind dev, two runs went red — and neither said "the parent is
// wrong". They said `20260918070000_team_driving_co_driver … expected [2] to
// deeply equal []`, and then a Prisma error about a column that was not there.
//
// An id cannot be eyeballed; a name can. The judgement is tested here rather
// than through the API, because a check about which branch CI forks should not
// need a Neon account to prove it works.
// ---------------------------------------------------------------------------

const verdict = parentBranchVerdict as (
  name: string | null | undefined,
  expected?: string,
) => { ok: boolean; lines: string[] }

describe('the branch CI forks', () => {
  it('accepts dev', () => {
    const outcome = verdict('dev')
    expect(outcome.ok).toBe(true)
    expect(outcome.lines.join('\n')).toContain('dev')
  })

  it('refuses a branch that is not dev, and names what it found', () => {
    // THE WRONG ID, which is the whole reason this exists.
    const outcome = verdict('br-orange-hall-ayrtyh83')
    expect(outcome.ok).toBe(false)
    expect(outcome.lines.join('\n')).toContain('br-orange-hall-ayrtyh83')
    expect(outcome.lines.join('\n')).toContain('not "dev"')
  })

  it('says what the wrong branch will look like if it is not caught here', () => {
    // The refusal has to be more useful than the failure it replaces,
    // otherwise the next person reads "parent is wrong" and still has to
    // work out what that costs.
    const text = verdict('staging').lines.join('\n')
    expect(text).toContain('missing migrations')
    expect(text).toContain('35321964790')
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['whitespace', '   '],
  ])('refuses a parent Neon would not name (%s)', (_label, name) => {
    // A deleted branch id answers with no name rather than an error, and
    // "unnamed" must not read as "fine".
    const outcome = verdict(name)
    expect(outcome.ok).toBe(false)
    expect(outcome.lines.join('\n')).toContain('cannot be identified')
  })

  it('is the branch the ruling names', () => {
    expect(REQUIRED_PARENT).toBe('dev')
  })
})

// ── AND THE WORKFLOWS ACTUALLY CALL IT ─────────────────────────────────
//
// A refusal nothing invokes is a refusal that passes its own tests forever.
// Read out of the YAML, the same way `production-credential.test.ts` reads its
// allowlist — and required to come BEFORE the branch is created, because a
// check that runs after the fork has already forked the wrong thing.
describe('the workflows', () => {
  const workflows = readdirSync('.github/workflows').filter((f) =>
    /\.ya?ml$/.test(f),
  )

  it('are actually being read', () => {
    expect(workflows.length).toBeGreaterThan(1)
  })

  it.each(['ci.yml', 'deploy-production.yml'])(
    '%s checks the parent before it forks it',
    (file) => {
      const text = readFileSync(join('.github/workflows', file), 'utf8')
      const check = text.indexOf('node scripts/ci-parent-branch.mjs')
      const fork = text.indexOf('/branches"')

      expect(check, `${file} never checks the parent branch`).toBeGreaterThan(
        -1,
      )
      expect(fork, `${file} never creates a branch`).toBeGreaterThan(-1)
      expect(check, `${file} checks the parent AFTER forking it`).toBeLessThan(
        fork,
      )
    },
  )
})
