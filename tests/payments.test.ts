import { describe, expect, it } from 'vitest'
import { spreadOverLoads } from '@/lib/payments'
import { billingStatusFor, type BillingFacts } from '@/lib/billing-status'

// ---------------------------------------------------------------------------
// The two pure decisions in step 5, held away from Postgres so the awkward
// cases are cheap to state.
//
// Phase 3 §0: "the likeliest failure in this phase is not sprawl — it's a
// financial calculation that is PLAUSIBLE." A statement split that quietly
// balances, and a billing status that quietly says paid, are both plausible.
// ---------------------------------------------------------------------------

const facts = (over: Partial<BillingFacts> = {}): BillingFacts => ({
  isReady: false,
  directSettled: false,
  totalRevenueCents: 250000,
  appliedCents: 0,
  invoiced: false,
  invoiceTotalCents: 0,
  invoiceBalanceCents: 0,
  ...over,
})

describe('spreading a statement over the loads it covers', () => {
  it('fills the oldest first and stops when the money runs out', () => {
    // $5,000.00 against three loads worth $2,450, $1,900 and $1,625.
    // 245000 + 190000 = 435000, leaving 65000 of the 500000 for the third,
    // which is owed 162500 — so it takes 65000 and the rest stays owed.
    const { shares, remainderCents } = spreadOverLoads(500000, [
      { loadId: 'a', outstandingCents: 245000 },
      { loadId: 'b', outstandingCents: 190000 },
      { loadId: 'c', outstandingCents: 162500 },
    ])

    expect(shares).toEqual([
      { loadId: 'a', amountCents: 245000 },
      { loadId: 'b', amountCents: 190000 },
      { loadId: 'c', amountCents: 65000 },
    ])
    expect(remainderCents).toBe(0)
  })

  it('leaves money over rather than spreading it to make things tidy', () => {
    // THE POINT OF THE WHOLE PATH. $10,000.00 against $4,350.00 of freight:
    // the extra $5,650.00 stays unapplied, where somebody will ask about it.
    const { shares, remainderCents } = spreadOverLoads(1000000, [
      { loadId: 'a', outstandingCents: 245000 },
      { loadId: 'b', outstandingCents: 190000 },
    ])

    expect(shares).toEqual([
      { loadId: 'a', amountCents: 245000 },
      { loadId: 'b', amountCents: 190000 },
    ])
    expect(remainderCents).toBe(565000)
  })

  it('never proposes more than a load is owed', () => {
    const { shares } = spreadOverLoads(999999, [
      { loadId: 'a', outstandingCents: 100 },
    ])
    expect(shares).toEqual([{ loadId: 'a', amountCents: 100 }])
  })

  it('skips a load that is already paid instead of proposing zero', () => {
    // A zero row would submit a zero application, which is a row that says
    // nothing and still has to be explained to whoever reads it later.
    const { shares } = spreadOverLoads(50000, [
      { loadId: 'paid', outstandingCents: 0 },
      { loadId: 'owing', outstandingCents: 30000 },
    ])
    expect(shares).toEqual([{ loadId: 'owing', amountCents: 30000 }])
  })

  it('proposes nothing when there is nothing to propose', () => {
    expect(
      spreadOverLoads(0, [{ loadId: 'a', outstandingCents: 100 }]),
    ).toEqual({ shares: [], remainderCents: 0 })
    expect(spreadOverLoads(100, [])).toEqual({
      shares: [],
      remainderCents: 100,
    })
  })

  it('the proposal always accounts for every cent it was given', () => {
    const cases: [number, number[]][] = [
      [500000, [245000, 190000, 162500]],
      [1, [1, 1]],
      [1, [0, 0]],
      [999, [500, 499]],
      [1000000, [245000, 190000]],
    ]
    for (const [available, outstanding] of cases) {
      const { shares, remainderCents } = spreadOverLoads(
        available,
        outstanding.map((cents, index) => ({
          loadId: String(index),
          outstandingCents: cents,
        })),
      )
      const applied = shares.reduce((sum, share) => sum + share.amountCents, 0)
      expect(applied + remainderCents).toBe(available)
    }
  })
})

describe('what a load’s billing status should be', () => {
  it('is uninvoiced until it has a POD and a rate', () => {
    expect(billingStatusFor(facts())).toBe('UNINVOICED')
    expect(billingStatusFor(facts({ isReady: true }))).toBe('READY_TO_INVOICE')
  })

  it('follows the INVOICE balance, not the load’s own share', () => {
    // THE MISTAKE THIS EXISTS TO PREVENT. A $5,025.00 invoice covering a
    // $2,450.00 load: comparing the balance to the LOAD's revenue would call
    // it partially paid the moment it was issued, because 502500 > 245000 is
    // the wrong question.
    const onInvoice = facts({
      isReady: true,
      invoiced: true,
      totalRevenueCents: 245000,
      invoiceTotalCents: 502500,
      invoiceBalanceCents: 502500,
    })
    expect(billingStatusFor(onInvoice)).toBe('INVOICED')

    expect(
      billingStatusFor({ ...onInvoice, invoiceBalanceCents: 250000 }),
    ).toBe('PARTIALLY_PAID')
    expect(billingStatusFor({ ...onInvoice, invoiceBalanceCents: 0 })).toBe(
      'PAID',
    )
  })

  it('pays every load on an invoice at the same moment', () => {
    // A broker pays a document, not a load. Both loads on one settled invoice
    // are paid, whatever each is individually worth.
    const invoice = { invoiced: true, invoiceTotalCents: 435000 }
    for (const revenue of [245000, 190000]) {
      expect(
        billingStatusFor(
          facts({
            ...invoice,
            isReady: true,
            totalRevenueCents: revenue,
            invoiceBalanceCents: 0,
          }),
        ),
      ).toBe('PAID')
    }
  })

  it('takes direct-settled freight from ready straight to paid', () => {
    // No invoice ever exists, so INVOICED is not a state it can reach.
    const relay = facts({
      directSettled: true,
      isReady: true,
      totalRevenueCents: 400000,
    })
    expect(billingStatusFor(relay)).toBe('READY_TO_INVOICE')
    expect(billingStatusFor({ ...relay, appliedCents: 150000 })).toBe(
      'PARTIALLY_PAID',
    )
    expect(billingStatusFor({ ...relay, appliedCents: 400000 })).toBe('PAID')
  })

  it('counts an overpaid direct load as paid rather than something else', () => {
    // The statement paid more than the load is worth. That difference is the
    // payment's problem — it stays unapplied there — and the load is paid.
    expect(
      billingStatusFor(
        facts({
          directSettled: true,
          isReady: true,
          totalRevenueCents: 400000,
          appliedCents: 420000,
        }),
      ),
    ).toBe('PAID')
  })

  it('does not call a voided invoice’s load invoiced', () => {
    // `billingFactsFor` filters void and written-off invoices out, so the load
    // arrives here as if it had never been invoiced — back in the ready queue
    // rather than stranded.
    expect(billingStatusFor(facts({ isReady: true, invoiced: false }))).toBe(
      'READY_TO_INVOICE',
    )
  })
})
