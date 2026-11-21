import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { invoiceBlock } from '@/lib/invoices'
import { loadDetailView } from '@/lib/load-detail-view'

// ---------------------------------------------------------------------------
// THE BROKER LOAD DETAIL, STEP 1 (TMS §7.14 item 1; BROKER-LOAD-BRIEF.md).
//
// Every load now takes §7.13's shape. Broker freight — neither Amazon nor
// direct-settled — adds Create invoice in the header, enabled exactly when
// the /invoices readiness query admits the load and otherwise disabled with
// its reason, and keeps the stop time-zone editor the older layout carried.
// Amazon freight gets neither.
// ---------------------------------------------------------------------------

const page = readFileSync('src/app/(app)/loads/[id]/page.tsx', 'utf8')

describe('which loads are broker freight', () => {
  it('is every load that is neither Amazon nor direct-settled', () => {
    expect(
      loadDetailView({ directSettled: false, customer: { name: 'Werner' } })
        .brokerShape,
    ).toBe(true)
    expect(
      loadDetailView({
        directSettled: true,
        customer: { name: 'Amazon Relay' },
      }).brokerShape,
    ).toBe(false)
    expect(
      loadDetailView({
        directSettled: false,
        customer: { name: 'Amazon Relay' },
      }).brokerShape,
    ).toBe(false)
  })
})

describe('Create invoice', () => {
  it('is offered on broker freight only, to a role that may create invoices', () => {
    expect(page).toMatch(
      /const mayInvoice =\s*view\.brokerShape && \(await currentUserCan\('create', 'invoice'\)\)/,
    )
    expect(page).toContain('invoiceReadiness(tx, id)')
  })

  it('submits only when ready, and says why when not', () => {
    expect(page).toMatch(
      /invoiceState\.ready \? \(\s*<form action=\{createLoadInvoiceAction\.bind\(null, id\)\}>/,
    )
    expect(page).toContain('loads.invoiceBlock.${invoiceState.reason}')
  })

  it('names the gap in the order the office would fix it', () => {
    const base = {
      isCancelled: false,
      directSettled: false,
      operationalStatus: 'POD_RECEIVED',
      totalRevenueCents: 40_248,
      invoiceLineCount: 0,
    }
    expect(invoiceBlock({ ...base, isCancelled: true })).toBe('cancelled')
    expect(invoiceBlock({ ...base, invoiceLineCount: 1 })).toBe('invoiced')
    expect(invoiceBlock({ ...base, directSettled: true })).toBe('direct')
    expect(invoiceBlock({ ...base, operationalStatus: 'DELIVERED' })).toBe(
      'no_pod',
    )
    expect(invoiceBlock({ ...base, totalRevenueCents: 0 })).toBe('no_rate')
    // Everything the pure check can see is fine, and the query still said
    // no (closed history, a deleted load): said as such, never as ready.
    expect(invoiceBlock(base)).toBe('not_ready')
  })
})

describe('the stop time-zone editor', () => {
  it('stays on broker freight for a role that may update the load', () => {
    expect(page).toContain(
      'view.brokerShape && view.showStopTimezone && mayUpdate ? (',
    )
    expect(page).toContain('action={setStopZoneAction.bind(')
  })
})

describe('the rate-con hold on the dispatch board (step 2)', () => {
  const action = readFileSync('src/app/(app)/dispatch/actions.ts', 'utf8')

  it('is asked on every assignment, and an acknowledgement needs words', () => {
    expect(action).toContain('rateConMissingForDispatch(tx, loadId)')
    expect(action).toMatch(
      /if \(rateConMissing && acknowledged && overrideReason === ''\) \{/,
    )
    expect(action).toMatch(
      /if \(\(warnings\.length > 0 \|\| rateConMissing\) && !acknowledged\) \{/,
    )
  })

  it('writes what was dispatched over onto the assignment row', () => {
    expect(action).toContain(
      'rateConOverride: rateConMissing ? overrideReason : null',
    )
    expect(action).toContain('...(reason !== null ? { reason } : {}),')
  })
})

describe('assignmentReason', () => {
  it('names each override, the dispatcher’s words kept', async () => {
    const { assignmentReason } = await import('@/lib/dispatch')
    expect(
      assignmentReason({ compliance: null, rateConOverride: null }),
    ).toBeNull()
    expect(
      assignmentReason({
        compliance: 'truck 212 REGISTRATION expired 2026-11-01',
        rateConOverride: 'broker emailing it tonight',
      }),
    ).toBe(
      'dispatched over: truck 212 REGISTRATION expired 2026-11-01; rate con missing — broker emailing it tonight',
    )
  })
})

describe('the five document tiles (step 2)', () => {
  it('are Datatruck’s five, in its order, on broker freight', () => {
    const slots = page.slice(page.indexOf('const slots: DocumentSlot[]'))
    const broker = slots.slice(0, slots.indexOf(': ['))
    expect(broker).toContain('view.brokerShape')
    const order = [
      "slotFor('RATE_CONFIRMATION'",
      "slotFor('BOL'",
      "slotFor('POD'",
      "slotFor('OTHER'",
      "slotFor('COMMERCIAL_INVOICE'",
    ].map((needle) => slots.indexOf(needle))
    expect(order.every((at) => at >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(page).toContain('tiles={view.brokerShape}')
  })
})
