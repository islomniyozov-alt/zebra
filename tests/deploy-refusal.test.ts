import { describe, expect, it } from 'vitest'
// A plain .mjs script, imported here precisely because `deploy.mjs` cannot be:
// it builds and ships on import, so a test that touched it would deploy the
// application. That is the entire reason the mapping lives in its own file.
import { refusalMessage } from '../scripts/deploy-refusal.mjs'

// ---------------------------------------------------------------------------
// THE DEPLOY GATE'S REFUSAL NAMES THE CAUSE THAT ACTUALLY STOPPED IT.
//
// WHY THIS IS WORTH A TEST AT ALL. On 2026-09-07 the gate printed "the
// integration suite is red" after 482 passing tests — the tree had been edited
// mid-run, so no receipt could be written — and again after a globalSetup race
// in which zero tests ran. Both times it sent the reader to debug tests that
// were fine. An instrument that names the wrong cause is worse than a silent
// one, because it is confidently wrong and gets believed.
//
// THE ASSERTIONS ARE ABOUT MEANING, NOT WORDING. They check that the passing
// case is not called red and that the never-ran case is not called red either,
// which is the property that broke. Pinning the exact sentences would make
// this fail on a rewrite that changed nothing that matters.
// ---------------------------------------------------------------------------

const message = (reason: string | undefined) =>
  (refusalMessage(reason, 'production') as [string, string]).join(' ')

describe('a deploy refused because the tests failed', () => {
  it('says the suite is red, and offers the escape hatch', () => {
    const said = message('tests_failed')
    expect(said).toContain('red')
    expect(said).toContain('--skip-integration')
  })
})

describe('a deploy refused because the tree moved under the run', () => {
  it('says the suite PASSED, so nobody goes looking for a broken test', () => {
    const said = message('tree_moved')
    expect(said).toContain('THE SUITE PASSED')
    expect(said).toContain('Nothing is wrong with the tests')
    // THE REGRESSION, ASSERTED DIRECTLY. This is the exact word that was wrong.
    expect(said).not.toContain('red')
  })

  it('names the action that actually clears it', () => {
    const said = message('tree_moved')
    expect(said).toMatch(/commit or stash/i)
    expect(said).toContain('leave the tree alone')
  })
})

describe('a deploy refused because the suite could not start', () => {
  it('does not claim anything about the tests either way', () => {
    const said = message('not_runnable')
    expect(said).toContain('could not run')
    expect(said).toContain('nothing has been proven')
    expect(said).not.toContain('red')
    // It never reached them, so it must not tell anyone to fix them.
    expect(said).not.toContain('--skip-integration')
  })
})

describe('a reason the mapping does not know', () => {
  it('falls back to the test-failure wording rather than inventing one', () => {
    // CONSERVATIVE ON PURPOSE: being sent to look at the tests needlessly is
    // cheaper than being told, wrongly, that nothing is wrong.
    for (const reason of [undefined, 'something_new']) {
      expect(message(reason)).toContain('red')
    }
  })

  it('always returns a headline and an advice line', () => {
    for (const reason of [
      'tests_failed',
      'tree_moved',
      'not_runnable',
      undefined,
    ]) {
      const pair = refusalMessage(reason, 'dev') as [string, string]
      expect(pair).toHaveLength(2)
      expect(pair[0].length).toBeGreaterThan(0)
      expect(pair[1].length).toBeGreaterThan(0)
    }
  })
})

describe('the target it names', () => {
  it('is the one being deployed to, in every branch', () => {
    // A refusal that says PRODUCTION while refusing a dev deploy sends
    // somebody to the wrong database — the same mistake check-migration-gap
    // records having made with its remediation text.
    for (const reason of ['tests_failed', 'tree_moved', 'not_runnable']) {
      expect(message(reason)).toContain('production')
      expect(
        (refusalMessage(reason, 'dev') as [string, string]).join(' '),
      ).toContain('dev')
    }
  })
})
