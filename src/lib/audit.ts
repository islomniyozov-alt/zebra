import { AsyncLocalStorage } from 'node:async_hooks'
import { Prisma } from '@/generated/prisma/client'
import type { AuditAction } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE AUDIT TRAIL
//
// A Prisma client extension over $allOperations, not calls placed by hand.
// Hand-placed audit lands somewhere around 60% covered, and 60% coverage is
// worse than none: it looks like a record, so nobody checks whether the write
// they care about is in it.
//
// WHERE THE ROW IS WRITTEN. Inside the caller's own transaction, wrapped in a
// SAVEPOINT. Both halves matter:
//
//   * Inside, because AuditLog is behind row-level security like everything
//     else. A second connection would have no app.current_org_id and the
//     insert would be refused — and because a rolled-back write must not
//     leave an audit row claiming it happened.
//   * Behind a SAVEPOINT, because a failed statement poisons a Postgres
//     transaction. Without one, "audit failed" would silently become "the
//     load was never saved", which is precisely the outcome §8 forbids.
//
// FAILURE POLICY. §8 says log and continue. Continuing is not the same as
// swallowing: every failure increments a counter, records its details, is
// written to the log with a fixed, greppable tag, and is handed to any
// registered sink. Gaps are counted separately so a genuine failure is never
// lost in their noise. Which counters mean what is spelled out on AuditHealth.
//
// WHAT THE COUNTERS CAN AND CANNOT TELL YOU. They live in isolate memory, and
// Workers isolates are ephemeral and plural — so in production
// `getAuditHealth()` reports one isolate's slice of one moment, not the
// fleet's. It is a test and development instrument and should be read as one.
// The durable signal today is the `[zebra.audit.failure]` log line, which
// Workers observability retains and can alert on. For a real fleet-wide
// metric, `onAuditEvent` is the seam: point it at Analytics Engine or Sentry.
// Until that exists, do not treat a zero from this function as evidence.
//
// THIS IS A CHANGE LOG, NOT A SECURITY EVENT LOG, and the two must not merge.
// Because the audit row rides the caller's transaction, a rolled-back write
// leaves no trace — which is right for the question this table answers, "what
// happened to this load". It is wrong for "who tried to reach what and was
// refused". Denied permission checks, forged tenant attempts and rolled-back
// writes belong in a separate stream; LoginAttempt is the beginning of one.
// Conflating them makes both worse: the change log fills with noise and the
// security log inherits a rollback rule that erases exactly the attempts you
// wanted to see.
// ---------------------------------------------------------------------------

/** Never audited, and each for its own reason. */
const UNAUDITED_MODELS = new Set([
  // Writing an audit row for writing an audit row.
  'AuditLog',
  // §8. Sessions turn over constantly and say nothing about the business.
  'Session',
  // §8. Machine-generated noise.
  'Notification',
  // Not in §8, added here: it is already an audit trail, it is written before
  // anyone is authenticated, and auditing it would mean an audit row for every
  // failed password guess in a rate-limit storm.
  'LoginAttempt',
])

/**
 * Always changes, never interesting. Leaving it in would put `updatedAt` in
 * every single diff and bury the field that actually moved.
 */
const IGNORED_FIELDS = new Set(['updatedAt'])

const WRITE_OPERATIONS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
])

/** Who is making the writes, and from where. */
export interface Attribution {
  userId: string
  ip?: string | null
  userAgent?: string | null
}

/**
 * A declaration that a batch of writes has no acting user, and why.
 *
 * This exists so that an unattributed write is a deliberate, greppable,
 * reviewable act rather than a forgotten argument. `runInOrg` requires one or
 * the other, so an audit gap cannot happen because somebody was in a hurry —
 * only because somebody wrote the word `unattributed` and gave a reason, and
 * that reason lands in the log.
 */
export interface Unattributed {
  readonly kind: 'unattributed'
  readonly reason: string
}

export function unattributed(reason: string): Unattributed {
  return { kind: 'unattributed', reason }
}

export type WriteAttribution = Attribution | Unattributed

export function isUnattributed(
  attribution: WriteAttribution,
): attribution is Unattributed {
  return 'kind' in attribution && attribution.kind === 'unattributed'
}

/** The delegate surface the extension needs from a transaction client. */
export interface AuditCapableTx {
  $executeRawUnsafe(query: string): Promise<number>
  auditLog: {
    createMany(args: { data: unknown[] }): Promise<{ count: number }>
  }
  [model: string]: unknown
}

