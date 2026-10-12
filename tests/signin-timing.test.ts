import { describe, expect, it } from 'vitest'
import {
  isolateMark,
  newSignInSpans,
  signInTimingLine,
} from '@/lib/signin-timing'

// ---------------------------------------------------------------------------
// GAPS 24, MEASUREMENT ONLY. The sign-in writes one structured line per
// attempt; these hold its shape — numbers, an outcome, a role, the argon2
// parameters, and NOTHING that could carry an email or a hash.
// ---------------------------------------------------------------------------

describe('the sign-in timing line', () => {
  it('carries exactly the named fields', () => {
    const spans = {
      ...newSignInSpans(),
      rateLimitMs: 40,
      lookupMs: 20,
      membershipMs: 1215,
      sessionMs: 18,
      finalizeMs: 22,
      totalMs: 625,
      attempts: 1,
      role: 'ACCOUNTING',
    }
    const line = JSON.parse(
      signInTimingLine({
        outcome: 'ok',
        spans,
        actionMs: 640,
        isolate: { isolateSignIns: 3, isolateIdleMs: 12_000 },
        startedAt: Date.UTC(2026, 9, 12, 9, 0, 0),
      }),
    )
    expect(Object.keys(line).sort()).toEqual(
      [
        'event',
        'outcome',
        'role',
        'attempts',
        'rateLimitMs',
        'lookupMs',
        'membershipMs',
        'sessionMs',
        'finalizeMs',
        'totalMs',
        'actionMs',
        'sinceModuleEvalMs',
        'isolateSignIns',
        'isolateIdleMs',
        'startedAt',
        'argon2',
      ].sort(),
    )
    expect(line).toMatchObject({
      event: 'signin.timing',
      outcome: 'ok',
      role: 'ACCOUNTING',
      membershipMs: 1215,
      argon2: 'm=19456,t=2,p=1',
      startedAt: '2026-10-12T09:00:00.000Z',
    })
  })

  it('an isolate’s first sign-in has no idle figure; the next has the gap', () => {
    const first = isolateMark(1_000_000)
    const second = isolateMark(1_045_000)
    expect(second.isolateSignIns).toBe(first.isolateSignIns + 1)
    expect(second.isolateIdleMs).toBe(45_000)
  })
})
