import pg from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PG_CONNECT_TIMEOUT_MS, timedClientClass } from '@/lib/pg-connect'

// ---------------------------------------------------------------------------
// THE pg-pool CONTRACT, HELD WITHOUT A DATABASE (owner's ruling 2, 2026-10-26,
// GAPS 37).
//
// b406735 wrapped `pool.connect` with an `async () => …` and every sign-in on
// the pg path hung for 600 s: pg-pool's own `query()` acquires through the
// CALLBACK form, `this.connect((err, client) => …)`, and the wrapper dropped
// the callback — `connect()` answered, `query()` never did. The proof that
// found it ran in four minutes with a stub Client under a real pool, three
// days after the deploy. This is that proof, permanent: a REAL `pg.Pool`
// built the way db.ts builds it (a PoolConfig naming the timed Client and the
// connect timeout), a stub for the wire, and the three ways the adapter uses
// a pool — `pool.query()`, `pool.connect()`, and a transaction through
// `@prisma/adapter-pg` itself. Each must complete inside one second.
//
// ANY WRAPPER OR SUBCLASS OF A pg OR pg-pool API SHIPS WITH THIS TEST
// (AGENTS.md). It stubs the two methods that touch the wire on
// `pg.Client.prototype`, so whatever `timedClientClass` or a successor adds
// around them is what runs here.
// ---------------------------------------------------------------------------

const ONE_SECOND = 1_000
const CONNECTION = 'postgresql://zebra_app:x@h.hyperdrive.local:5432/db'

/** 'answered' or 'HUNG' — never a test that waits forever. */
const settles = (work: Promise<unknown>, ms = ONE_SECOND) =>
  Promise.race([
    work.then(() => 'answered' as const),
    new Promise<string>((resolve) =>
      setTimeout(() => resolve(`HUNG past ${ms} ms`), ms),
    ),
  ])

const emptyResult = { rows: [], fields: [], rowCount: 0, command: 'SELECT' }

/** Stand in for the wire: connect succeeds on the next tick, every query answers empty. */
function stubTheWire() {
  vi.spyOn(pg.Client.prototype, 'connect').mockImplementation(function (
    this: pg.Client,
    callback?: (err: Error) => void,
  ) {
    if (callback) {
      setTimeout(() => callback(undefined as unknown as Error), 1)
      return
    }
    return new Promise<void>((resolve) => setTimeout(resolve, 1))
  } as typeof pg.Client.prototype.connect)
  vi.spyOn(pg.Client.prototype, 'query').mockImplementation(function (
    this: pg.Client,
    ...args: unknown[]
  ) {
    // pg's shapes: (text|config), (text|config, values), and any of those with
    // a trailing callback — pg-pool's query() uses the callback.
    const callback = args.find((arg) => typeof arg === 'function') as
      | ((err: Error | null, result: unknown) => void)
      | undefined
    if (callback) {
      setTimeout(() => callback(null, emptyResult), 1)
      return undefined
    }
    return Promise.resolve(emptyResult)
  } as typeof pg.Client.prototype.query)
  // pg-pool also calls `end()` on clients it retires.
  vi.spyOn(pg.Client.prototype, 'end').mockImplementation(function (
    this: pg.Client,
    callback?: (err: Error) => void,
  ) {
    if (callback) {
      setTimeout(() => callback(undefined as unknown as Error), 1)
      return
    }
    return Promise.resolve()
  } as typeof pg.Client.prototype.end)
}

/** The config db.ts hands the adapter, verbatim in shape. */
const poolConfig = (write: (line: string) => void): pg.PoolConfig => ({
  connectionString: CONNECTION,
  idleTimeoutMillis: 5_000,
  connectionTimeoutMillis: PG_CONNECT_TIMEOUT_MS,
  Client: timedClientClass(write),
})

describe('a pg.Pool built the way db.ts builds it', () => {
  afterEach(() => vi.restoreAllMocks())

  it('answers pool.query() inside a second — the callback form pg-pool uses', async () => {
    stubTheWire()
    const lines: string[] = []
    const pool = new pg.Pool(poolConfig((line) => lines.push(line)))
    try {
      expect(await settles(pool.query('select 1'))).toBe('answered')
      expect(lines).toHaveLength(1)
      expect(JSON.parse(lines[0]!)).toMatchObject({
        event: 'pg.connect',
        outcome: 'ok',
      })
    } finally {
      await pool.end()
    }
  })

  it('answers pool.connect() and release() inside a second — the promise form', async () => {
    stubTheWire()
    const pool = new pg.Pool(poolConfig(() => {}))
    try {
      expect(
        await settles(pool.connect().then((client) => client.release())),
      ).toBe('answered')
    } finally {
      await pool.end()
    }
  })

  it('runs a transaction through @prisma/adapter-pg inside a second', async () => {
    stubTheWire()
    const lines: string[] = []
    const factory = new PrismaPg(poolConfig((line) => lines.push(line)))
    const adapter = await factory.connect()
    try {
      const work = (async () => {
        // A plain query first, as a request's rate-limit read is.
        await adapter.executeRaw({ sql: 'select 1', args: [], argTypes: [] })
        // Then the shape every runInOrg / runAsUser takes: BEGIN, SET LOCAL,
        // the work, COMMIT — on a connection acquired through connect().
        const tx = await adapter.startTransaction()
        await tx.executeRaw({
          sql: "select set_config('app.current_user_id', $1, true)",
          args: ['cuid'],
          argTypes: [{ scalarType: 'string', arity: 'scalar' }],
        })
        await tx.commit()
      })()
      expect(await settles(work)).toBe('answered')
      // Two acquisitions on a fresh pool: pg-pool opened a client for the plain
      // query and reused or opened one for the transaction — each a connect
      // the timed Client logged, none of them hung.
      expect(lines.length).toBeGreaterThanOrEqual(1)
      for (const line of lines)
        expect(JSON.parse(line)).toMatchObject({
          event: 'pg.connect',
          outcome: 'ok',
        })
    } finally {
      await adapter.dispose()
    }
  })

  it('and the test is not vacuous: a wrapper that drops the callback IS caught here', async () => {
    // b406735's wrapper, re-created: pool.connect replaced by an async function
    // that ignores pg-pool's callback. pool.query() must be seen HANGING by
    // this file's own race, or the file proves nothing.
    stubTheWire()
    const pool = new pg.Pool(poolConfig(() => {}))
    const connect = pool.connect.bind(pool)
    ;(pool as unknown as { connect: () => Promise<unknown> }).connect =
      async () => connect()
    try {
      expect(await settles(pool.query('select 1'), 300)).toMatch(/^HUNG/)
    } finally {
      // The hung acquisition holds a client; end() still has to return.
      await Promise.race([pool.end(), new Promise((r) => setTimeout(r, 500))])
    }
  })
})
