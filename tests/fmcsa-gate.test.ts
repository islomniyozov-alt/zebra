import { beforeEach, describe, expect, it } from 'vitest'
import {
  OVERALL_LIMIT,
  PER_USER_LIMIT,
  WINDOW_MS,
  resetLookupBudget,
  takeLookupSlot,
} from '@/lib/fmcsa-gate'

// Phase 6 §7 flag 24's parked half, landed. The budget protects the SHARED
// `FMCSA_WEBKEY` — one credential a public service can throttle or revoke for
// every tenant at once — now that `customer:create` puts the lookup in front
// of every operator role but ACCOUNTING.
//
// `now` is injected throughout, so none of this is a story about `setTimeout`.

const T0 = 1_760_000_000_000

beforeEach(() => resetLookupBudget())

describe('the per-person budget', () => {
  it('allows a run of lookups and then refuses, saying how long', () => {
    for (let i = 0; i < PER_USER_LIMIT; i++) {
      expect(takeLookupSlot('u1', T0).allowed).toBe(true)
    }
    const refused = takeLookupSlot('u1', T0)
    expect(refused.allowed).toBe(false)
    // A number of seconds, not "later" — §10's rule about errors saying what
    // to do applies to being told to wait.
    expect(refused.retryAfterSeconds).toBeGreaterThan(0)
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(WINDOW_MS / 1000)
  })

  it('does not spend one person’s budget on another’s lookups', () => {
    for (let i = 0; i < PER_USER_LIMIT; i++) takeLookupSlot('u1', T0)
    expect(takeLookupSlot('u2', T0).allowed).toBe(true)
  })

  it('refills as the window slides, not all at once', () => {
    for (let i = 0; i < PER_USER_LIMIT; i++) takeLookupSlot('u1', T0 + i)
    expect(takeLookupSlot('u1', T0 + PER_USER_LIMIT).allowed).toBe(false)

    // The oldest lookup ages out; exactly one slot comes back.
    const later = T0 + WINDOW_MS + 1
    expect(takeLookupSlot('u1', later).allowed).toBe(true)
    expect(takeLookupSlot('u1', later).allowed).toBe(true)
  })

  // A RATE LIMITER THAT PUNISHES RETRYING TURNS A BURST INTO AN OUTAGE.
  // Recording refused attempts would push the oldest allowed one out of the
  // window on every retry, so a client in a tight loop would never recover.
  it('does not charge for a refused attempt', () => {
    for (let i = 0; i < PER_USER_LIMIT; i++) takeLookupSlot('u1', T0)
    for (let i = 0; i < 50; i++) takeLookupSlot('u1', T0 + 1_000)

    // One window after the ALLOWED ones, the budget is back — the fifty
    // refusals in between did not extend the lockout.
    expect(takeLookupSlot('u1', T0 + WINDOW_MS + 1).allowed).toBe(true)
  })
})

describe('the overall budget', () => {
  it('stops many polite users from together exceeding the key’s share', () => {
    let allowed = 0
    // Each user stays inside their own budget; together they pass the total.
    for (let user = 0; user < 40; user++) {
      for (let i = 0; i < PER_USER_LIMIT; i++) {
        if (takeLookupSlot(`u${user}`, T0).allowed) allowed++
      }
    }
    expect(allowed).toBe(OVERALL_LIMIT)
  })

  it('is not spent by refusals either', () => {
    for (let i = 0; i < OVERALL_LIMIT * 3; i++) {
      takeLookupSlot(`user-${i % 40}`, T0)
    }
    expect(takeLookupSlot('fresh', T0 + WINDOW_MS + 1).allowed).toBe(true)
  })
})
