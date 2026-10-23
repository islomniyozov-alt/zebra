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
  hyperdriveConnectionString,
  POOL_IDLE_TIMEOUT_MS,
  requestClient,
  requireAppRole,
  requireHyperdriveString,
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
            /createPrismaClient\(|new PrismaClient\(|new PrismaNeon\(|new PrismaPg\(|new Pool\(/.test(
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
    // And inside db.ts, one construction site for a request: `cachedClient`
    // calls `createRequestPrismaClient`, which picks the path (§6.10).
    const db = readFileSync('src/lib/db.ts', 'utf8')
    expect(db.match(/= createRequestPrismaClient\(\)/g)).toHaveLength(1)
  })
})

// §6.10, GAPS 33: Hyperdrive on the dev worker only, switched by the binding.
describe('the connection path', () => {
  const contextWith = (env: unknown) => ({
    [Symbol.for('__cloudflare-context__')]: { env },
  })

  it('is Hyperdrive only when the Worker carries the binding', () => {
    expect(
      hyperdriveConnectionString(
        contextWith({
          HYPERDRIVE: {
            connectionString: 'postgresql://zebra_app:x@h.hyperdrive.local/db',
          },
        }),
      ),
    ).toBe('postgresql://zebra_app:x@h.hyperdrive.local/db')
    expect(hyperdriveConnectionString(contextWith({}))).toBeNull()
    expect(hyperdriveConnectionString({})).toBeNull()
    // Under Node, here, there is no binding: tests and scripts stay on Neon.
    expect(hyperdriveConnectionString()).toBeNull()
  })

  it('the Neon path still refuses anything that is not zebra_app', () => {
    expect(() =>
      requireAppRole('postgresql://neondb_owner:x@ep-x-pooler.neon.tech/db'),
    ).toThrow(/does not authenticate as zebra_app/)
  })

  it('the Hyperdrive path takes the binding’s own string and nothing else', () => {
    // §6.10, corrected 2026-10-23: the binding's string carries Hyperdrive's
    // generated user at a *.hyperdrive.local host — the old zebra_app check
    // on it refused six of six sign-ins. The role is read back from the
    // config by the sweep; the client checks the host and refuses the owner.
    const bound =
      'postgresql://8a1f2c3d4e5f:generated-secret@4395e48e858b4d1ca4a5ea2fdd2610c9.hyperdrive.local:5432/neondb?sslmode=disable'
    expect(requireHyperdriveString(bound)).toBe(bound)
    expect(() =>
      requireHyperdriveString(
        'postgresql://zebra_app:x@ep-x-pooler.us-east-2.aws.neon.tech/neondb',
      ),
    ).toThrow(/does not point at a Hyperdrive host/)
    expect(() =>
      requireHyperdriveString(
        'postgresql://neondb_owner:x@abc.hyperdrive.local:5432/neondb',
      ),
    ).toThrow(/names an owner role/)
    expect(() => requireHyperdriveString('not a url')).toThrow(
      /did not provide a connection URL/,
    )
    const db = readFileSync('src/lib/db.ts', 'utf8')
    expect(db).toMatch(
      /createPrismaClient\(requireHyperdriveString\(hyperdrive\), 'hyperdrive'\)/,
    )
  })

  it('is bound on the dev worker and never in production', () => {
    const stripped = readFileSync('wrangler.jsonc', 'utf8')
      .split('\n')
      .map((line) => (line.trimStart().startsWith('//') ? '' : line))
      .join('\n')
      .replace(/,(\s*[}\]])/g, '$1')
    const config = JSON.parse(stripped) as {
      hyperdrive?: { binding: string; id: string }[]
      env?: Record<string, { hyperdrive?: unknown }>
    }
    expect(config.hyperdrive).toEqual([
      { binding: 'HYPERDRIVE', id: '4395e48e858b4d1ca4a5ea2fdd2610c9' },
    ])
    expect(config.env?.production?.hyperdrive).toBeUndefined()
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
    // 5 s, not 1 s: at 1 s the pool closed connections mid-request (owner's
    // ruling 2026-10-13). Not the 10 s default either, which was the linger.
    expect(POOL_IDLE_TIMEOUT_MS).toBe(5_000)
    const db = readFileSync('src/lib/db.ts', 'utf8')
    expect(db).toContain('idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS')
    expect(db).toMatch(
      /const client = createRequestPrismaClient\(\)\s*endWithResponse\(client\)/,
    )
  })
})
