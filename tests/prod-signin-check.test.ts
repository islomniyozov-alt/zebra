import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  PROD_FIRST_QUERY_BUDGET_MS,
  PRODUCTION_BASE,
  verdictFor,
} from '../scripts/prod-signin-check.mjs'

// ---------------------------------------------------------------------------
// PRODUCTION'S FIRST QUERY IS CHECKED, NOT ASSUMED (TMS-DESIGN-SYSTEM.md §6.8,
// owner's ruling 2026-10-12, closing GAPS 24). The check signs in to
// production once and reads the sign-in's first-query span from the tail;
// what can be held without production is the budget and the verdict over a
// timing line.
// ---------------------------------------------------------------------------

describe('the production first-query check', () => {
  it('fails at 3 s — a cold start shows as 5 s or more, warm is under 2 s', () => {
    expect(PROD_FIRST_QUERY_BUDGET_MS).toBe(3_000)
    expect(PRODUCTION_BASE).toBe('https://zebra.tajikcargollc.workers.dev')
  })

  it('passes a warm first query and names the number', () => {
    expect(verdictFor({ event: 'signin.timing', rateLimitMs: 1_760 })).toEqual({
      ok: true,
      reason: 'first query 1760 ms',
    })
  })

  it('fails a cold one, and says what it looks like', () => {
    const verdict = verdictFor({ event: 'signin.timing', rateLimitMs: 6_724 })
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toMatch(/6724 ms, budget 3000 ms — a cold start/)
  })

  it('fails by name when there is nothing to read — never passes in silence', () => {
    expect(verdictFor(null).ok).toBe(false)
    expect(verdictFor({ event: 'signin.timing' }).ok).toBe(false)
    const script = readFileSync('scripts/prod-signin-check.mjs', 'utf8')
    // Production never falls back to the owner's password, and the missing
    // Live Check credentials are a NOT OK, not a skip (GAPS 8).
    expect(script).toContain('credentialsFor(base)')
    expect(script).toMatch(
      /if \(!credentials\.ok\) return finish\(false, credentials\.reason/,
    )
    expect(script).toContain('PRODUCTION SIGN-IN FIRST QUERY — NOT OK.')
  })
})
