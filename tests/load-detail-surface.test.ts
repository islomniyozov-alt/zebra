import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadDetailView } from '@/lib/load-detail-view'
import { REFERENCE_ERROR_KEYS } from '@/lib/reference'

// ---------------------------------------------------------------------------
// §7.12 — THE LOAD DETAIL ON DIRECT-SETTLED FREIGHT (queue item 20 (5)).
// The view decides, the page renders, the writer refuses — held to the doc.
// ---------------------------------------------------------------------------

const page = readFileSync(
  join('src', 'app', '(app)', 'loads', '[id]', 'page.tsx'),
  'utf8',
)
const panel = readFileSync(
  join('src', 'app', '(app)', 'loads', '[id]', 'RatePanel.tsx'),
  'utf8',
)
const paymentPanel = readFileSync(
  join('src', 'app', '(app)', 'loads', '[id]', 'PaymentTypePanel.tsx'),
  'utf8',
)
const loads = readFileSync(join('src', 'lib', 'loads.ts'), 'utf8')
const doc = readFileSync('TMS-DESIGN-SYSTEM.md', 'utf8')

describe('the accessorial summary', () => {
  it("has two named figures, by the stored total's own rule", () => {
    // Billed = billable and not denied (recomputeTotals' rule); the other
    // figure is the approved lines that are not billable — the import's
    // "Other" rows, which were on the load and in no figure.
    expect(panel).toContain(
      "accessorials.filter((row) => row.status !== 'DENIED')",
    )
    expect(panel).toMatch(/live\s*\.filter\(\(row\) => row\.isBillable\)/)
    expect(panel).toMatch(/live\s*\.filter\(\(row\) => !row\.isBillable\)/)
    expect(panel).toContain('{labels.otherNotBilled}')
    // The page feeds the status the rule needs.
    expect(page).toContain('status: row.status,')
    expect(page).toContain("otherNotBilled: t('rate.otherNotBilled')")
    expect(loads).toContain("status: { not: 'DENIED' }")
  })
})

describe('the payment type', () => {
  it('is a fact on direct-settled freight and a choice on the rest', () => {
    expect(loadDetailView({ directSettled: true }).paymentTypeDerived).toBe(
      true,
    )
    expect(loadDetailView({ directSettled: false }).paymentTypeDerived).toBe(
      false,
    )
    expect(page).toContain('derived={view.paymentTypeDerived}')
    expect(paymentPanel).toContain('if (derived) {')
  })

  it('is stamped Direct at booking and refused otherwise by the writer', () => {
    expect(loads).toMatch(/paymentType: settlesDirectly\s*\? 'Direct'/)
    expect(loads).toContain("throw new ReferenceError('payment_type_direct'")
    expect(REFERENCE_ERROR_KEYS.payment_type_direct).toBe(
      'ref.error.paymentTypeDirect',
    )
  })
})

describe('the tracker', () => {
  it("says 'On statement' where there will never be an invoice", () => {
    expect(loadDetailView({ directSettled: true }).settledWord).toBe(
      'onStatement',
    )
    expect(loadDetailView({ directSettled: false }).settledWord).toBe(
      'invoiced',
    )
    expect(page).toContain("view.settledWord === 'onStatement'")
    expect(page).toContain("'loads.stageOnStatement'")
  })

  it('is specified before the code', () => {
    expect(doc).toContain('### 7.12 The load detail on direct-settled freight')
  })
})
