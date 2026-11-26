import { describe, expect, it } from 'vitest'
import {
  auditScope,
  flushAuditBuffer,
  recordAuditEvent,
  type AuditScope,
} from '@/lib/audit'

// ---------------------------------------------------------------------------
// ONE SAVE, ONE INSTANT (TMS §7.14 part 7, v11.60).
//
// Undo takes back "the rows one transaction wrote", and finds them on
// `(userId, createdAt)`. That is exact only if every row of one flush carries
// the same `createdAt`, set by the flush rather than by each row's default —
// which this pins against the flush itself, with a stand-in transaction.
// ---------------------------------------------------------------------------

function fakeScope() {
  const inserted: Record<string, unknown>[][] = []
  const tx = {
    $executeRawUnsafe: async () => 0,
    auditLog: {
      createMany: async ({ data }: { data: unknown[] }) => {
        inserted.push(data as Record<string, unknown>[])
        return { count: data.length }
      },
    },
  }
  const scope: AuditScope = {
    tx,
    organizationId: 'org1',
    attribution: { userId: 'u1' },
    buffer: [],
  }
  return { scope, inserted }
}

describe('a flush stamps every row with one instant', () => {
  it('three rows from one save share createdAt exactly', async () => {
    const { scope, inserted } = fakeScope()
    for (const id of ['a', 'b', 'c']) {
      scope.buffer.push({
        model: 'Load',
        operation: 'update',
        action: 'UPDATE',
        entityId: id,
        companyId: null,
        changes: { poNumber: { from: null, to: id } },
      })
      // Time passes between writes inside one transaction.
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    await flushAuditBuffer(scope)

    const rows = inserted[0]!
    expect(rows).toHaveLength(3)
    const stamps = new Set(rows.map((row) => (row.createdAt as Date).getTime()))
    expect(stamps.size).toBe(1)
    expect(rows[0]!.createdAt).toBeInstanceOf(Date)
  })

  it('an event recorded in the save rides the same flush', async () => {
    const { scope, inserted } = fakeScope()
    scope.buffer.push({
      model: 'Load',
      operation: 'update',
      action: 'UPDATE',
      entityId: 'load1',
      companyId: 'c1',
      changes: { poNumber: { from: 'P', to: null } },
    })
    auditScope.run(scope, () =>
      recordAuditEvent({
        entityType: 'LoadUndo',
        entityId: 'load1',
        companyId: 'c1',
        changes: { undo: { from: 'then', to: 'edit' } },
      }),
    )
    await flushAuditBuffer(scope)
    const rows = inserted[0]!
    expect(rows.map((row) => row.entityType)).toEqual(['Load', 'LoadUndo'])
    expect(rows[0]!.createdAt).toBe(rows[1]!.createdAt)
    expect(rows[1]).toMatchObject({ userId: 'u1', action: 'UPDATE' })
  })

  it('and refuses an event outside a tenant transaction', () => {
    expect(() =>
      recordAuditEvent({
        entityType: 'LoadUndo',
        entityId: 'load1',
        companyId: null,
        changes: {},
      }),
    ).toThrow(/outside a tenant transaction/)
  })
})
