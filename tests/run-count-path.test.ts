import { describe, expect, it } from 'vitest'
import { FAILURE_LOG, RUN_COUNT_FILE } from './failure-log'
// @ts-expect-error — a .mjs script with no declarations. Imported for its
// CONSTANTS only; `runIntegrationSuite` is never called from here.
import * as gate from '../scripts/integration-gate.mjs'

// ---------------------------------------------------------------------------
// TWO DERIVATIONS OF ONE PATH, KEPT HONEST.
//
// The reporter writes the run count from TypeScript and the deploy gate reads
// it from a `.mjs` script that cannot import the TypeScript. So the path is
// derived twice, on purpose — the `.mjs`/`.ts` boundary leaves no alternative,
// exactly as it already did for the failure log itself.
//
// THE DUPLICATION STAYS AND THE DRIFT BECOMES DETECTABLE. Two copies of a rule
// are one copy of a rule and one bug waiting; what makes this survivable is
// not care, it is that a change to either side fails here by name. If they
// diverge the gate reads a file nobody writes, finds no count, and — because
// null is deliberately not zero — silently stops distinguishing "the suite is
// red" from "no test ran", which is the entire failure this count was added to
// fix. A silent regression of a fix for a silent regression.
// ---------------------------------------------------------------------------

describe('the run-count path, derived on both sides of the .mjs boundary', () => {
  it('is the same string in the writer and the reader', () => {
    expect(gate.RUN_COUNT_FILE).toBe(RUN_COUNT_FILE)
  })

  it('agrees about the failure log it hangs off', () => {
    // The gate injects its FAILURE_LOG as ZEBRA_FAILURE_LOG for the child, so
    // the TypeScript side resolves to the same value in either context.
    expect(gate.FAILURE_LOG).toBe(FAILURE_LOG)
  })

  it('uses the same suffix rule on both sides', () => {
    // Asserted separately from the equality above: if somebody changes the
    // log's name AND the suffix together, the strings could still match by
    // accident while the rule had quietly become something else.
    expect(RUN_COUNT_FILE).toBe(`${FAILURE_LOG}.count`)
    expect(gate.RUN_COUNT_FILE).toBe(`${gate.FAILURE_LOG}.count`)
  })
})
