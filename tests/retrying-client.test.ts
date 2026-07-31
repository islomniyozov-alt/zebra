import { afterEach, describe, expect, it } from 'vitest'
import {
  isDroppedSocket,
  resetRetryCount,
  retryCount,
  withSocketRetry,
} from './retrying-client'

// Standing rule 8, and rule 11: every "it retries" is paired with an "it does
// not", because a retry that fires on everything hides real failures and a
// retry that fires on nothing is a comment.

afterEach(() => resetRetryCount())

describe('recognising a dropped Neon socket', () => {
  it.each([
    // The exact shape the Step 2 fleet suite failed with.
    [
      'onSocketClose',
      new Error(
        'TypeError\n    at WebSocket.#onSocketClose (node:internal/deps/undici/undici:15951:20)',
      ),
    ],
    ['ECONNRESET', new Error('read ECONNRESET')],
    ['socket hang up', new Error('socket hang up')],
    ['terminated', new Error('Connection terminated unexpectedly')],
    [
      'P1001',
      new Error('Invalid `prisma.truck.findMany()`: P1001 unreachable'),
    ],
    ['P1017', new Error('P1017: Server has closed the connection.')],
  ])('recognises %s', (_label, error) => {
    expect(isDroppedSocket(error)).toBe(true)
  })

  it.each([
    [
      'a unique violation',
      Object.assign(new Error('Unique constraint'), { code: 'P2002' }),
    ],
    [
      'a missing row',
      new Error(
        'An operation failed because it depends on one or more records',
      ),
    ],
    ['an assertion', new Error('expected 3 to be 0')],
    ['a permission error', new Error('permission denied for table "Truck"')],
  ])('does NOT mistake %s for one', (_label, error) => {
    // This is the property that matters. A retry wrapper that treats a real
    // bug as a network blip turns a failing test into a flaky one.
    expect(isDroppedSocket(error)).toBe(false)
  })
})

describe('withSocketRetry', () => {
  it('does not retry an operation that succeeds', async () => {
    let calls = 0
    const value = await withSocketRetry('truck.findMany', async () => {
      calls += 1
      return 'ok'
    })
    expect(value).toBe('ok')
    expect(calls).toBe(1)
    expect(retryCount()).toBe(0)
  })

  it('retries a dropped socket exactly once, and succeeds', async () => {
    let calls = 0
    const value = await withSocketRetry('truck.findMany', async () => {
      calls += 1
      if (calls === 1) throw new Error('read ECONNRESET')
      return 'ok'
    })
    expect(value).toBe('ok')
    expect(calls).toBe(2)
    expect(retryCount()).toBe(1)
  })

  it('gives up after ONE retry rather than grinding', async () => {
    let calls = 0
    await expect(
      withSocketRetry('truck.findMany', async () => {
        calls += 1
        throw new Error('read ECONNRESET')
      }),
    ).rejects.toThrow('ECONNRESET')
    // Two attempts total. A third would mean the network is genuinely down
    // and the suite should say so.
    expect(calls).toBe(2)
  })

  it('rethrows a real error immediately, without retrying', async () => {
    let calls = 0
    await expect(
      withSocketRetry('truck.create', async () => {
        calls += 1
        throw Object.assign(new Error('Unique constraint failed'), {
          code: 'P2002',
        })
      }),
    ).rejects.toMatchObject({ code: 'P2002' })
    expect(calls).toBe(1)
    expect(retryCount()).toBe(0)
  })

  it('is never silent about a retry', async () => {
    // The Phase 1 §8 rule, applied here: continue, but never quietly. A retry
    // nobody can see is how a reproducible failure becomes "the suite is
    // flaky sometimes".
    const seen: unknown[] = []
    const original = console.warn
    console.warn = (...args: unknown[]) => seen.push(args)
    try {
      let calls = 0
      await withSocketRetry('driver.findMany', async () => {
        calls += 1
        if (calls === 1) throw new Error('socket hang up')
        return null
      })
    } finally {
      console.warn = original
    }

    expect(seen).toHaveLength(1)
    expect(JSON.stringify(seen[0])).toContain('zebra.test.socket-retry')
    expect(JSON.stringify(seen[0])).toContain('driver.findMany')
  })
})
