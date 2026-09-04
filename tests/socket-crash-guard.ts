import { recordFailure } from './failure-log'

// ---------------------------------------------------------------------------
// A DROPPED SOCKET FAILS ITS TEST. IT DOES NOT DESTROY THE RUN.
//
// `@neondatabase/serverless` handles a lost connection like `pg` does:
// `_handleErrorEvent` calls `_errorAllQueries(e)` FIRST — so every in-flight
// query rejects and the test that owned it fails normally — and then does
// `this.emit('error', e)`. An EventEmitter emitting 'error' with no listener is
// a process death in Node, so the run dies one tick after the failure it
// already reported correctly.
//
// THE POOL IS OUT OF REACH. `PrismaNeon` takes a `PoolConfig` and builds the
// pool inside `connect()`; there is no seam to attach a listener to, and the
// pools this suite creates itself are not the ones that break. So the listener
// goes at the process, which is the only place that can see it.
//
// THIS IS NARROW ON PURPOSE. It swallows exactly the shape above — a socket or
// connection error arriving after its queries were already rejected — and
// rethrows anything else by restoring the default behaviour. A blanket
// `uncaughtException` handler in a test suite is how a real crash becomes a
// green run, which is the opposite of the problem being solved.
//
// ON 2026-09-04 this cost a whole gate: "2 failed | 210 passed" and then a
// crash that took the failure list with it. The two tests had already failed
// and were already known; nothing survived to say which.
// ---------------------------------------------------------------------------

/** Shapes that mean "the connection went away", and nothing else. */
const SOCKET_DEATH = [
  /Unhandled error/i,
  /socket hang up/i,
  /#onSocketClose/,
  /reportStreamError/,
  /ECONNRESET/,
  /terminating connection due to administrator command/i, // 57P01
  /Connection terminated/i,
]

export function looksLikeSocketDeath(error: unknown): boolean {
  const text =
    error instanceof Error
      ? `${error.message}\n${error.stack ?? ''}`
      : String(error)
  return SOCKET_DEATH.some((pattern) => pattern.test(text))
}

let installed = false

export function installSocketCrashGuard(): void {
  if (installed) return
  installed = true

  process.on('uncaughtException', (error) => {
    if (!looksLikeSocketDeath(error)) {
      // NOT OURS. Restore the default: print it and die, exactly as Node would
      // have. Swallowing an unrecognised crash would make this file the reason
      // a real defect went unnoticed.
      console.error(error)
      process.exit(1)
    }

    // RECORDED, NOT SILENT. The owning test has already failed through the
    // rejected query; this line says the connection is why, and it is on disk
    // before anything else can go wrong.
    recordFailure(
      `SOCKET a Neon connection dropped and was contained: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    )
  })

  process.on('unhandledRejection', (reason) => {
    if (!looksLikeSocketDeath(reason)) return
    recordFailure(
      `SOCKET a dropped connection surfaced as an unhandled rejection: ` +
        `${reason instanceof Error ? reason.message : String(reason)}`,
    )
  })
}
