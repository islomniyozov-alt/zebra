// ---------------------------------------------------------------------------
// CONNECTION ACQUISITION ON THE pg PATH, MEASURED (§6.10, owner's ruling
// 2026-10-23, GAPS 37).
//
// Three of 39 Hyperdrive sign-ins failed to start their membership
// transaction inside Prisma's 2 s wait for a pooled connection, and one of
// them burned 11.7 s of CPU doing it — a wait costs no CPU, so something in
// `pg`, `pg-cloudflare` or the adapter spun. Nothing recorded the acquisition
// itself. This does: the pool is built here, not by the adapter, every
// `connect()` is timed and logged with the pool's counts, and a connect that
// does not complete errors by name at `connectionTimeoutMillis` instead of
// hanging. The tail's `cpuTime` for the invocation is the CPU beside these
// lines; an acquisition in an invocation with more than ~500 ms of CPU is the
// spin, and its surrounding spans say where.
//
// NO PII: the line carries numbers and an outcome word. Never the connection
// string, never an error message (the sign-in's `signin.error` names those).
// ---------------------------------------------------------------------------

/** How long a connect may take before pg fails it by name (GAPS 37). */
export const PG_CONNECT_TIMEOUT_MS = 5_000

/** The counters a `pg.Pool` exposes; typed here so the tests need no pg. */
export interface PoolCounts {
  totalCount: number
  idleCount: number
  waitingCount: number
}

/** The subset of `pg.Pool` this wraps. */
export interface ConnectablePool extends PoolCounts {
  connect(): Promise<unknown>
}

export function pgConnectLine(input: {
  wallMs: number
  counts: PoolCounts
  outcome: 'ok' | 'error'
}): string {
  return JSON.stringify({
    event: 'pg.connect',
    wallMs: input.wallMs,
    poolTotal: input.counts.totalCount,
    poolIdle: input.counts.idleCount,
    poolWaiting: input.counts.waitingCount,
    outcome: input.outcome,
  })
}

/**
 * Wrap `pool.connect` so every acquisition writes one `pg.connect` line. The
 * counts are read AFTER the acquisition settles, so `poolTotal` includes the
 * connection just made and `poolWaiting` is who is still queued behind it.
 * Returns the same pool, for the adapter.
 */
export function instrumentPool<P extends ConnectablePool>(
  pool: P,
  write: (line: string) => void = (line) => console.log(line),
): P {
  const connect = pool.connect.bind(pool)
  pool.connect = (async () => {
    const start = performance.now()
    try {
      const client = await connect()
      write(
        pgConnectLine({
          wallMs: Math.round(performance.now() - start),
          counts: pool,
          outcome: 'ok',
        }),
      )
      return client
    } catch (error) {
      write(
        pgConnectLine({
          wallMs: Math.round(performance.now() - start),
          counts: pool,
          outcome: 'error',
        }),
      )
      throw error
    }
  }) as P['connect']
  return pool
}
