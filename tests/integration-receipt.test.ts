import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
// A plain .mjs script, deliberately outside the app's build: the deploy
// tooling must run from a bare checkout without a TypeScript step.
import {
  checkReceipt,
  RECEIPT_MAX_AGE_MS,
} from '../scripts/integration-receipt.mjs'

// ---------------------------------------------------------------------------
// THE RECEIPT, WATCHED REFUSING.
//
// The suite costs 54 minutes on this machine — measured: 405 tests, 3254
// seconds — so a green run may stand in for a re-run when `deploy:prod`
// follows it. Four conditions keep that from becoming a way around the gate,
// and every one of them is a test here rather than a belief. That is the
// lesson from the guard that stayed silent: an `if` nobody has watched fail is
// an `if` nobody knows the behaviour of.
// ---------------------------------------------------------------------------

const HEAD = 'a'.repeat(40)
const OTHER = 'b'.repeat(40)
const ENDPOINT = 'ep-little-lake-aydu7faj.c-5.us-east-2.aws.neon.tech'
const NOW = Date.parse('2026-08-14T12:00:00.000Z')

const receipt = (over: Record<string, unknown> = {}) => ({
  commit: HEAD,
  clean: true,
  endpoint: ENDPOINT,
  finishedAt: new Date(NOW - 10 * 60_000).toISOString(),
  ...over,
})

const check = (
  over: Record<string, unknown> = {},
  world: Record<string, unknown> = {},
) =>
  checkReceipt({
    receipt: receipt(over),
    now: NOW,
    head: HEAD,
    clean: true,
    endpoint: ENDPOINT,
    ...world,
  })

describe('a receipt that stands', () => {
  it('accepts a recent green run of this exact commit on a clean tree', () => {
    const outcome = check()
    expect(outcome.ok).toBe(true)
    expect(outcome.ageMinutes).toBe(10)
  })

  // THE OWNER'S CONSTRAINT, AS ARITHMETIC. The stamp is the FINISH of the run,
  // so a 54-minute suite leaves 60 minutes of life rather than six. A receipt
  // stamped at the start would already be nearly dead on arrival.
  it('is still good 59 minutes after the suite FINISHED', () => {
    expect(
      check({ finishedAt: new Date(NOW - 59 * 60_000).toISOString() }).ok,
    ).toBe(true)
    expect(RECEIPT_MAX_AGE_MS).toBe(60 * 60 * 1000)
  })
})

describe('and the four ways it does not', () => {
  it('refuses a receipt for a different commit', () => {
    expect(check({ commit: OTHER })).toMatchObject({
      ok: false,
      reason: 'wrong_commit',
    })
  })

  // Two halves, and both matter. A run on a dirty tree describes code that is
  // in no commit; a clean run says nothing about a tree edited since.
  it('refuses a run that happened on a dirty tree', () => {
    expect(check({ clean: false })).toMatchObject({
      ok: false,
      reason: 'earned_dirty',
    })
  })

  it('refuses when the tree has been touched since the run', () => {
    expect(check({}, { clean: false })).toMatchObject({
      ok: false,
      reason: 'tree_dirty',
    })
  })

  it('refuses a receipt earned against another database', () => {
    expect(
      check({}, { endpoint: 'ep-somewhere-else.c-5.us-east-2.aws.neon.tech' }),
    ).toMatchObject({ ok: false, reason: 'wrong_endpoint' })
  })

  it('refuses one that has gone stale', () => {
    expect(
      check({ finishedAt: new Date(NOW - 61 * 60_000).toISOString() }),
    ).toMatchObject({ ok: false, reason: 'stale' })
  })

  it('refuses nothing at all, and says so rather than throwing', () => {
    expect(
      checkReceipt({
        receipt: null,
        now: NOW,
        head: HEAD,
        clean: true,
        endpoint: ENDPOINT,
      }),
    ).toMatchObject({ ok: false, reason: 'none' })
  })

  // A clock that moved is exactly what an age check cannot reason about.
  it('refuses a receipt dated in the future', () => {
    expect(
      check({ finishedAt: new Date(NOW + 5 * 60_000).toISOString() }),
    ).toMatchObject({ ok: false, reason: 'future' })
  })

  it('refuses one with an unreadable timestamp', () => {
    expect(check({ finishedAt: 'whenever' })).toMatchObject({
      ok: false,
      reason: 'unreadable',
    })
  })
})

describe('the wiring, so the conditions cannot be bypassed around', () => {
  const gate = readFileSync('scripts/integration-gate.mjs', 'utf8')
  const deploy = readFileSync('scripts/deploy.mjs', 'utf8')
  const ignore = readFileSync('.gitignore', 'utf8')

  // ONE LAUNCHER. A run that earns a receipt and a run that gates a deploy
  // must be the same run, launched the same way, or the receipt describes
  // something other than the gate.
  it('launches the suite from exactly one place', () => {
    expect(gate).toMatch(/--project['"\s,]+integration/)
    expect(deploy).not.toMatch(/--project['"\s,]+integration/)
    expect(deploy).toContain('runIntegrationSuite()')
  })

  it('writes the receipt only after a green run', () => {
    // The write follows the exit-status check, not the spawn.
    expect(gate.indexOf('result.status !== 0')).toBeLessThan(
      gate.indexOf('writeReceipt('),
    )
  })

  // SKIPPING EARNS NOTHING. There must be no path from "I did not run it" to
  // "it was run".
  it('writes no receipt when the suite is skipped', () => {
    const skipBlock = deploy.slice(
      deploy.indexOf("--skip-integration'"),
      deploy.indexOf('} else {'),
    )
    expect(skipBlock).not.toContain('writeReceipt')
    expect(skipBlock).toContain('SKIPPING THE INTEGRATION SUITE')
  })

  it('keeps the receipt out of git', () => {
    expect(ignore).toContain('.integration-receipt.json')
  })

  // Still before the build, and still refusing on red.
  it('still decides before anything is built', () => {
    expect(deploy.indexOf('the integration suite is red')).toBeLessThan(
      deploy.indexOf("run(['opennextjs-cloudflare', 'build'])"),
    )
  })

  it('still scrubs the terminal, in the launcher it moved to', () => {
    expect(gate).toMatch(
      /SCRUBBED\s*=\s*\[\s*'DATABASE_URL',\s*'DIRECT_DATABASE_URL',\s*'NEON_BRANCH'/,
    )
    expect(gate).toContain('delete child[name]')
    expect(gate).toContain('env: child')
  })
})
