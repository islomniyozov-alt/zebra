import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { searchedQuery } from '@/components/ui/SearchBox'
import {
  batchShape,
  invoiceAgeCounts,
  paymentStateRows,
  type BatchGridRow,
  type InvoiceGridRow,
} from '@/lib/accounting-grids'
import type { PaymentRow } from '@/lib/payments'

// ---------------------------------------------------------------------------
// ONE SEARCH BOX (TMS §7.4 v11.52 — owner's ruling 2026-11-23, Uktam item 2).
// The five lists Uktam uses render the same `SearchBox`, and every count on
// the page is taken over the rows the search left. The database side of All
// Loads' search (names) is in tests/integration/load-list.test.ts.
// ---------------------------------------------------------------------------

const source = (path: string) => readFileSync(path, 'utf8')

describe('the box', () => {
  it('writes the trimmed term and sends the reader back to page 1', () => {
    const next = searchedQuery(
      new URLSearchParams('page=4&tab=x'),
      'q',
      '  SB-000474 ',
    )
    expect(next.get('q')).toBe('SB-000474')
    expect(next.get('page')).toBeNull()
    expect(next.get('tab')).toBe('x')
  })

  it('an empty term removes the search rather than searching for nothing', () => {
    const next = searchedQuery(new URLSearchParams('q=old&page=2'), 'q', '   ')
    expect(next.has('q')).toBe(false)
    expect(next.has('page')).toBe(false)
  })

  it('is the one control on all five lists', () => {
    // The filter bar renders it for the four accounting lists…
    expect(source('src/components/ui/FilterBar.tsx')).toContain('<SearchBox')
    for (const page of [
      'src/app/(app)/accounting/invoices/page.tsx',
      'src/app/(app)/accounting/payments/page.tsx',
      'src/app/(app)/payroll/batches/page.tsx',
      'src/app/(app)/payroll/statements/page.tsx',
    ]) {
      expect(source(page), page).toMatch(/search=\{\{\s*param: 'q'/)
    }
    // …and All Loads renders it directly, on its `?ref=`.
    const loads = source('src/app/(app)/loads/page.tsx')
    expect(loads).toContain('<SearchBox')
    expect(loads).not.toContain('ReferenceSearch')
  })
})

const invoice = (
  id: string,
  over: Partial<InvoiceGridRow> = {},
): InvoiceGridRow => ({
  id,
  invoiceNumber: id,
  customerName: 'Werner',
  companyId: 'c-ram',
  companyName: 'RAM Haulage',
  issued: new Date('2026-11-01T12:00:00Z'),
  due: new Date('2026-12-01T12:00:00Z'),
  totalCents: 100_00,
  balanceCents: 100_00,
  status: 'SENT',
  isFactored: false,
  bucket: 'current',
  isOverdue: false,
  ...over,
})

describe('the counts respect the search', () => {
  it('the invoice age chips count what the search left', () => {
    const rows = [
      invoice('INV-1'),
      invoice('INV-2', { customerName: 'Amazon' }),
      invoice('INV-3', { customerName: 'Amazon', bucket: 'd31_60' }),
    ]
    expect(invoiceAgeCounts(rows, {})).toMatchObject({
      current: 2,
      d31_60: 1,
    })
    expect(invoiceAgeCounts(rows, { q: 'amazon' })).toMatchObject({
      current: 1,
      d31_60: 1,
    })
    expect(invoiceAgeCounts(rows, { q: 'werner' })).toMatchObject({
      current: 1,
      d31_60: 0,
    })
  })

  it('the Payments Applied chip counts what the search left', () => {
    const payment = (
      id: string,
      customerName: string,
      unappliedCents: number,
    ): PaymentRow => ({
      id,
      method: 'ACH',
      referenceNumber: id,
      receivedAt: new Date('2026-11-14T15:00:00Z'),
      amountCents: 100_00,
      unappliedCents,
      customerName,
      companyId: 'c-ram',
      companyName: 'RAM Haulage',
      appliedToCount: unappliedCents > 0 ? 0 : 1,
    })
    const rows = [
      payment('ach-1', 'Amazon', 0),
      payment('ach-2', 'Werner', 0),
      payment('ach-3', 'Amazon', 50_00),
    ]
    expect(paymentStateRows(rows, 'applied', {})).toHaveLength(2)
    expect(paymentStateRows(rows, 'applied', { q: 'werner' })).toHaveLength(1)
  })

  it('a batch is found by who created it', () => {
    const row = {
      batchNumber: 'SB-000474',
      status: 'UNPOSTED',
      payCompanyName: 'Dolphins Transport',
      notes: null,
      createdBy: 'Uktam Badalov',
    } as unknown as BatchGridRow
    expect(batchShape.searchText(row).toLowerCase()).toContain('uktam')
  })
})
