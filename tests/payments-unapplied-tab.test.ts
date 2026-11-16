import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  isUnapplied,
  paymentShape,
  paymentsInState,
  unappliedTabRows,
} from '@/lib/accounting-grids'
import { applyList, readListParams } from '@/lib/list-view'
import type { PaymentRow } from '@/lib/payments'

// ---------------------------------------------------------------------------
// THE UNAPPLIED TAB COUNTS ITS LIST (owner's report 2026-11-16). Production's
// /payments read "Unapplied 5" on the tab over "No payments match these
// filters" under Last 7 days: the count was the strip's all-dates balance,
// the list applied the picker's window. One predicate for both now —
// `unappliedTabRows` — and these hold the count to the list the tab shows.
// ---------------------------------------------------------------------------

const row = (
  id: string,
  receivedAt: string,
  unappliedCents: number,
  companyId = 'c-ram',
): PaymentRow => ({
  id,
  method: 'ACH',
  referenceNumber: id,
  receivedAt: new Date(receivedAt),
  amountCents: 100_00,
  unappliedCents,
  customerName: 'Amazon',
  companyId,
  companyName: companyId,
  appliedToCount: unappliedCents > 0 ? 0 : 1,
})

// Five unapplied, all older than the window — the report's shape — beside
// one unapplied inside it, one applied inside it, and one inside it for
// another authority.
const ROWS = [
  row('old-1', '2026-10-01T15:00:00Z', 50_00),
  row('old-2', '2026-10-02T15:00:00Z', 50_00),
  row('old-3', '2026-10-03T15:00:00Z', 50_00),
  row('old-4', '2026-10-04T15:00:00Z', 50_00),
  row('old-5', '2026-10-05T15:00:00Z', 50_00),
  row('in-unapplied', '2026-11-14T15:00:00Z', 20_00),
  row('in-applied', '2026-11-14T16:00:00Z', 0),
  row('in-other', '2026-11-15T15:00:00Z', 30_00, 'c-dolphin'),
]
const LAST_7 = { from: '2026-11-10', to: '2026-11-16' }

/** What the unapplied tab's list renders under `raw` — the page's pipeline. */
const listOnTab = (raw: Record<string, string>) =>
  applyList(
    paymentsInState(ROWS, 'unapplied'),
    readListParams(raw),
    paymentShape,
    raw,
  )

describe('the unapplied tab', () => {
  it('counts what its list shows under the window, not the all-dates balance', () => {
    const count = unappliedTabRows(ROWS, LAST_7).length
    expect(count).toBe(2)
    expect(count).toBe(listOnTab(LAST_7).length)
    // The all-dates balance the tab used to show.
    expect(ROWS.filter(isUnapplied).length).toBe(7)
  })

  it('and under the authority and the search, the same', () => {
    for (const raw of [
      { ...LAST_7, company: 'c-ram' },
      { ...LAST_7, q: 'in-other' },
      {},
    ]) {
      expect(unappliedTabRows(ROWS, raw).map((r) => r.id)).toEqual(
        listOnTab(raw).map((r) => r.id),
      )
    }
    expect(
      unappliedTabRows(ROWS, { ...LAST_7, company: 'c-ram' }),
    ).toHaveLength(1)
  })

  it('an empty list under the window counts zero — the report, fixed', () => {
    expect(
      unappliedTabRows(ROWS, { from: '2026-11-16', to: '2026-11-16' }),
    ).toHaveLength(0)
  })

  it('the states keep what they always kept', () => {
    expect(paymentsInState(ROWS, 'unapplied').map((r) => r.id)).not.toContain(
      'in-applied',
    )
    expect(paymentsInState(ROWS, 'applied').map((r) => r.id)).toEqual([
      'in-applied',
    ])
    expect(paymentsInState(ROWS, null)).toHaveLength(ROWS.length)
  })
})

describe('the page', () => {
  const page = readFileSync(
    'src/app/(app)/accounting/payments/page.tsx',
    'utf8',
  )

  it('takes the tab count from the tab’s rows, and narrows by the same predicate', () => {
    expect(page).toMatch(/const unappliedCount = unappliedTabRows\(/)
    // Under the window the list applies — the whole of the report.
    expect(page).toContain('windowed(tabParams, window)')
    expect(page).not.toContain(
      'const unappliedCount = data.strip.unappliedCount',
    )
    expect(page).toContain('paymentsInState(data.payments, state)')
  })
})