export interface AuditScope {
  tx: AuditCapableTx
  /**
   * Supplied by `runInOrg`, not by the caller. Attribution used to carry its
   * own copy, which meant two sources for one fact and a way for them to
   * disagree.
   */
  organizationId: string
  attribution: WriteAttribution
  /**
   * Audit rows waiting to be written, flushed once before commit.
   *
   * WHY BUFFER. Each audited write used to cost four statements — SAVEPOINT,
   * the write, the audit INSERT, RELEASE — so six writes cost twenty-four.
   * Measured on the deployed worker, booking a load took **260ms of CPU and
   * 9.4 seconds of wall clock**: the work was nothing and the waiting was
   * everything, because every statement is a round trip to Neon. Buffering
   * makes it six statements plus one savepoint-wrapped multi-row insert.
   *
   * WHAT DOES NOT CHANGE, and this is the part worth guarding:
   *
   *   * The rows still ride the CALLER'S transaction. A rolled-back write
   *     still leaves no audit row claiming it happened (Phase 1 §8).
   *   * The insert is still behind a savepoint, so a failed audit cannot
   *     poison the caller's transaction.
   *   * A failure is still loud and countable. Buffering changes when the
   *     insert happens, not whether anyone hears about it.
   *
   * The one real cost: a failure is discovered at flush rather than at the
   * write that caused it. `flushAuditBuffer` names the models and operations
   * the buffer actually held, so a single-model transaction — almost all of
   * them — reports exactly what it did before.
   */
  buffer: BufferedEntry[]
}

interface BufferedEntry extends PendingEntry {
  model: string
  operation: string
}

/**
 * Carries the open transaction and the acting user into the extension.
 *
 * $allOperations is handed the operation but not the client running it, and a
 * query extension cannot be applied to a transaction client — Prisma denies
 * $extends there. Async context is what closes that gap.
 */
export const auditScope = new AsyncLocalStorage<AuditScope>()

// --- health -----------------------------------------------------------------

export interface AuditFailure {
  at: Date
  model: string
  operation: string
  entityIds: string[]
  message: string
}

export interface AuditHealth {
  /** Audit rows successfully written. */
  written: number
  /**
   * Audit rows that could not be written. **Should be zero forever** — this is
   * the number worth alerting on, subject to the isolate caveat at the top of
   * this file.
   */
  failures: number
  lastFailure: AuditFailure | null
  gaps: {
    /**
     * Writes that ran in no tenant transaction at all — the seed, and the
     * login path touching `User` before any organization is known.
     * **Expected to be non-zero** and roughly to track logins. Informational.
     */
    noContext: number
    /**
     * Writes inside a tenant transaction that explicitly declared
     * `unattributed(reason)`. **Should be zero in application code**; a
     * non-zero value is a deliberate decision somebody made, and the reason is
     * in the log next to it.
     */
    unattributed: number
    /**
     * `createMany`, which returns no ids to point an audit row at.
     * **Should be zero** — use `createManyAndReturn` where the trail matters.
     */
    unfollowableOperation: number
    /**
     * A write whose caller narrowed the response, where re-reading the full row
     * to audit it came back empty — row-level security refused it, or the row
     * left in the same transaction. The audit row is still written from what
     * was returned; it is just thinner than it should be. **Should be zero.**
     */
    rereadBlocked: number
  }
}

const health: AuditHealth = {
  written: 0,
  failures: 0,
  lastFailure: null,
  gaps: {
    noContext: 0,
    unattributed: 0,
    unfollowableOperation: 0,
    rereadBlocked: 0,
  },
}

export type AuditGapKind =
  | 'noContext'
  | 'unattributed'
  | 'unfollowableOperation'
  | 'rereadBlocked'

export type AuditEvent =
  | { type: 'failure'; failure: AuditFailure }
  | {
      type: 'gap'
      kind: AuditGapKind
      model: string
      operation: string
      /** Why, when the caller declared it. */
      reason?: string
    }

type AuditEventHandler = (event: AuditEvent) => void

const handlers = new Set<AuditEventHandler>()

/** Subscribe a sink — alerting, metrics, a test. Returns an unsubscribe. */
export function onAuditEvent(handler: AuditEventHandler): () => void {
  handlers.add(handler)
  return () => handlers.delete(handler)
}

