// ---------------------------------------------------------------------------
// THE PHYSICAL CONNECT ON THE pg PATH, MEASURED (§6.10, owner's rulings
// 2026-10-23 and 2026-10-26, GAPS 37).
//
// Three of 39 Hyperdrive sign-ins failed to start their membership
// transaction inside Prisma's 2 s wait for a pooled connection, and one of
// them burned 11.7 s of CPU doing it — a wait costs no CPU, so something in
// `pg`, `pg-cloudflare` or the adapter spun. Nothing recorded the connect
// itself. This does, from INSIDE the client: `pg-pool` takes a `Client` class
// through `PoolConfig`, and this one times its own `connect()` and writes one
// `pg.connect` line per physical connect — `wallMs` and an outcome word. The
// tail's `cpuTime` for the invocation is the CPU beside it; a connect inside
// an invocation with more than ~500 ms of CPU is the spin, and the sign-in's
// spans say where.
//
// WHY THE CLIENT AND NOT THE POOL. The first version (b406735) built the pool
// here and wrapped `pool.connect()`. A pool the caller builds is "external" to
// adapter-pg and survives `$disconnect`; on workerd that socket crossed the
// request boundary and every sign-in hung for 600 s until the runtime
// canceled it. So the ADAPTER builds the pool, from a `PoolConfig` that names
// this class and `connectionTimeoutMillis`, and ends it as it always did.
// With one pool per request, the first acquisition IS the connect, so there
// are no pool counts to carry: they would read 0/0/0 on the line that matters.
//
// NO PII: the line carries a number and a word. Never the connection string,
// never an error message (the sign-in's `signin.error` names those).
// ---------------------------------------------------------------------------
import pg from 'pg'

/** How long a connect may take before pg fails it by name (GAPS 37). */
export const PG_CONNECT_TIMEOUT_MS = 5_000

export type ConnectOutcome = 'ok' | 'error'

export function pgConnectLine(input: {
  wallMs: number
  outcome: ConnectOutcome
}): string {
  return JSON.stringify({
    event: 'pg.connect',
    wallMs: input.wallMs,
    outcome: input.outcome,
  })
}

/**
 * A `pg.Client` whose `connect()` writes one `pg.connect` line when it settles,
 * for `PoolConfig.Client`. Both of pg's shapes are kept — the pool calls the
 * callback form, callers of the promise form get the same promise back.
 */
export function timedClientClass(
  write: (line: string) => void = (line) => console.log(line),
): typeof pg.Client {
  type ConnectCallback =
    | ((err: Error) => void)
    | ((err: null, client: pg.Client) => void)
  return class TimedClient extends pg.Client {
    override connect(): Promise<pg.Client>
    override connect(callback: ConnectCallback): void
    override connect(callback?: ConnectCallback): Promise<pg.Client> | void {
      const start = performance.now()
      const settled = (outcome: ConnectOutcome) =>
        write(
          pgConnectLine({
            wallMs: Math.round(performance.now() - start),
            outcome,
          }),
        )
      if (callback) {
        super.connect((error: Error) => {
          settled(error ? 'error' : 'ok')
          ;(callback as (err: Error) => void)(error)
        })
        return
      }
      return super.connect().then(
        (client) => {
          settled('ok')
          return client
        },
        (error: unknown) => {
          settled('error')
          throw error
        },
      )
    }
  }
}
