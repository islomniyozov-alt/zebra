import { readFileSync } from 'node:fs'
import pg from 'pg'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PG_CONNECT_TIMEOUT_MS,
  pgConnectLine,
  timedClientClass,
} from '@/lib/pg-connect'
import { TRANSACTION_BUDGET, transactionOptions } from '@/lib/tenancy'

// ---------------------------------------------------------------------------
// GAPS 37, MEASUREMENT (owner's rulings 2026-10-23 and 2026-10-26): the
// budget is ours, and the physical connect on the pg path is timed from
// inside the client the pool constructs. Held here without a database: the
// defaults, the line's shape, both connect shapes on success and failure,
// and that db.ts hands the adapter a CONFIG — never a pool it built.
// ---------------------------------------------------------------------------

describe('the transaction budget is ours', () => {
  it('is 5 s to acquire and 10 s to run, unless a call site says otherwise', () => {
    expect(TRANSACTION_BUDGET).toEqual({ maxWaitMs: 5_000, timeoutMs: 10_000 })
    expect(transactionOptions({})).toEqual({ maxWait: 5_000, timeout: 10_000 })
    expect(transactionOptions({ timeoutMs: 60_000 })).toEqual({
      maxWait: 5_000,
      timeout: 60_000,
    })
    expect(transactionOptions({ maxWaitMs: 15_000 }).maxWait).toBe(15_000)
  })

  it('every transaction opener applies it — Prisma’s defaults are nobody’s budget', () => {
    const tenancy = readFileSync('src/lib/tenancy.ts', 'utf8')
    expect(tenancy.match(/transactionOptions\(options\)/g)).toHaveLength(2)
    expect(tenancy).not.toMatch(/options\.timeoutMs === undefined\s*\?\s*\{\}/)
  })
})

describe('the physical connect, timed from inside the client', () => {
  afterEach(() => vi.restoreAllMocks())

  it('fails a hung connect by name at 5 s', () => {
    expect(PG_CONNECT_TIMEOUT_MS).toBe(5_000)
  })

  it('the line is a number and an outcome word, nothing else', () => {
    expect(pgConnectLine({ wallMs: 42, outcome: 'ok' })).toBe(
      '{"event":"pg.connect","wallMs":42,"outcome":"ok"}',
    )
  })

  it('writes one line when the pool’s callback-form connect settles', async () => {
    // The pool calls `client.connect(cb)`; the base connect is stood in for so
    // no socket is opened here.
    vi.spyOn(pg.Client.prototype, 'connect').mockImplementation(function (
      this: pg.Client,
      callback?: (err: Error) => void,
    ) {
      if (callback) {
        setTimeout(() => callback(undefined as unknown as Error), 15)
        return
      }
      return new Promise<void>((resolve) => setTimeout(resolve, 15))
    } as typeof pg.Client.prototype.connect)
    const lines: string[] = []
    const Client = timedClientClass((line) => lines.push(line))
    const client = new Client({ connectionString: 'postgresql://x:y@h/db' })
    await new Promise<void>((resolve, reject) =>
      client.connect((error: Error) => (error ? reject(error) : resolve())),
    )
    expect(lines).toHaveLength(1)
    const line = JSON.parse(lines[0]!)
    expect(Object.keys(line).sort()).toEqual(['event', 'outcome', 'wallMs'])
    expect(line).toMatchObject({ event: 'pg.connect', outcome: 'ok' })
    expect(line.wallMs).toBeGreaterThanOrEqual(10)
  })

  it('logs the failure too and hands the error on — the sign-in’s catch names it', async () => {
    vi.spyOn(pg.Client.prototype, 'connect').mockImplementation(function (
      this: pg.Client,
      callback?: (err: Error) => void,
    ) {
      const error = new Error('timeout expired')
      if (callback) {
        setTimeout(() => callback(error), 1)
        return
      }
      return Promise.reject(error)
    } as typeof pg.Client.prototype.connect)
    const lines: string[] = []
    const Client = timedClientClass((line) => lines.push(line))
    // Promise form.
    await expect(
      new Client({ connectionString: 'postgresql://x:y@h/db' }).connect(),
    ).rejects.toThrow(/timeout expired/)
    // Callback form.
    const viaCallback = await new Promise<Error>((resolve) =>
      new Client({ connectionString: 'postgresql://x:y@h/db' }).connect(
        (error: Error) => resolve(error),
      ),
    )
    expect(viaCallback.message).toMatch(/timeout expired/)
    expect(lines).toHaveLength(2)
    for (const line of lines) {
      expect(JSON.parse(line)).toMatchObject({
        event: 'pg.connect',
        outcome: 'error',
      })
      // Never the message, never the string: a number and a word.
      expect(line).not.toContain('timeout expired')
      expect(line).not.toContain('postgresql://')
    }
  })

  it('db.ts hands the adapter a config — the timeout and the Client — never a pool it built', () => {
    // GAPS 37, b406735: a caller-built pool is "external" to adapter-pg and
    // survives `$disconnect`; on workerd that socket crossed the request
    // boundary and every sign-in hung for 600 s.
    const db = readFileSync('src/lib/db.ts', 'utf8')
    expect(db).toMatch(
      /new PrismaPg\(\{\s*\.\.\.pool,\s*(\/\/[^\n]*\n\s*)*connectionTimeoutMillis: PG_CONNECT_TIMEOUT_MS,\s*Client: timedClientClass\(\),\s*\}\)/,
    )
    expect(db).not.toMatch(/new pg\.Pool\(|disposeExternalPool|instrumentPool/)
  })
})