export function getAuditHealth(): AuditHealth {
  return {
    ...health,
    lastFailure: health.lastFailure ? { ...health.lastFailure } : null,
    gaps: { ...health.gaps },
  }
}

/** For tests. Production has no reason to forget how often audit has failed. */
export function resetAuditHealth(): void {
  health.written = 0
  health.failures = 0
  health.lastFailure = null
  health.gaps.noContext = 0
  health.gaps.unattributed = 0
  health.gaps.unfollowableOperation = 0
  health.gaps.rereadBlocked = 0
}

function emit(event: AuditEvent): void {
  for (const handler of handlers) {
    try {
      handler(event)
    } catch {
      // A broken sink must not become a broken write.
    }
  }
}

function recordFailure(
  model: string,
  operation: string,
  entityIds: string[],
  error: unknown,
): void {
  const failure: AuditFailure = {
    at: new Date(),
    model,
    operation,
    entityIds,
    message: error instanceof Error ? error.message : String(error),
  }
  health.failures += 1
  health.lastFailure = failure

  // Fixed tag, structured payload. Workers observability captures console, and
  // this is the line an alert is built on.
  console.error(
    '[zebra.audit.failure]',
    JSON.stringify({
      model,
      operation,
      entityIds,
      message: failure.message,
      totalFailures: health.failures,
    }),
  )

  emit({ type: 'failure', failure })
}

function recordGap(
  kind: AuditGapKind,
  model: string,
  operation: string,
  reason?: string,
): void {
  health.gaps[kind] += 1
  console.warn(
    '[zebra.audit.gap]',
    JSON.stringify({ kind, model, operation, ...(reason ? { reason } : {}) }),
  )
  emit({ type: 'gap', kind, model, operation, ...(reason ? { reason } : {}) })
}

// --- diffing ----------------------------------------------------------------

type Row = Record<string, unknown>

/** JSON-safe, and comparable. Prisma hands back Dates and Decimals. */
function normalize(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'bigint') return value.toString()
  if (Prisma.Decimal.isDecimal(value)) return value.toString()
  if (Array.isArray(value)) return value.map(normalize)
  if (value instanceof Uint8Array) return `<${value.byteLength} bytes>`
  return value
}

export interface FieldChange {
  from: unknown
  to: unknown
}

/**
 * `{ field: { from, to } }` for changed fields only.
 *
 * One row per write, not one per field — so this object is the whole story of
 * a single write, and an unchanged field is simply absent.
 */
export function diffRows(
  before: Row | null,
  after: Row | null,
): Record<string, FieldChange> {
  const changes: Record<string, FieldChange> = {}
  const keys = new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ])

  for (const key of keys) {
    if (IGNORED_FIELDS.has(key)) continue

    const from = normalize(before?.[key] ?? null)
    const to = normalize(after?.[key] ?? null)
    if (JSON.stringify(from) === JSON.stringify(to)) continue

    changes[key] = { from, to }
  }

  return changes
}

/**
 * Soft delete and restore are updates with a particular shape. §6 makes
 * `deletedAt` the mechanism, and §8 wants RESTORE as its own action, so the
 * shape is read here rather than asked of every caller.
 */
function actionFor(
  changes: Record<string, FieldChange>,
  fallback: AuditAction,
): AuditAction {
  const deletedAt = changes['deletedAt']
  if (deletedAt) {
    if (deletedAt.from === null && deletedAt.to !== null) return 'DELETE'
    if (deletedAt.from !== null && deletedAt.to === null) return 'RESTORE'
  }
  return fallback
}

// --- the extension ----------------------------------------------------------

interface PendingEntry {
  action: AuditAction
  entityId: string
  companyId: string | null
  changes: Record<string, FieldChange>
}

function idOf(row: Row | null | undefined): string | null {
  const id = row?.['id']
  return typeof id === 'string' ? id : null
}

function companyOf(row: Row | null | undefined): string | null {
  const companyId = row?.['companyId']
  return typeof companyId === 'string' ? companyId : null
}

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

let savepointCounter = 0

/**
 * Queue audit rows. Nothing reaches Postgres here.
 *
 * The insert happens once, in `flushAuditBuffer`, immediately before the
 * caller's transaction commits. See `AuditScope.buffer` for why.
 */
function bufferEntries(
  scope: AuditScope,
  model: string,
  operation: string,
  entries: PendingEntry[],
): void {
  if (entries.length === 0) return
  if (isUnattributed(scope.attribution)) return

  for (const entry of entries) {
    scope.buffer.push({ ...entry, model, operation })
  }
}

