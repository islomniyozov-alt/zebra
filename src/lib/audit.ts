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
// registered sink. `getAuditHealth().failures` is expected to be zero forever,
// which makes it worth alerting on. Gaps — writes that happened outside any
// audit context, or through an operation this extension cannot follow — are
// counted separately so that a genuine failure is never lost in their noise.
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

export interface AuditContext {
  userId: string | null
  organizationId: string
  ip?: string | null
  userAgent?: string | null
}

/** The delegate surface the extension needs from a transaction client. */
export interface AuditCapableTx {
  $executeRawUnsafe(query: string): Promise<number>
  auditLog: {
    createMany(args: { data: unknown[] }): Promise<{ count: number }>
  }
  [model: string]: unknown
}

interface AuditScope {
  tx: AuditCapableTx
  audit: AuditContext | null
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
  /** Audit rows that could not be written. Expected to stay at zero. */
  failures: number
  lastFailure: AuditFailure | null
  gaps: {
    /** Audited writes that ran outside any audit context. */
    noContext: number
    /** Writes through an operation the extension cannot follow to a row. */
    unfollowableOperation: number
  }
}

const health: AuditHealth = {
  written: 0,
  failures: 0,
  lastFailure: null,
  gaps: { noContext: 0, unfollowableOperation: 0 },
}

export type AuditEvent =
  | { type: 'failure'; failure: AuditFailure }
  | {
      type: 'gap'
      kind: 'noContext' | 'unfollowableOperation'
      model: string
      operation: string
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
  health.gaps.unfollowableOperation = 0
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
  kind: 'noContext' | 'unfollowableOperation',
  model: string,
  operation: string,
): void {
  health.gaps[kind] += 1
  console.warn('[zebra.audit.gap]', JSON.stringify({ kind, model, operation }))
  emit({ type: 'gap', kind, model, operation })
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

async function writeEntries(
  scope: AuditScope,
  model: string,
  operation: string,
  entries: PendingEntry[],
): Promise<void> {
  if (entries.length === 0) return

  const { tx, audit } = scope
  if (!audit) return

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
        organizationId: audit.organizationId,
        companyId: entry.companyId,
        userId: audit.userId,
        action: entry.action,
        entityType: model,
        entityId: entry.entityId,
        changes: entry.changes,
        ip: audit.ip ?? null,
        userAgent: audit.userAgent ?? null,
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
        if (!scope?.audit) {
          // Writes outside a tenant context — the login path touching User, a
          // migration script, a seed. Counted rather than ignored, but kept
          // apart from failures so it cannot drown one.
          const result = await query(args)
          recordGap('noContext', model, operation)
          return result
        }

        const { tx } = scope
        const delegate = delegateFor(tx, model)
        const where = (args as { where?: unknown }).where

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
            for (const row of rows) {
              const id = idOf(row)
              if (!id) continue
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
            const after = isRow(result) ? result : null
            const prior = before[0] ?? null
            const id = idOf(after) ?? idOf(prior)
            if (!id) break

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

        await writeEntries(scope, model, operation, entries)
        return result
      },
    },
  },
})
