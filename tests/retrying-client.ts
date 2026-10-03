import { createPrismaClient } from '@/lib/db'
import {
  isDroppedSocket,
  renamedDrop,
  resetRetryCount,
  retryCount,
  withSocketRetry,
} from '@/lib/socket-retry'
import type { PrismaClient } from '@/generated/prisma/client'

// ── THE CONDITION AND THE ONE-RETRY WRAPPER NOW LIVE IN src/lib ──────────
//
// Moved 2026-10-04 for §7.5.1: the application has to tell a dropped socket
// from a wrong password, because a form that cannot shows the same nothing for
// both. The RECOGNITION is a fact about an error and belongs in one place; the
// POLICY — what may be repeated — stays at each call site, which is why this
// file still owns the Proxy and its refusal to retry a transaction.
//
// Re-exported so the suites that assert on the counters keep their import.
export {
  isDroppedSocket,
  renamedDrop,
  resetRetryCount,
  retryCount,
  withSocketRetry,
}

// ---------------------------------------------------------------------------
// ONE RETRY, LOUDLY, ON A DROPPED NEON SOCKET.
//
// The Step 2 fleet suite failed once mid-run with:
//
//   TypeError: at WebSocket.#onSocketClose (node:internal/deps/undici)
//   ... url: 'wss://ep-little-lake-...-pooler.c-5.us-east-2.aws.neon.tech/v2'
//
// and passed cleanly on a re-run. This link is long — the tests run from
// Tajikistan against us-east-2, roughly 200ms per query — and a socket that
// lives for a nine-minute suite will occasionally be closed under it. That is
// a fact about the network, not about the code under test, and it costs a
// re-run every time it happens.
//
// TEST-ONLY, AND DELIBERATELY NOT IN src/lib/db.ts. A retry in the application
// would be a much bigger decision: an interactive transaction that dropped
// mid-flight may have committed, so replaying it can duplicate a write. Here
// the operations are idempotent-by-construction fixtures and the alternative
// is a suite that cries wolf.
//
// TWO PROPERTIES THIS MUST KEEP:
//
//   1. ONE retry. Two means the network is genuinely broken and the suite
//      should say so rather than grind.
//   2. It is never silent. Every retry prints, with the operation and the
//      error, because a retry that hides a real and reproducible failure is
//      how a flaky suite becomes a suite nobody believes. Same reasoning as
//      the audit failures in Phase 1 §8 — continue, but never quietly.
// ---------------------------------------------------------------------------

/**
 * A client whose queries survive one dropped socket.
 *
 * A Proxy rather than a wrapper class, so call sites keep reading
 * `db.truck.findMany(...)` and nothing about the tests has to know this exists.
 */
export function retryingClient(connectionString: string): PrismaClient {
  const client = createPrismaClient(connectionString)

  const wrapModel = (model: object, modelName: string): object =>
    new Proxy(model, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver)
        if (typeof value !== 'function') return value
        return (...args: unknown[]) =>
          withSocketRetry(`${modelName}.${String(property)}`, () =>
            Promise.resolve(
              (value as (...a: unknown[]) => unknown).apply(target, args),
            ),
          )
      },
    })

  return new Proxy(client, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)

      // $transaction and friends are never retried — replaying an interactive
      // transaction is exactly the case where a retry can duplicate a write.
      //
      // BOUND TO THE TARGET, and that bind is load-bearing. Returned bare,
      // `client.$transaction(...)` is invoked with `this` set to the PROXY,
      // and Prisma's internals reach for private state they cannot find on it.
      // The visible symptom was not an error: `set_config('app.current_org_id')`
      // stopped applying to the statements inside the transaction, so every
      // write failed row-level security with 42501 and every read came back
      // empty. Introduced in Step 2 and not caught until Step 4, because the
      // suites I re-ran were the new ones rather than all of them.
      if (property === '$transaction') {
        const original = (value as (...args: unknown[]) => unknown).bind(target)
        return (...args: unknown[]) => {
          // A longer POOL WAIT, and only here. Prisma gives up waiting for a
          // connection after 2s; run alone every suite is fine, and run as the
          // seventh of eight files three tests failed with "Unable to start a
          // transaction in the given time" — congestion, not deadlock. The
          // application keeps the 2s default, because in production a 2s wait
          // for a connection is a signal and not something to sit through.
          if (typeof args[0] === 'function') {
            const options = (args[1] ?? {}) as Record<string, unknown>
            args[1] = { maxWait: 20_000, ...options }
          }
          // ── STILL NOT RETRIED, BUT NO LONGER NAMELESS ──────────────────
          //
          // A dropped socket inside a transaction arrives as an object whose
          // `message` is EMPTY — the cause is only in `stack`, as
          // `WebSocket.#onSocketClose`. Vitest's retry condition is a RegExp
          // tested against `error.message` and nothing else, so the one error
          // worth retrying on was the one error it could not match.
          //
          // So this renames it and rethrows. IT DOES NOT RETRY: replaying an
          // interactive transaction that may already have committed is the
          // whole reason `withSocketRetry` refuses to touch `$transaction`,
          // and that has not changed. The retry happens a level up, where
          // vitest re-runs the TEST and its fixtures are built again.
          return Promise.resolve(original(...args)).catch((error: unknown) => {
            if (!isDroppedSocket(error)) throw error
            throw renamedDrop('$transaction', error)
          })
        }
      }
      if (typeof property === 'string' && property.startsWith('$')) {
        return typeof value === 'function' ? value.bind(target) : value
      }

      if (value && typeof value === 'object') {
        return wrapModel(value as object, String(property))
      }
      return value
    },
  }) as PrismaClient
}
