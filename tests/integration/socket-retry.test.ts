import { describe, expect, it } from 'vitest'
import { isDroppedSocket } from '../retrying-client'

// ---------------------------------------------------------------------------
// THE RETRY FIRES ON A DROPPED SOCKET AND ON NOTHING ELSE.
//
// ── WHY THIS LIVES IN THE INTEGRATION PROJECT ────────────────────────────
//
// Because the retry is configured there and nowhere else. A test of it in the
// `node` project would assert a config it does not run under — the shape of
// mistake this codebase keeps writing down — so this runs where the setting
// applies and lets the RUNNER prove it.
//
// ── HOW THE FIRST HALF WORKS ─────────────────────────────────────────────
//
// The first attempt throws an error whose message names a dropped socket; the
// second passes. If the condition matched, the test passes overall and
// `attempts` is 2. If the condition did NOT match — which is what happens when
// the message is empty, the defect that made the documented RegExp form
// useless here — the test fails on the first attempt and says so.
// ---------------------------------------------------------------------------

let attempts = 0

describe('the one retry the integration project allows', () => {
  it('retries a dropped socket exactly once', () => {
    attempts += 1
    if (attempts === 1) {
      // THE MESSAGE IS THE WHOLE MECHANISM. `retrying-client.ts` renames these
      // on the way out of `$transaction` precisely so this string exists: the
      // real error arrives with an EMPTY message and the cause only in `stack`,
      // and vitest's condition reads `error.message` and nothing else.
      throw new Error('dropped Neon socket during $transaction: simulated')
    }
    expect(attempts).toBe(2)
  })

  // AND THE SHAPES IT RECOGNISES, which is what decides whether a real drop
  // ever reaches the rename above.
  it('knows a dropped socket from an ordinary failure', () => {
    const dropped = new Error('boom')
    dropped.stack = 'TypeError: \n    at WebSocket.#onSocketClose (node:x)'
    expect(isDroppedSocket(dropped)).toBe(true)
    expect(isDroppedSocket(new Error('ECONNRESET'))).toBe(true)
    expect(isDroppedSocket(new Error('Connection terminated'))).toBe(true)

    // THE ONES IT MUST NOT CLAIM. A retry that swallowed a constraint
    // violation would turn a real bug into a flake — the opposite of the point.
    expect(isDroppedSocket(new Error('Unique constraint failed'))).toBe(false)
    expect(isDroppedSocket(new Error('expected 1 to be 2'))).toBe(false)
    expect(isDroppedSocket(new Error('row-level security'))).toBe(false)
  })
})
