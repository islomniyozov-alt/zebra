import { describe, expect, it } from 'vitest'
import { withSocketRetry } from './retrying-client'
import { isStartTransactionFailure } from '@/lib/retry-transaction'

/** Named, because an escaped newline has been mangled in transit twice. */
const NEWLINE = String.fromCharCode(10)

// ---------------------------------------------------------------------------
// WHEN BOTH ATTEMPTS LOSE THE SOCKET, THE ERROR SAYS SO.
//
// ── WHY THIS MATTERS, MEASURED TWICE ─────────────────────────────────────
//
// `withSocketRetry` retries a dropped socket once. When the SECOND attempt
// dropped too it used to rethrow the original, whose `message` is EMPTY — the
// cause lives only in `stack`. Vitest's retry condition reads `error.message`
// and nothing else, so the test never got its one re-run.
//
// On 2026-09-18 two production deploys refused on socket bursts — 45 tests
// across five files, 36 of them inside two seconds, then 18 more — and both
// runs reported `RETRIES 1`, the one being a simulated test. Every real drop
// went unretried. A burst is exactly when both attempts fail, which is exactly
// when the name was missing.
// ---------------------------------------------------------------------------

const dropped = () => {
  const error = new Error('')
  error.stack = 'TypeError: \n    at WebSocket.#onSocketClose (node:internal)'
  return error
}

describe('an operation that loses its socket twice', () => {
  it('throws an error a retry condition can match', async () => {
    await expect(
      withSocketRetry('fixture.findMany', () => Promise.reject(dropped())),
    ).rejects.toThrow(/dropped Neon socket/)
  })

  it('names the operation and keeps the original as the cause', async () => {
    const thrown = await withSocketRetry('load.findMany', () =>
      Promise.reject(dropped()),
    ).catch((error: unknown) => error as Error)

    expect(thrown.message).toContain('load.findMany')
    expect(thrown.message).toContain('twice')
    // THE EVIDENCE SURVIVES THE RENAME. A message that replaced the stack
    // would trade one unreadable error for another.
    expect((thrown.cause as Error).stack).toContain('onSocketClose')
  })

  // ── THE RENAME MUST NOT BLIND THE APPLICATION'S OWN RETRY ────────────
  //
  // A REGRESSION THAT SHIPPED, caught by reading a failing deploy rather than
  // by a test. `isStartTransactionFailure` recognises these by the frame
  // `PrismaNeonAdapter.startTransaction` in the STACK, and a bare
  // `new Error(...)` carries a new stack — so renaming turned a recognised
  // start failure into an unrecognised one and disabled `retryOnStartFailure`
  // entirely. Measured directly: original true, renamed false.
  //
  // The cause's stack is appended rather than replaced, so both readers get
  // what they match on.
  it('keeps the frame the application retry recognises', async () => {
    const adapterDrop = () => {
      const error = new Error('')
      // Built by joining, so no escape sequence has to survive being typed.
      error.stack = [
        'Error: ',
        '    at PrismaNeonAdapter.startTransaction (adapter-neon/dist/index.mjs:595:18)',
        '    at WebSocket.#onSocketClose (node:internal)',
      ].join(NEWLINE)
      return error
    }
    expect(isStartTransactionFailure(adapterDrop())).toBe(true)

    const thrown = await withSocketRetry('load.findMany', () =>
      Promise.reject(adapterDrop()),
    ).catch((error: unknown) => error as Error)

    // Both at once: the message a vitest condition reads...
    expect(thrown.message).toContain('dropped Neon socket')
    // ...and the stack the application's retry reads.
    expect(isStartTransactionFailure(thrown)).toBe(true)
  })

  it('still succeeds quietly when the second attempt works', async () => {
    let attempts = 0
    const value = await withSocketRetry('load.findMany', () => {
      attempts += 1
      return attempts === 1 ? Promise.reject(dropped()) : Promise.resolve('ok')
    })
    expect(value).toBe('ok')
    expect(attempts).toBe(2)
  })

  it('never renames an ordinary failure, first time', async () => {
    // The OUTER guard: not a dropped socket, so no retry and no rename.
    await expect(
      withSocketRetry('load.create', () =>
        Promise.reject(new Error('Unique constraint failed')),
      ),
    ).rejects.toThrow(/Unique constraint failed/)
  })

  it('never renames an ordinary failure on the SECOND attempt either', async () => {
    // ── THE INNER GUARD, WHICH THE FIRST TEST NEVER REACHED ─────────────
    //
    // Written after the break harness refused to make the inner
    // `isDroppedSocket` check fail: a test that threw a constraint violation
    // on BOTH attempts never got past the outer guard, so deleting the inner
    // one changed nothing and the check was untested.
    //
    // The path that matters is a socket drop followed by a REAL failure — the
    // retry runs, the second attempt fails honestly, and renaming that would
    // make the test-level retry re-run a genuine bug.
    let attempts = 0
    const thrown = await withSocketRetry('load.create', () => {
      attempts += 1
      return attempts === 1
        ? Promise.reject(dropped())
        : Promise.reject(new Error('Unique constraint failed'))
    }).catch((error: unknown) => error as Error)

    expect(attempts).toBe(2)
    expect(thrown.message).toContain('Unique constraint failed')
    // THE ASSERTION THAT MATTERS, and the first version did not make it.
    // `toThrow(/Unique constraint failed/)` passes even when the error HAS
    // been renamed, because the rename quotes the original message inside its
    // own — so the break harness removed the guard and nothing failed. What is
    // actually claimed is that this error is NOT dressed up as a dropped
    // socket, because a test-level retry would then re-run a genuine bug.
    expect(thrown.message).not.toContain('dropped Neon socket')
  })
})
