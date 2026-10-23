import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  instrumentPool,
  PG_CONNECT_TIMEOUT_MS,
  pgConnectLine,
  type ConnectablePool,
} from '@/lib/pg-connect'
import { TRANSACTION_BUDGET, transactionOptions } from '@/lib/tenancy'

// ---------------------------------------------------------------------------
// GAPS 37, MEASUREMENT (owner's ruling 2026-10-23): the budget is ours, and
// connection acquisition on the pg path is timed and logged. Held here
// without a database: the defaults, the line's shape, the wrapper's
// behaviour on success and failure, and that db.ts uses both.
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

describe('pg connection acquisition', () => {
  const fakePool = (behaviour: () => Promise<unknown>): ConnectablePool => ({
    totalCount: 3,
    idleCount: 1,
    waitingCount: 2,
    connect: behaviour,
  })

  it('fails a hung connect by name at 5 s', () => {
    expect(PG_CONNECT_TIMEOUT_MS).toBe(5_000)
  })

  it('writes one pg.connect line per acquisition, counts read after it settles', async () => {
    const lines: string[] = []
    const pool = instrumentPool(
      fakePool(
        () => new Promise((resolve) => setTimeout(() => resolve('client'), 15)),
      ),
      (line) => lines.push(line),
    )
    await expect(pool.connect()).resolves.toBe('client')
    expect(lines).toHaveLength(1)
    const line = JSON.parse(lines[0]!)
    expect(Object.keys(line).sort()).toEqual(
      [
        'event',
        'wallMs',
        'poolTotal',
        'poolIdle',
        'poolWaiting',
        'outcome',
      ].sort(),
    )
    expect(line).toMatchObject({
      event: 'pg.connect',
      poolTotal: 3,
      poolIdle: 1,
      poolWaiting: 2,
      outcome: 'ok',
    })
    expect(line.wallMs).toBeGreaterThanOrEqual(10)
  })

  it('logs the failure too, then rethrows — the sign-in’s catch names the error', async () => {
    const lines: string[] = []
    const pool = instrumentPool(
      fakePool(() =>
        Promise.reject(new Error('timeout exceeded when trying to connect')),
      ),
      (line) => lines.push(line),
    )
    await expect(pool.connect()).rejects.toThrow(/timeout exceeded/)
    expect(JSON.parse(lines[0]!)).toMatchObject({
      event: 'pg.connect',
      outcome: 'error',
    })
    // And the line never carries the message or anything but numbers and a word.
    expect(lines[0]).not.toContain('timeout exceeded')
  })

  it('the line is numbers and an outcome word, nothing else', () => {
    const line = pgConnectLine({
      wallMs: 42,
      counts: { totalCount: 1, idleCount: 0, waitingCount: 0 },
      outcome: 'ok',
    })
    expect(line).toBe(
      '{"event":"pg.connect","wallMs":42,"poolTotal":1,"poolIdle":0,"poolWaiting":0,"outcome":"ok"}',
    )
  })

  it('db.ts builds the pg pool itself, instrumented, with the connect timeout', () => {
    const db = readFileSync('src/lib/db.ts', 'utf8')
    expect(db).toMatch(
      /new PrismaPg\(\s*instrumentPool\(\s*new pg\.Pool\(\{\s*\.\.\.pool,\s*connectionTimeoutMillis: PG_CONNECT_TIMEOUT_MS,/,
    )
  })
})
