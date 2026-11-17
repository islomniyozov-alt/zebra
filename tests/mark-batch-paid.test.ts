import { describe, expect, it } from 'vitest'
import { markBatchPaid } from '@/lib/settlement-batch'

// A VOIDED STATEMENT IS NEVER PAID (owner's ruling 2026-11-17). `markBatchPaid`
// matched every statement on the batch, so a FINAL batch holding one voided and
// one posted statement came out with TWO paid. The fake below applies the
// function's own `where` to the rows, so the test reads what the filter does,
// not what the source says.

interface Row {
  id: string
  batchId: string
  organizationId: string
  settlementNumber: string
  status: string
  paidAt: Date | null
}

type Where = Record<string, unknown>

/** Equality, and Prisma's `{ not: x }` — the two shapes this function uses. */
const matches = (row: Row, where: Where) =>
  Object.entries(where).every(([key, wanted]) => {
    const value = (row as unknown as Record<string, unknown>)[key]
    if (wanted !== null && typeof wanted === 'object' && 'not' in wanted) {
      return value !== (wanted as { not: unknown }).not
    }
    return value === wanted
  })

function fakeTx(rows: Row[]) {
  return {
    settlementBatch: {
      findFirst: async () => ({ id: 'b1', status: 'FINAL' }),
      update: async () => ({}),
    },
    settlement: {
      findMany: async ({ where }: { where: Where }) =>
        rows.filter((row) => matches(row, where)),
      updateMany: async ({
        where,
        data,
      }: {
        where: Where
        data: Partial<Row>
      }) => {
        const hit = rows.filter((row) => matches(row, where))
        for (const row of hit) Object.assign(row, data)
        return { count: hit.length }
      },
    },
  }
}

describe('markBatchPaid skips voided statements', () => {
  it('a batch with one voided and one posted marks exactly one paid', async () => {
    const rows: Row[] = [
      {
        id: 'void',
        batchId: 'b1',
        organizationId: 'o1',
        settlementNumber: 'ST-000901',
        status: 'VOID',
        paidAt: null,
      },
      {
        id: 'posted',
        batchId: 'b1',
        organizationId: 'o1',
        settlementNumber: 'ST-000902',
        status: 'APPROVED',
        paidAt: null,
      },
    ]
    const tx = fakeTx(rows)

    const result = await markBatchPaid(tx as never, 'b1', 'u1')

    expect(result).toEqual({ ok: true })
    expect(
      rows.filter((row) => row.status === 'PAID').map((row) => row.id),
    ).toEqual(['posted'])
    expect(rows.find((row) => row.id === 'void')).toMatchObject({
      status: 'VOID',
      paidAt: null,
    })
  })
})
