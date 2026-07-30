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
    if (!dataset) return

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
 * If OpenNext ever renames it, this returns null and the sink goes quiet —
 * which is why `npm run check` asserts the binding is reachable under the
 * workers pool rather than trusting the shape.
 */
const CLOUDFLARE_CONTEXT = Symbol.for('__cloudflare-context__')

export function analyticsEngine(): AnalyticsEngineDataset | null {
  const context = (globalThis as Record<symbol, unknown>)[CLOUDFLARE_CONTEXT]
  if (!context || typeof context !== 'object') return null

  const env = (context as { env?: unknown }).env
  if (!env || typeof env !== 'object') return null

  const binding = (env as Record<string, unknown>)['AUDIT_EVENTS']
  if (binding && typeof binding === 'object' && 'writeDataPoint' in binding) {
    return binding as AnalyticsEngineDataset
  }
  return null
}
