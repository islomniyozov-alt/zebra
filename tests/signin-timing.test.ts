import { describe, expect, it } from 'vitest'
import {
  firstFrameOf,
  isolateMark,
  newSignInSpans,
  scrubMessage,
  signInErrorLine,
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
      membershipMaxWaitMs: 5_000,
      membershipTimeoutMs: 10_000,
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
        'membershipMaxWaitMs',
        'membershipTimeoutMs',
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
      // The budget the membership transaction ran under (GAPS 37), beside it.
      membershipMaxWaitMs: 5_000,
      membershipTimeoutMs: 10_000,
      // The current profile, as a literal: the line must say what the code
      // hashes with (GAPS 28 moved it from m=19456,t=2,p=1).
      argon2: 'm=7168,t=5,p=1',
      startedAt: '2026-10-12T09:00:00.000Z',
    })
  })

  // GAPS 37, owner's ruling 2026-10-23: what threw, named, without PII.
  it('names an error’s class, message and first frame, and nothing else', () => {
    const error = new TypeError('Connection terminated unexpectedly')
    const line = JSON.parse(signInErrorLine(error))
    expect(Object.keys(line).sort()).toEqual(
      ['event', 'class', 'message', 'firstFrame'].sort(),
    )
    expect(line).toMatchObject({
      event: 'signin.error',
      class: 'TypeError',
      message: 'Connection terminated unexpectedly',
    })
    expect(line.firstFrame).toMatch(/^at /)
  })

  it('scrubs a credential in a URL and an email address, and caps the message', () => {
    expect(
      scrubMessage(
        "Can't reach postgresql://zebra_app:s3cret@ep-x.neon.tech/db for islom@example.test",
      ),
    ).toBe("Can't reach postgresql://<redacted>@ep-x.neon.tech/db for <email>")
    expect(scrubMessage('x'.repeat(500))).toHaveLength(300)
    expect(firstFrameOf(undefined)).toBeNull()
    expect(firstFrameOf('Error: boom\n    at login (file:///a.js:1:2)')).toBe(
      'at login (file:///a.js:1:2)',
    )
    // Not an Error at all: still a line, still named.
    expect(JSON.parse(signInErrorLine('a string'))).toMatchObject({
      class: 'string',
      message: 'a string',
      firstFrame: null,
    })
  })

  it('an isolate’s first sign-in has no idle figure; the next has the gap', () => {
    const first = isolateMark(1_000_000)
    const second = isolateMark(1_045_000)
    expect(second.isolateSignIns).toBe(first.isolateSignIns + 1)
    expect(second.isolateIdleMs).toBe(45_000)
  })
})
