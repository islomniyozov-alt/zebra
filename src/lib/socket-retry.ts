// ---------------------------------------------------------------------------
// RECOGNISING A DROPPED NEON SOCKET, AND RETRYING WHAT IS SAFE TO REPEAT.
//
// ── WHY THIS MOVED OUT OF tests/ ─────────────────────────────────────────
//
// `isDroppedSocket` lived in `tests/retrying-client.ts`, whose header says —
// correctly — that a retry in the APPLICATION is a much bigger decision than a
// retry in a fixture, because an interactive transaction that dropped
// mid-flight may already have committed and replaying it duplicates a write.
//
// That reasoning is about the RETRY, not about the RECOGNITION. Whether an
// error is a dropped socket is a fact about the error, and §7.5.1 needs it in
// the application: a form that cannot tell "your password is wrong" from "the
// database was unreachable for a second" shows the same nothing for both.
//
// So the condition moves here, the policy stays explicit at each call site, and
// there is ONE definition of what a dropped socket looks like rather than one
// for the suite and another for the product.
//
// ── WHAT MAY BE WRAPPED, AND WHAT MAY NOT ────────────────────────────────
//
// ONLY an operation whose repetition is acceptable. Not an interactive
// transaction, and nothing that has already written something a second attempt
// would write again differently.
//
// `withCurrentOrg`, `withOrg` and every settlement, invoice and payment write
// are therefore OFF LIMITS. The existing `retryOnStartFailure` covers the one
// transaction case that is provably safe — a transaction that never OPENED
// allocated nothing — and its header explains at length why it was not widened.
// This is not a widening of it: different condition, different scope, and a
// comment required at each call site saying what a repeat would duplicate.
// ---------------------------------------------------------------------------

/** The shapes a dropped Neon WebSocket arrives in. */
export function isDroppedSocket(error: unknown): boolean {
  const text =
    error instanceof Error
      ? `${error.name} ${error.message} ${error.stack ?? ''}`
      : String(error)

  return (
    /onSocketClose|ECONNRESET|socket hang up|Connection terminated|kind: Closed|Closed connection/i.test(
      text,
    ) ||
    // Prisma wraps driver failures; P1001/P1017 are "can't reach" and
    // "server closed the connection".
    /\bP1001\b|\bP1017\b/.test(text)
  )
}

let retries = 0

/** How many retries this process has spent. Asserted on, so it cannot creep. */
export function retryCount(): number {
  return retries
}

export function resetRetryCount(): void {
  retries = 0
}

/**
 * Rename a dropped socket so a retry condition can match it — WITHOUT losing
 * the original.
 *
 * A dropped socket arrives with `message: ''` and everything in `stack`. Any
 * condition that reads `message` therefore cannot match the one error worth
 * matching, which is how a burst of real drops went unretried on 2026-09-18.
 */
export function renamedDrop(label: string, cause: unknown): Error {
  const detail =
    cause instanceof Error
      ? cause.message || cause.stack?.split('\n')[0] || cause.name
      : String(cause)
  const renamed = new Error(`dropped Neon socket in ${label}: ${detail}`, {
    cause,
  })
  if (cause instanceof Error && cause.stack !== undefined) {
    renamed.stack = cause.stack
  }
  return renamed
}

/**
 * Run `operation`, and if the socket dropped, run it exactly ONCE more.
 *
 * TWO PROPERTIES THIS MUST KEEP:
 *
 *   1. ONE retry. Two means the network is genuinely broken and the caller
 *      should say so rather than grind — §7.5.1: a form that retries forever is
 *      a form that hangs.
 *   2. It is never silent. Every retry warns, with the label and the error,
 *      because a retry that hides a real and reproducible failure is how a
 *      flaky system becomes one nobody believes.
 *
 * Anything that is not a dropped socket rethrows immediately. A retry that
 * swallowed a unique-constraint violation would turn a defect into a flake.
 */
export async function withSocketRetry<T>(
  label: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (!isDroppedSocket(error)) throw error

    retries += 1
    console.warn(
      '[zebra.socket-retry]',
      JSON.stringify({
        label,
        attempt: 2,
        totalRetriesThisProcess: retries,
        message: error instanceof Error ? error.message : String(error),
      }),
    )

    // A FRESH CALL, NOT A FRESH CLIENT: the pool reconnects on demand, and
    // building a second client per retry leaks sockets.
    return operation().catch((second: unknown) => {
      if (!isDroppedSocket(second)) throw second
      throw renamedDrop(`${label}, twice`, second)
    })
  }
}
