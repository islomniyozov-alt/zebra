// ---------------------------------------------------------------------------
// A TRANSACTION THAT NEVER STARTED IS SAFE TO START AGAIN.
//
// The Neon dev compute scales to zero after five idle minutes and the plan
// cannot turn that off. Two gates in a row lost tests to it — twelve of
// fourteen failures in the second, none of them the code under test.
//
// SCOPED TO WHAT WAS MEASURED, AND NO WIDER. Every one of the fifteen stack
// traces in that run ended at `PrismaNeonAdapter.startTransaction`, and none at
// `performIO`, `queryRaw` or a commit. So this retries a transaction that
// failed to OPEN and nothing else. A retry after a partial write, or after a
// commit whose acknowledgement was lost, would re-run committed work; that
// shape did not occur, and the narrow scope is what keeps this inside the
// evidence rather than beside it.
//
// THE RESIDUAL, NAMED. A drop between COMMIT and the client learning of it is
// indistinguishable from a drop before the commit, and retrying it would double
// the work. Postgres gives no way to tell from the client. None of the fifteen
// was that shape — they died opening, not closing — and the `startTransaction`
// condition is what keeps us away from it. If a future failure trace shows a
// commit-time drop, this must not be widened to cover it.
//
// WHY THE COUNTER SURVIVES THIS. Load and invoice numbers come from
// `UPDATE "Counter" SET value = value + 1 ... RETURNING` inside the same
// transaction — a row update, deliberately not a sequence, and sequences are
// the thing that would NOT roll back. A transaction that never opened allocated
// nothing, so the series stays contiguous and
// `loads.test.ts > takes its number from the counter, contiguously` stays true.
//
// AND WHY THERE IS NOTHING OUTSIDE THE TRANSACTION TO RE-DO. `assertOutsideTransaction`
// forbids R2 and other third-party calls from running inside a Postgres
// transaction — added after the reconciler held one open across an object
// store round trip. That boundary was built for a different reason and is now
// load-bearing for this: because no external side effect can be inside the
// transaction, re-running the transaction cannot repeat one. Anybody
// simplifying that guard away would silently make this retry unsafe.
// ---------------------------------------------------------------------------

/** How many extra attempts. Small: a compute that will not open is not busy. */
const MAX_ATTEMPTS = 3

/** Between attempts, giving a resuming compute time to finish waking. */
const BACKOFF_MS = [250, 1_000]

/**
 * True only for a failure to OPEN a transaction.
 *
 * Matched on the driver frame rather than on a message, because the message is
 * frequently empty — the Neon `ErrorEvent` arrives with `message: ''` and all
 * the information in the stack. Matching on emptiness would catch everything.
 */
export function isStartTransactionFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const text = `${error.message}\n${error.stack ?? ''}`

  // The Prisma adapter frame is the specific evidence; the second is the
  // engine's own wording for the same thing when the pool never handed over a
  // connection at all.
  return (
    /PrismaNeonAdapter\.startTransaction/.test(text) ||
    /Unable to start a transaction in the given time/i.test(text)
  )
}

/**
 * Run `attempt`, retrying only when the transaction could not be opened.
 *
 * Anything else — an assertion inside the callback, a constraint violation, a
 * refusal from the status engine — propagates on the first try. A retry that
 * swallowed those would turn a real defect into a slow pass.
 */
export async function retryOnStartFailure<T>(
  attempt: () => Promise<T>,
  onRetry?: (error: unknown, attemptNumber: number) => void,
): Promise<T> {
  let lastError: unknown

  for (let attemptNumber = 0; attemptNumber < MAX_ATTEMPTS; attemptNumber++) {
    try {
      return await attempt()
    } catch (error) {
      if (!isStartTransactionFailure(error)) throw error
      lastError = error
      onRetry?.(error, attemptNumber + 1)

      const wait = BACKOFF_MS[attemptNumber]
      if (wait === undefined) break
      await new Promise((resolve) => setTimeout(resolve, wait))
    }
  }

  throw lastError
}