/**
 * Write every buffered row, once, behind one savepoint, before commit.
 *
 * Called by `runInOrg` after the caller's work returns and while the
 * transaction is still open — which is the whole point. Outside it, the rows
 * would survive a rollback and claim writes that never happened.
 */
export async function flushAuditBuffer(scope: AuditScope): Promise<void> {
  const entries = scope.buffer.splice(0)
  if (entries.length === 0) return

  // The failure report names what was actually in the buffer rather than a
  // placeholder. One transaction usually touches one model, so the common
  // case reads exactly as it did before buffering — `Load` / `update`, not
  // `<buffered>` / `flush`. A mixed transaction lists what it held, which is
  // still what an investigation needs.
  await writeEntries(
    scope,
    distinct(entries.map((entry) => entry.model)),
    distinct(entries.map((entry) => entry.operation)),
    entries,
  )
}

function distinct(values: string[]): string {
  return [...new Set(values)].sort().join(',')
}

async function writeEntries(
  scope: AuditScope,
  model: string,
  operation: string,
  entries: BufferedEntry[],
): Promise<void> {
  if (entries.length === 0) return

  const { tx, attribution } = scope
  if (isUnattributed(attribution)) return

  // Unique per write, and an identifier, so it cannot carry anything from
  // outside. Not that it could — nothing here is caller-controlled.
  const savepoint = `zebra_audit_${(savepointCounter += 1)}`

  try {
    await tx.$executeRawUnsafe(`SAVEPOINT ${savepoint}`)
  } catch (error) {
    // No savepoint means no safe way to try: an insert that failed would take
    // the caller's transaction down with it.
    recordFailure(
      model,
      operation,
      entries.map((entry) => entry.entityId),
      error,
    )
    return
  }

  try {
    await tx.auditLog.createMany({
      data: entries.map((entry) => ({
        organizationId: scope.organizationId,
        companyId: entry.companyId,
        userId: attribution.userId,
        action: entry.action,
        // The entry's own model, not the caller's label — one flush carries
        // rows for Load, LoadStop and LoadStatusEvent alike, and each row has
        // to say which table it is about.
        entityType: entry.model,
        entityId: entry.entityId,
        changes: entry.changes,
        ip: attribution.ip ?? null,
        userAgent: attribution.userAgent ?? null,
      })),
    })
    await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${savepoint}`)
    health.written += entries.length
  } catch (error) {
    // Undo only the audit. The caller's transaction is untouched and their
    // write still commits — which is §8's rule, and the reason the savepoint
    // is here rather than a bare try/catch.
    await tx
      .$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${savepoint}`)
      .catch(() => {})
    recordFailure(
      model,
      operation,
      entries.map((entry) => entry.entityId),
      error,
    )
  }
}

/** Everything the delegate calls we make need, without importing the client. */
interface ModelDelegate {
  findMany(args: { where?: unknown }): Promise<Row[]>
  findUnique(args: { where: { id: string } }): Promise<Row | null>
}

function delegateFor(tx: AuditCapableTx, model: string): ModelDelegate | null {
  const key = model.charAt(0).toLowerCase() + model.slice(1)
  const delegate = tx[key]
  if (
    typeof delegate === 'object' &&
    delegate !== null &&
    'findMany' in delegate
  ) {
    return delegate as unknown as ModelDelegate
  }
  return null
}

