import { onAuditEvent, type AuditEvent } from './audit'

// ---------------------------------------------------------------------------
// THE DURABLE END OF `onAuditEvent`
//
// Carried debt from Phase 1 §8, now paid. `getAuditHealth()` counts in isolate
// memory, and Workers isolates are ephemeral and plural: an isolate that
// records four audit failures and is then recycled took the only copy of that
// number with it. The console line survives in Workers observability, but a
// log line is something you read after being told where to look.
//
// Analytics Engine is the fleet-wide counterpart — one datapoint per event,
// queryable across every isolate that ever ran. It is a binding rather than a
// service to call, so this costs no request latency: `writeDataPoint` is
// fire-and-forget into the runtime.
//
// TWO PROPERTIES THIS FILE MUST KEEP:
//
//   1. A missing binding is not an error. Tests, `next dev`, and any runtime
//      without Analytics Engine have no binding, and audit must keep working
//      exactly as before. There is no configuration in which a sink failure
//      becomes a write failure — `emit` already swallows handler throws, and
//      this file does not rely on that.
//   2. Nothing tenant-identifying leaves. Blobs carry the SHAPE of the
//      problem — model, operation, gap kind — never a row id and never a value
//      out of a diff. Analytics Engine sits outside the row-level security
//      this whole application is built on, so nothing goes in that would
//      matter if the wrong person read it.
// ---------------------------------------------------------------------------

interface AnalyticsEngineDataset {
  writeDataPoint(point: {
    blobs?: string[]
    doubles?: number[]
    indexes?: string[]
  }): void
}

let registered = false

/**
 * Events that reached the sink and found no dataset to write to.
 *
 * ── THE ONE WAY THIS FILE COULD FAIL SILENTLY ────────────────────────────
 *
 * Every other branch here is deliberate: no binding in tests, none in
 * `next dev`, and audit keeps working. But the SAME quiet return covers a real
 * production fault — the context symbol renamed under us, the binding dropped
 * from `wrangler.jsonc` for one environment, a runtime where the context is not
 * parked where we look. In that state failures and gaps stop being recorded
 * anywhere fleet-wide, and the only evidence is an absence of datapoints, which
 * is indistinguishable from a clean week.
 *
 * So the absence is counted, and announced ONCE per isolate. A count nobody can
 * read is the problem Phase 1 §8 already paid for; this one goes to the console,
 * which is where somebody looking at a Worker is already looking.
 */
let dropped = 0
let warned = false

/** Read by `tests/audit-sink.test.ts`. Not a production surface. */
export function sinkHealth(): { dropped: number } {
  return { dropped }
}

export function resetSinkHealth(): void {
  dropped = 0
  warned = false
}

/**
 * Attach the sink, once per isolate.
 *
 * Called from `createPrismaClient` — the one place guaranteed to run before
 * any audited write, in whatever runtime we are actually in. An
 * `instrumentation.ts` hook would be the tidier home and is one more thing
 * that behaves differently between `next dev` and workerd; this file exists
 * because of a bug in exactly that seam.
 */
export function ensureAuditSink(): void {
  if (registered) return
  registered = true

  onAuditEvent((event: AuditEvent) => {
    const dataset = analyticsEngine()
    if (!dataset) {
      // COUNTED, AND SAID ONCE. Not per event: a broken binding would otherwise
      // print a line per audited write, which is how a log becomes unreadable
      // and then ignored.
      dropped += 1
      if (!warned) {
        warned = true
        if (hasCloudflareContext()) {
          // THE FAULT. A Worker is running and its context has no dataset:
          // the binding fell out of `wrangler.jsonc` for this environment, or
          // the context moved. This is the one line this file exists for.
          console.warn(
            '[zebra.audit.sink] no AUDIT_EVENTS dataset on this Worker — ' +
              'audit failures and gaps are NOT being recorded fleet-wide. ' +
              'The AuditLog table is unaffected; this is the health signal, ' +
              'and it is off.',
          )
        } else if (nodeDebugNames('zebra.audit')) {
          // NOT THE FAULT. Node has no Analytics Engine; the line is noise
          // outside the Worker (GAPS 41, owner's ruling 2026-11-12). For a
          // month this branch wore the fault's words, once per script run,
          // once per `npm run check`, 56 times per integration run — and a
          // health signal that cries on every Node run cannot be read the
          // one time it is real. So: debug level, behind Node's own switch,
          // `NODE_DEBUG=zebra.audit`. Still counted in `dropped`, which is
          // the number a test reads.
          console.debug(
            '[zebra.audit.sink] no Cloudflare context: Node has no Analytics ' +
              'Engine, so this process records no audit event fleet-wide. ' +
              'On the Workers the events go to AUDIT_EVENTS.',
          )
        }
      }
      return
    }

    if (event.type === 'failure') {
      dataset.writeDataPoint({
        indexes: ['failure'],
        blobs: [
          'failure',
          event.failure.model,
          event.failure.operation,
          // The message, not the ids. A Prisma error names the constraint or
          // the missing privilege, and that is the diagnostic; the entity ids
          // are the tenant's data.
          event.failure.message.slice(0, 256),
        ],
        doubles: [1, event.failure.entityIds.length],
      })
      return
    }

    dataset.writeDataPoint({
      indexes: ['gap'],
      blobs: ['gap', event.model, event.operation, event.kind],
      doubles: [1, 0],
    })
  })
}

