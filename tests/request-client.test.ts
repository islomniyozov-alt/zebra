import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// ONE CLIENT PER REQUEST, ENDED WITH THE RESPONSE (TMS-DESIGN-SYSTEM.md §6.8,
// owner's rulings 2026-10-12, GAPS 31 and 32).
//
// Measured before: ~10 s of Worker wall after every response (the request's
// Neon pool, never closed, idle timeout 10 s), and about ten Prisma clients
// for one dashboard render, because every `withCurrentOrg` opened a fresh
// request scope and the shell's account read built its own client.
// ---------------------------------------------------------------------------

// `requestClient()` builds from DATABASE_URL and refuses anything that is not
// zebra_app. Constructing a client opens nothing, so a fake string is enough.
process.env.DATABASE_URL ??=
  'postgresql://zebra_app:x@ep-test.us-east-2.aws.neon.tech/neondb'

const {
  endWithResponse,
  POOL_IDLE_TIMEOUT_MS,
  requestClient,
  withRequestClient,
} = await import('@/lib/db')

describe('one client per request (GAPS 32)', () => {
  it('a scope already open is reused, never nested', async () => {
    await withRequestClient(async () => {
      const outer = requestClient()
      const [a, b] = await Promise.all([
        withRequestClient(async () => requestClient()),
        withRequestClient(async () => requestClient()),
      ])
      expect(a).toBe(outer)
      expect(b).toBe(outer)
    })
  })

  it('the tenant-less handles take the request’s client', () => {
    for (const path of [
      'src/lib/auth-db.ts',
      'src/lib/unrouted-email-store.ts',
    ]) {
      const source = readFileSync(path, 'utf8')
      expect(source, path).toContain('requestClient()')
      expect(source, path).not.toMatch(/createPrismaClient\(/)
    }
  })

  it('db.ts is the only file in src that constructs a client — the grep-proof', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (name === 'generated') continue
        if (statSync(path).isDirectory()) walk(path)
        else if (/\.(ts|tsx|mjs)$/.test(name)) {
          const text = readFileSync(path, 'utf8')
          if (
            /createPrismaClient\(|new PrismaClient\(|new PrismaNeon\(|new Pool\(/.test(
              text,
            ) &&
            path.replaceAll('\\', '/') !== 'src/lib/db.ts'
          )
            offenders.push(path)
        }
      }
    }
    walk('src')
    expect(offenders).toEqual([])
    // And inside db.ts, one construction site for a request: `cachedClient`.
    const db = readFileSync('src/lib/db.ts', 'utf8')
    expect(
      db.match(/createPrismaClient\(appConnectionString\(\)\)/g),
    ).toHaveLength(1)
  })
})

describe('the client ends with the response (GAPS 31)', () => {
  it('schedules a disconnect, and runs it when the response is done', async () => {
    const disconnect = vi.fn(async () => {})
    const client = { $disconnect: disconnect } as unknown as PrismaClient
    let task: (() => Promise<void>) | null = null
    expect(endWithResponse(client, (t) => void (task = t))).toBe(true)
    expect(disconnect).not.toHaveBeenCalled()
    await task!()
    expect(disconnect).toHaveBeenCalledTimes(1)
  })

  it('outside a request there is nothing to schedule with — the idle timeout is the floor', () => {
    const client = { $disconnect: vi.fn() } as unknown as PrismaClient
    expect(
      endWithResponse(client, () => {
        throw new Error('`after` was called outside a request scope')
      }),
    ).toBe(false)
    expect(POOL_IDLE_TIMEOUT_MS).toBe(1_000)
    const db = readFileSync('src/lib/db.ts', 'utf8')
    expect(db).toContain('idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS')
    expect(db).toMatch(
      /const client = createPrismaClient\(appConnectionString\(\)\)\s*endWithResponse\(client\)/,
    )
  })
})