export const auditExtension = Prisma.defineExtension({
  name: 'zebra-audit',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!WRITE_OPERATIONS.has(operation) || UNAUDITED_MODELS.has(model)) {
          return query(args)
        }

        const scope = auditScope.getStore()

        if (!scope) {
          // No tenant transaction at all — the seed, or the login path
          // touching User before any organization is known. Not preventable by
          // types, because these writes never reach runInOrg. Counted rather
          // than ignored, and kept apart from failures so it cannot drown one.
          const result = await query(args)
          recordGap('noContext', model, operation)
          return result
        }

        if (isUnattributed(scope.attribution)) {
          // Somebody wrote the word and gave a reason. Recorded with it.
          const result = await query(args)
          recordGap('unattributed', model, operation, scope.attribution.reason)
          return result
        }

        const { tx } = scope
        const delegate = delegateFor(tx, model)
        const where = (args as { where?: unknown }).where

        // A caller that narrowed its response narrowed what the write RETURNS,
        // not what happened. Auditing the returned shape produced thin rows —
        // a create with `select: { id: true }` logged two fields and lost
        // companyId entirely, which is how an audit trail becomes decorative.
        //
        // So: narrow the response, never the audit's source. Where the caller
        // narrowed, re-read the full row in the SAME transaction and audit
        // that. Same transaction matters twice over — the row is visible
        // because the write is already in it, and the read is subject to the
        // same tenant policy as everything else.
        const narrowed =
          (args as { select?: unknown }).select !== undefined ||
          (args as { omit?: unknown }).omit !== undefined

        const fullRow = async (row: Row | null): Promise<Row | null> => {
          if (!narrowed || !delegate) return row
          const id = idOf(row)
          if (!id) return row
          const reread = await delegate
            .findUnique({ where: { id } })
            .catch(() => null)
          if (!reread) {
            // Refused by row-level security, or gone by the time we looked.
            // Counted, never thrown: a thin audit row still beats failing the
            // caller's write, and §8 forbids audit taking the write down.
            recordGap('rereadBlocked', model, operation)
            return row
          }
          return reread
        }

        // --- before ---------------------------------------------------------
        let before: Row[] = []
        const needsBefore =
          operation === 'update' ||
          operation === 'updateMany' ||
          operation === 'updateManyAndReturn' ||
          operation === 'upsert' ||
          operation === 'delete' ||
          operation === 'deleteMany'

        if (needsBefore && delegate && where !== undefined) {
          before = await delegate.findMany({ where }).catch(() => [])
        }

        const result = await query(args)

        // --- after ----------------------------------------------------------
        const entries: PendingEntry[] = []

        switch (operation) {
          case 'create':
          case 'createManyAndReturn': {
            const rows = Array.isArray(result)
              ? result.filter(isRow)
              : isRow(result)
                ? [result]
                : []
            for (const returned of rows) {
              const id = idOf(returned)
              if (!id) continue
              const row = (await fullRow(returned)) ?? returned
              entries.push({
                action: 'CREATE',
                entityId: id,
                companyId: companyOf(row),
                changes: diffRows(null, row),
              })
            }
            break
          }

          case 'createMany': {
            // createMany returns a count and no ids, so there is nothing to
            // point an audit row at. Recorded as a gap rather than guessed —
            // use createManyAndReturn where the trail matters.
            recordGap('unfollowableOperation', model, operation)
            break
          }

          case 'update':
          case 'upsert': {
            const returned = isRow(result) ? result : null
            const prior = before[0] ?? null
            const id = idOf(returned) ?? idOf(prior)
            if (!id) break

            // `prior` was already read whole. Widen the after-state to match,
            // or the diff reports every unselected field as having vanished.
            const after = await fullRow(returned)

            const changes = diffRows(prior, after)
            const action: AuditAction = prior
              ? actionFor(changes, 'UPDATE')
              : 'CREATE'
            if (Object.keys(changes).length === 0 && action === 'UPDATE') break

            entries.push({
              action,
              entityId: id,
              companyId: companyOf(after) ?? companyOf(prior),
              changes,
            })
            break
          }

          case 'updateMany':
          case 'updateManyAndReturn': {
            if (before.length === 0) break
            const ids = before
              .map(idOf)
              .filter((id): id is string => id !== null)
            const after = delegate
              ? await delegate
                  .findMany({ where: { id: { in: ids } } })
                  .catch(() => [])
              : []
            const afterById = new Map(after.map((row) => [idOf(row), row]))

            for (const prior of before) {
              const id = idOf(prior)
              if (!id) continue
              const updated = afterById.get(id) ?? null
              const changes = diffRows(prior, updated)
              if (Object.keys(changes).length === 0) continue
              entries.push({
                action: actionFor(changes, 'UPDATE'),
                entityId: id,
                companyId: companyOf(updated) ?? companyOf(prior),
                changes,
              })
            }
            break
          }

          case 'delete':
          case 'deleteMany': {
            for (const prior of before) {
              const id = idOf(prior)
              if (!id) continue
              entries.push({
                action: 'DELETE',
                entityId: id,
                companyId: companyOf(prior),
                changes: diffRows(prior, null),
              })
            }
            break
          }
        }

        // Queued, not written. `runInOrg` flushes the whole buffer in one
        // insert before the transaction commits — see `AuditScope.buffer`.
        bufferEntries(scope, model, operation, entries)
        return result
      },
    },
  },
})
