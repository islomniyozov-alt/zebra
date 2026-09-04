import { describe, expect, it, vi } from 'vitest'
import {
  isStartTransactionFailure,
  retryOnStartFailure,
  retryStats,
} from '@/lib/retry-transaction'

// ---------------------------------------------------------------------------
// RETRY EXACTLY WHAT WAS MEASURED, AND NOTHING ELSE.
//
// Two gates in a row lost tests to the Neon compute rather than to code. Every
// one of the fifteen stack traces in the second ended at
// `PrismaNeonAdapter.startTransaction` — none at `performIO`, `queryRaw` or a
// commit — so the failures happened before anything was written.
//
// THE DANGEROUS WIDENING IS THE OBVIOUS ONE: retry any socket error. A drop
// between COMMIT and the client hearing about it looks identical from here, and
// retrying it re-runs committed work. The tests below pin the narrow scope, and
// the one that matters most is the pairing — a retry that swallowed real
// failures would turn a defect into a slow pass.
// ---------------------------------------------------------------------------

/** The shape the gate actually produced, message empty and stack carrying all. */
function startFailure(): Error {
  const error = new Error('')
  error.stack =
    'Error: \n    at file:///.../@neondatabase/serverless/index.mjs:1087:33\n' +
    '    at PrismaNeonAdapter.startTransaction (file:///.../@prisma/adapter-neon/dist/index.mjs:595:18)'
  return error
}

describe('what counts as a transaction that never opened', () => {
  it('recognises the adapter frame, message empty and all', () => {
    expect(isStartTransactionFailure(startFailure())).toBe(true)
  })

  it('recognises the engine wording for the same thing', () => {
    expect(
      isStartTransactionFailure(
        new Error('Unable to start a transaction in the given time.'),
      ),
    ).toBe(true)
  })

  // THE WIDENING THAT MUST NOT HAPPEN. A drop during a write, or after a
  // commit, is a different risk and this must not claim it.
  it('does not recognise a failure inside an open transaction', () => {
    const midWrite = new Error('')
    midWrite.stack =
      'Error: \n    at PrismaNeonAdapter.performIO (file:///.../index.mjs:517:22)'
    expect(isStartTransactionFailure(midWrite)).toBe(false)
  })

  it('does not recognise an ordinary failure', () => {
    expect(isStartTransactionFailure(new Error('expected 3 to be 4'))).toBe(
      false,
    )
    expect(isStartTransactionFailure('a string')).toBe(false)
    expect(isStartTransactionFailure(null)).toBe(false)
  })
})

describe('retrying', () => {
  it('returns the result when the first attempt works', async () => {
    const attempt = vi.fn(async () => 'ok')
    expect(await retryOnStartFailure(attempt)).toBe('ok')
    expect(attempt).toHaveBeenCalledTimes(1)
  })

  it('absorbs a transaction that could not be opened', async () => {
    let calls = 0
    const attempt = vi.fn(async () => {
      calls++
      if (calls === 1) throw startFailure()
      return 'ok on the second'
    })

    expect(await retryOnStartFailure(attempt)).toBe('ok on the second')
    expect(attempt).toHaveBeenCalledTimes(2)
  })

  // THE PAIRING. Without this, a retry that swallowed everything would pass
  // the test above and quietly convert real defects into slow passes.
  it('never retries a real failure', async () => {
    const attempt = vi.fn(async () => {
      throw new Error('expected null to be false')
    })

    await expect(retryOnStartFailure(attempt)).rejects.toThrow(
      'expected null to be false',
    )
    expect(attempt).toHaveBeenCalledTimes(1)
  })

  it('gives up rather than retrying forever', async () => {
    const attempt = vi.fn(async () => {
      throw startFailure()
    })

    await expect(retryOnStartFailure(attempt)).rejects.toBeInstanceOf(Error)
    // Three attempts total: the compute either wakes or it does not, and a
    // fourteen-minute suite must not become a twenty-minute one waiting.
    expect(attempt).toHaveBeenCalledTimes(3)
  })

  it('reports each retry so a run can say it happened', async () => {
    let calls = 0
    const seen: number[] = []
    await retryOnStartFailure(
      async () => {
        calls++
        if (calls < 3) throw startFailure()
        return 'ok'
      },
      (_error, attemptNumber) => seen.push(attemptNumber),
    )
    // A retry nobody can see is indistinguishable from a suite that got lucky.
    expect(seen).toEqual([1, 2])
  })
})

describe('the counter, which is what turns a hypothesis into a finding', () => {
  it('counts a retry that happened', async () => {
    const before = retryStats().retries
    let calls = 0
    await retryOnStartFailure(async () => {
      calls++
      if (calls === 1) throw startFailure()
      return 'ok'
    })
    expect(retryStats().retries).toBe(before + 1)
  })

  it('counts nothing when the first attempt works', async () => {
    const before = retryStats()
    await retryOnStartFailure(async () => 'ok')
    expect(retryStats()).toEqual(before)
  })

  // THE CONTROL SWITCH. An experiment needs a control, and a control that
  // requires reverting a commit is one nobody runs twice.
  it('does not retry at all when switched off', async () => {
    const previous = process.env.ZEBRA_TX_RETRY
    process.env.ZEBRA_TX_RETRY = 'off'
    try {
      const attempt = vi.fn(async () => {
        throw startFailure()
      })
      await expect(retryOnStartFailure(attempt)).rejects.toBeInstanceOf(Error)
      expect(attempt).toHaveBeenCalledTimes(1)
    } finally {
      if (previous === undefined) delete process.env.ZEBRA_TX_RETRY
      else process.env.ZEBRA_TX_RETRY = previous
    }
  })
})
