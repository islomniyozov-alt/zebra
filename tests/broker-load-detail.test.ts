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
