import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { analyticsEngine, ensureAuditSink } from '@/lib/audit-sink'
import { auditExtension, getAuditHealth, resetAuditHealth } from '@/lib/audit'

// Standing rule 8: a guardrail nobody has watched fail might be misconfigured.
// The sink's failure mode is silence — it returns null and audit carries on
// exactly as before, which is correct behaviour and indistinguishable from a
// binding that was renamed, removed, or never bound. So the name is asserted
// from both ends.

const CLOUDFLARE_CONTEXT = Symbol.for('__cloudflare-context__')
const BINDING = 'AUDIT_EVENTS'

// Awaits before restoring. A synchronous `finally` would tear the context down
// while the hook it is meant to be testing was still mid-flight, and the test
// would report a silent sink that is working perfectly.
async function withContext<T>(
  env: unknown,
  fn: () => T | Promise<T>,
): Promise<T> {
  const target = globalThis as Record<symbol, unknown>
  const previous = target[CLOUDFLARE_CONTEXT]
  target[CLOUDFLARE_CONTEXT] = { env }
  try {
    return await fn()
  } finally {
    target[CLOUDFLARE_CONTEXT] = previous
  }
}

describe('the Analytics Engine binding', () => {
  it('is declared in wrangler.jsonc under the name the code looks for', () => {
    // The two halves of this live in different files and different languages,
    // and nothing else would notice them drifting apart.
    const config = readFileSync('wrangler.jsonc', 'utf8')
    expect(config).toContain(`"binding": "${BINDING}"`)
    expect(readFileSync('src/lib/audit-sink.ts', 'utf8')).toContain(
      `'${BINDING}'`,
    )
  })

  it('is null when there is no Cloudflare context at all', () => {
    // Node, `next dev`, and every test but this one.
    expect(analyticsEngine()).toBeNull()
  })

  it('is null when the context carries no such binding', async () => {
    await withContext({ SOMETHING_ELSE: {} }, () => {
      expect(analyticsEngine()).toBeNull()
    })
  })

  it('is null when the binding is present but the wrong shape', async () => {
    // A string named AUDIT_EVENTS is a misconfiguration, not a dataset.
    await withContext({ AUDIT_EVENTS: 'not-a-dataset' }, () => {
      expect(analyticsEngine()).toBeNull()
    })
  })

  it('resolves through the symbol OpenNext parks the context on', async () => {
    const dataset = { writeDataPoint: () => {} }
    await withContext({ AUDIT_EVENTS: dataset }, () => {
      expect(analyticsEngine()).toBe(dataset)
    })
  })
})

interface ExtensionDefinition {
  query: {
    $allModels: {
      $allOperations: (input: {
        model: string
        operation: string
        args: unknown
        query: (args: unknown) => Promise<unknown>
      }) => Promise<unknown>
    }
  }
}

/**
 * Drive one real audit gap without a database.
 *
 * `$allOperations` is the extension's whole surface, and an operation with no
 * audit scope around it takes the `noContext` branch — a genuine emit, not a
 * simulation of one.
 */
async function provokeGap(): Promise<void> {
  // `Prisma.defineExtension` hands back `(client) => client.$extends(defn)`,
  // so the definition comes out by handing it a client that only records what
  // it was given.
  let definition: ExtensionDefinition | null = null
  const recorder = {
    $extends: (given: ExtensionDefinition) => {
      definition = given
      return recorder
    },
  }
  ;(auditExtension as unknown as (client: unknown) => unknown)(recorder)
  if (definition === null) throw new Error('extension definition not captured')

  const hook = (definition as ExtensionDefinition).query.$allModels
    .$allOperations

  await hook({
    model: 'Load',
    operation: 'create',
    args: { data: {} },
    query: async () => ({ id: 'c00000000000000000000000' }),
  })
}

describe('ensureAuditSink', () => {
  afterEach(() => resetAuditHealth())

  it('writes one datapoint per event, carrying shape and no tenant data', async () => {
    const points: Array<{ blobs?: string[]; indexes?: string[] }> = []
    const dataset = { writeDataPoint: (p: never) => points.push(p) }

    ensureAuditSink()
    await withContext({ AUDIT_EVENTS: dataset }, provokeGap)

    expect(points).toHaveLength(1)
    expect(points[0]!.indexes).toEqual(['gap'])
    expect(points[0]!.blobs).toEqual(['gap', 'Load', 'create', 'noContext'])
    // The row id went through the extension and must not have come out here.
    expect(JSON.stringify(points[0])).not.toContain('c00000000000000000000000')
  })

  it('is idempotent, so a per-request call does not stack handlers', async () => {
    // Called from createPrismaClient, which runs once per request. Unguarded,
    // an isolate serving a thousand requests would write a thousand
    // datapoints for one event.
    const points: unknown[] = []
    const dataset = { writeDataPoint: (p: never) => points.push(p) }

    ensureAuditSink()
    ensureAuditSink()
    ensureAuditSink()

    await withContext({ AUDIT_EVENTS: dataset }, provokeGap)
    expect(points).toHaveLength(1)
  })

  it('is a no-op, not a throw, when there is no binding', async () => {
    // The property that matters most: audit must behave identically on a
    // runtime with no Analytics Engine.
    await expect(provokeGap()).resolves.toBeUndefined()
    expect(getAuditHealth().gaps.noContext).toBe(1)
  })
})
