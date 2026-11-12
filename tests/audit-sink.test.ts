import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import {
  analyticsEngine,
  ensureAuditSink,
  hasCloudflareContext,
  nodeDebugNames,
  resetSinkHealth,
  sinkHealth,
} from '@/lib/audit-sink'
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

/**
 * wrangler.jsonc, parsed rather than grepped.
 *
 * The previous version of the test below searched the whole file for the
 * binding name and passed while the PRODUCTION environment had no sink at
 * all: bindings are not inherited into a named environment, and a `toContain`
 * over the file cannot tell one environment from another. Parsing is what
 * makes the per-environment claim checkable.
 *
 * JSONC, so line comments and trailing commas come out first. Block comments
 * are not used in that file and are deliberately not handled — a parser that
 * quietly accepts more than the file contains is a parser that can drift from
 * what wrangler itself reads.
 */
function readWranglerConfig(): {
  analytics_engine_datasets?: { binding: string; dataset: string }[]
  env?: Record<
    string,
    { analytics_engine_datasets?: { binding: string; dataset: string }[] }
  >
} {
  const raw = readFileSync('wrangler.jsonc', 'utf8')
  const stripped = raw
    .split('\n')
    .map((line) => {
      // Only a comment that starts the line's content — no URL in that file
      // sits outside a string, but this is the cheap way to be sure.
      const trimmed = line.trimStart()
      return trimmed.startsWith('//') ? '' : line
    })
    .join('\n')
    .replace(/,(\s*[}\]])/g, '$1')
  return JSON.parse(stripped)
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

  it('is declared in EVERY environment, not just the default one', () => {
    // Production shipped without it. `analyticsEngine()` returns null when the
    // binding is missing and audit carries on — correct behaviour, and the
    // reason the omission is silent. The parallel run puts real freight in
    // production; an audit trail with no durable sink is the one thing there
    // that cannot be reconstructed afterwards.
    const config = readWranglerConfig()
    const environments: [string, typeof config][] = [
      ['(default)', config],
      ...Object.entries(config.env ?? {}),
    ]

    for (const [name, environment] of environments) {
      const datasets = environment.analytics_engine_datasets ?? []
      expect(
        datasets.map((dataset) => dataset.binding),
        `environment ${name} has no ${BINDING} binding`,
      ).toContain(BINDING)
    }
  })

  it('gives each environment its own dataset', () => {
    // Dev and production writing to one dataset would make "zero failures
    // this week" a claim about both at once, and the acceptance criterion is
    // about the one carrying real loads.
    const config = readWranglerConfig()
    const datasets = [
      ...(config.analytics_engine_datasets ?? []),
      ...Object.values(config.env ?? {}).flatMap(
        (environment) => environment.analytics_engine_datasets ?? [],
      ),
    ].map((dataset) => dataset.dataset)

    expect(new Set(datasets).size).toBe(datasets.length)
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

  // ── AND THE SILENCE IS NO LONGER SILENT — ON A WORKER ──────────────────
  //
  // The quiet return above is correct for tests and `next dev`, and it also
  // covers a real production fault: the context symbol renamed, the binding
  // dropped from one environment, a runtime where the context is not where we
  // look. In that state failures and gaps stop being recorded fleet-wide and the
  // only evidence is an ABSENCE of datapoints — indistinguishable from a clean
  // week. So the absence is counted and announced once.
  //
  // TWO SILENCES, AND ONLY ONE IS THE FAULT (GAPS 41, owner's ruling
  // 2026-11-12: "Node has no Analytics Engine; the line is noise outside the
  // Worker"). Until then the Node branch printed the fault's words on every
  // script run, every `npm run check` and 56 times per integration run, and a
  // health signal that cries on every Node run cannot be read the one time it
  // is real. So the three cases below hold the split: a Worker without the
  // binding WARNS once; Node says nothing; Node under `NODE_DEBUG=zebra.audit`
  // says so once at debug level.
  it('on a Worker whose context has no AUDIT_EVENTS, counts the drops and warns once', async () => {
    resetSinkHealth()
    const warnings: unknown[][] = []
    const original = console.warn
    console.warn = (...args: unknown[]) => void warnings.push(args)
    try {
      ensureAuditSink()
      await withContext({ SOMETHING_ELSE: {} }, async () => {
        await provokeGap()
        await provokeGap()
      })
    } finally {
      console.warn = original
    }

    // BOTH DROPS COUNTED, so the number is the size of the problem.
    expect(sinkHealth().dropped).toBe(2)
    // ONE LINE, NOT TWO. A broken binding would otherwise print per audited
    // write, which is how a log becomes unreadable and then ignored.
    //
    // FILTERED TO THE SINK'S OWN PREFIX: audit.ts warns about the GAP itself on
    // every gap, so an unfiltered count is the gaps plus this, and the assertion
    // was failing on somebody else's correct behaviour.
    const mine = warnings.filter((args) =>
      String(args[0]).includes('zebra.audit.sink'),
    )
    expect(mine).toHaveLength(1)
    expect(JSON.stringify(mine[0])).toContain('no AUDIT_EVENTS dataset')
    // AND IT SAYS THE TABLE IS FINE, because the first question somebody asks on
    // reading it is whether the audit trail itself is broken. It is not.
    expect(JSON.stringify(mine[0])).toContain('AuditLog table is')
  })

  it('in Node — no Cloudflare context — counts the drops and prints nothing', async () => {
    resetSinkHealth()
    const warnings: unknown[][] = []
    const debugs: unknown[][] = []
    const originalWarn = console.warn
    const originalDebug = console.debug
    const originalNodeDebug = process.env.NODE_DEBUG
    console.warn = (...args: unknown[]) => void warnings.push(args)
    console.debug = (...args: unknown[]) => void debugs.push(args)
    delete process.env.NODE_DEBUG
    try {
      ensureAuditSink()
      await provokeGap()
      await provokeGap()
    } finally {
      console.warn = originalWarn
      console.debug = originalDebug
      if (originalNodeDebug !== undefined)
        process.env.NODE_DEBUG = originalNodeDebug
    }

    // STILL COUNTED: the number is what `sinkHealth()` is for.
    expect(sinkHealth().dropped).toBe(2)
    // NOT A WARNING, because this is not the fault — and not a debug line
    // either, because nobody asked: a script's console carries nothing from
    // the sink.
    const sink = (lines: unknown[][]) =>
      lines.filter((args) => String(args[0]).includes('zebra.audit.sink'))
    expect(sink(warnings)).toHaveLength(0)
    expect(sink(debugs)).toHaveLength(0)
  })

  it('in Node under NODE_DEBUG=zebra.audit, says so once at debug level', async () => {
    resetSinkHealth()
    const warnings: unknown[][] = []
    const debugs: unknown[][] = []
    const originalWarn = console.warn
    const originalDebug = console.debug
    const originalNodeDebug = process.env.NODE_DEBUG
    console.warn = (...args: unknown[]) => void warnings.push(args)
    console.debug = (...args: unknown[]) => void debugs.push(args)
    process.env.NODE_DEBUG = 'http, ZEBRA.AUDIT'
    try {
      ensureAuditSink()
      await provokeGap()
      await provokeGap()
    } finally {
      console.warn = originalWarn
      console.debug = originalDebug
      if (originalNodeDebug === undefined) delete process.env.NODE_DEBUG
      else process.env.NODE_DEBUG = originalNodeDebug
    }

    expect(sinkHealth().dropped).toBe(2)
    const sink = (lines: unknown[][]) =>
      lines.filter((args) => String(args[0]).includes('zebra.audit.sink'))
    // ONCE, at debug, naming the silence it is in — and never the fault's
    // words, which are reserved for a Worker.
    expect(sink(warnings)).toHaveLength(0)
    expect(sink(debugs)).toHaveLength(1)
    expect(JSON.stringify(sink(debugs)[0])).toContain('no Cloudflare context')
    expect(JSON.stringify(sink(debugs)[0])).not.toContain('NOT being recorded')
  })

  it('reads NODE_DEBUG the way Node does: names, separated, case-insensitive', () => {
    const originalNodeDebug = process.env.NODE_DEBUG
    try {
      delete process.env.NODE_DEBUG
      expect(nodeDebugNames('zebra.audit')).toBe(false)
      process.env.NODE_DEBUG = ''
      expect(nodeDebugNames('zebra.audit')).toBe(false)
      process.env.NODE_DEBUG = 'zebra.audit'
      expect(nodeDebugNames('zebra.audit')).toBe(true)
      process.env.NODE_DEBUG = 'net,Zebra.Audit'
      expect(nodeDebugNames('zebra.audit')).toBe(true)
      // A prefix is not a name: `zebra` does not switch on `zebra.audit`.
      process.env.NODE_DEBUG = 'zebra'
      expect(nodeDebugNames('zebra.audit')).toBe(false)
    } finally {
      if (originalNodeDebug === undefined) delete process.env.NODE_DEBUG
      else process.env.NODE_DEBUG = originalNodeDebug
    }
  })

  it('tells a Worker from Node by the context, not by the binding', async () => {
    expect(hasCloudflareContext()).toBe(false)
    await withContext({}, () => {
      expect(hasCloudflareContext()).toBe(true)
      expect(analyticsEngine()).toBeNull()
    })
  })

  it('and counts nothing when the binding is there', async () => {
    resetSinkHealth()
    const points: { indexes?: string[] }[] = []
    const dataset = {
      writeDataPoint: (point: { indexes?: string[] }) =>
        void points.push(point),
    }
    ensureAuditSink()
    await withContext({ AUDIT_EVENTS: dataset }, provokeGap)

    expect(points).toHaveLength(1)
    // THE CONTROL: without it, a counter that incremented on every event would
    // pass the test above and report a healthy sink as broken.
    expect(sinkHealth().dropped).toBe(0)
  })
})