/**
 * The request's Analytics Engine binding, or null.
 *
 * Read off the context OpenNext parks on `globalThis` rather than by importing
 * `@opennextjs/cloudflare`, because this module is loaded by `db.ts` and
 * therefore by the Node test project too, where that package has no business
 * being resolved. The symbol is OpenNext's, and the coupling is the price of
 * not dragging a Workers-only import into every runtime.
 *
 * If OpenNext ever renames it, this returns null and the sink goes quiet. TWO
 * things watch for that, and this comment used to name neither accurately:
 *
 *   - `tests/audit-sink.test.ts` asserts the binding is declared in
 *     `wrangler.jsonc` for EVERY environment, with its own dataset per
 *     environment, and that resolution goes through this symbol. It reads the
 *     file; it is not a workers-pool reachability check, which is what the
 *     previous wording claimed.
 *   - `dropped` above counts events that found no dataset at runtime, and says
 *     so once per isolate. That is the half a config test cannot cover.
 */
const CLOUDFLARE_CONTEXT = Symbol.for('__cloudflare-context__')

/**
 * The Worker's `env`, or null outside a Worker.
 *
 * TWO SILENCES, TOLD APART HERE. `analyticsEngine()` answers null for both
 * "there is no Cloudflare context at all" — Node: tsx, vitest, `next dev`,
 * every script — and "there is a context and it carries no dataset", which is
 * a Worker whose binding was lost. The first is the designed state of every
 * non-Worker runtime; the second is the fault. `ensureAuditSink` reads
 * `hasCloudflareContext()` to say which one it is in, because for a month it
 * said the fault's words in both (GAPS 41).
 */
function cloudflareEnv(): Record<string, unknown> | null {
  const context = (globalThis as Record<symbol, unknown>)[CLOUDFLARE_CONTEXT]
  if (!context || typeof context !== 'object') return null

  const env = (context as { env?: unknown }).env
  if (!env || typeof env !== 'object') return null
  return env as Record<string, unknown>
}

export function hasCloudflareContext(): boolean {
  return cloudflareEnv() !== null
}

export function analyticsEngine(): AnalyticsEngineDataset | null {
  const env = cloudflareEnv()
  if (!env) return null

  const binding = env['AUDIT_EVENTS']
  if (binding && typeof binding === 'object' && 'writeDataPoint' in binding) {
    return binding as AnalyticsEngineDataset
  }
  return null
}

/**
 * Node's own debug switch, read without `node:util`.
 *
 * `util.debuglog(section)` prints only when `NODE_DEBUG` names the section;
 * that is the level the owner asked the Node line down to. The module is
 * loaded by `db.ts` in both runtimes, and `node:util` is not an import this
 * file will put in front of every Worker request for one log line — so the
 * variable is read directly, the way Node reads it: comma- or
 * space-separated section names, case-insensitive. Exported for the test;
 * not a production surface.
 */
export function nodeDebugNames(section: string): boolean {
  const process = (globalThis as { process?: { env?: Record<string, string> } })
    .process
  const value = process?.env?.['NODE_DEBUG']
  if (typeof value !== 'string' || value === '') return false
  const wanted = section.toLowerCase()
  return value.split(/[\s,]+/).some((name) => name.toLowerCase() === wanted)
}
