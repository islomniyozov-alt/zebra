import { describe, expect, it } from 'vitest'
import {
  PIPELINE_STAGES,
  pipelineStage,
  stageIndex,
  type PipelineInput,
} from '@/lib/load-pipeline'

// ---------------------------------------------------------------------------
// FIVE WORDS OVER TWO AXES, AND THE ONE THAT MEANS SOMETHING DIFFERENT.
//
// The owner asked for one story on every load: Upcoming → In-Transit →
// Delivered → Invoiced → Paid. Zebra keeps operational and billing status as
// separate columns because they move independently, so this is a READ over
// both and never a stored third state.
//
// "Invoiced" is the interesting word. Amazon Relay settles by weekly statement
// and its loads never become invoices — `readyToInvoiceWhere` excludes them by
// design. The owner chose the literal word anyway, on every load, rather than
// teach two vocabularies. So on direct-settled freight the stage means
// "delivered, POD in, waiting on a statement", and these tests pin that it is
// reached WITHOUT an invoice existing.
// ---------------------------------------------------------------------------

const load = (over: Partial<PipelineInput> = {}): PipelineInput => ({
  operationalStatus: 'BOOKED',
  billingStatus: 'UNINVOICED',
  directSettled: false,
  totalRevenueCents: 100_000,
  ...over,
})

describe('a broker load moving through its life', () => {
  it('starts upcoming', () => {
    expect(pipelineStage(load({ operationalStatus: 'AVAILABLE' }))).toBe(
      'upcoming',
    )
    expect(pipelineStage(load({ operationalStatus: 'DISPATCHED' }))).toBe(
      'upcoming',
    )
  })

  it('is in transit from the first pickup to the last delivery', () => {
    for (const status of [
      'AT_PICKUP',
      'LOADED',
      'IN_TRANSIT',
      'AT_DELIVERY',
    ] as const) {
      expect(pipelineStage(load({ operationalStatus: status })), status).toBe(
        'inTransit',
      )
    }
  })

  it('is delivered once the freight is off, invoice or not', () => {
    expect(pipelineStage(load({ operationalStatus: 'DELIVERED' }))).toBe(
      'delivered',
    )
    expect(pipelineStage(load({ operationalStatus: 'POD_RECEIVED' }))).toBe(
      'delivered',
    )
  })

  it('reaches invoiced when an invoice actually exists', () => {
    expect(
      pipelineStage(
        load({ operationalStatus: 'POD_RECEIVED', billingStatus: 'INVOICED' }),
      ),
    ).toBe('invoiced')
  })

  it('reaches paid when the money landed', () => {
    expect(pipelineStage(load({ billingStatus: 'PAID' }))).toBe('paid')
  })

  // PARTIALLY PAID IS NOT PAID. The strip says how far the money got.
  it('holds a part-paid load at invoiced', () => {
    expect(pipelineStage(load({ billingStatus: 'PARTIALLY_PAID' }))).toBe(
      'invoiced',
    )
  })

  it('holds a written-off load where the money stopped', () => {
    expect(pipelineStage(load({ billingStatus: 'WRITTEN_OFF' }))).toBe(
      'invoiced',
    )
  })
})

describe('Amazon freight, where the word is a label', () => {
  const relay = (over: Partial<PipelineInput> = {}) =>
    load({ directSettled: true, ...over })

  // THE ASSERTION THAT MATTERS. No invoice exists, none ever will, and the
  // stage is still reached — because it names the awaiting-statement
  // milestone. A future reader who "fixes" this by invoicing direct-settled
  // freight breaks it here.
  it('reaches invoiced with billingStatus still uninvoiced', () => {
    const stage = pipelineStage(
      relay({ operationalStatus: 'POD_RECEIVED', billingStatus: 'UNINVOICED' }),
    )
    expect(stage).toBe('invoiced')
  })

  it('is only delivered while the POD is still missing', () => {
    expect(pipelineStage(relay({ operationalStatus: 'DELIVERED' }))).toBe(
      'delivered',
    )
  })

  // The same clause `directSettledAwaiting` uses: nothing to be paid for.
  it('stays delivered when the load carries no revenue', () => {
    expect(
      pipelineStage(
        relay({ operationalStatus: 'POD_RECEIVED', totalRevenueCents: 0 }),
      ),
    ).toBe('delivered')
  })

  it('reaches paid the same way broker freight does', () => {
    // `billingStatusFor` computes PAID for direct-settled loads from applied
    // payments against a statement rather than against an invoice.
    expect(
      pipelineStage(
        relay({ operationalStatus: 'POD_RECEIVED', billingStatus: 'PAID' }),
      ),
    ).toBe('paid')
  })

  // A BROKER LOAD AT THE SAME POINT IS NOT THERE YET, which is the whole
  // reason `directSettled` is read at all.
  it('differs from broker freight at exactly that one point', () => {
    const at = { operationalStatus: 'POD_RECEIVED' as const }
    expect(pipelineStage(relay(at))).toBe('invoiced')
    expect(pipelineStage(load(at))).toBe('delivered')
  })
})

describe('the strip itself', () => {
  it('runs in the order the owner asked for', () => {
    expect(PIPELINE_STAGES).toEqual([
      'upcoming',
      'inTransit',
      'delivered',
      'invoiced',
      'paid',
    ])
  })

  it('orders every stage it can return', () => {
    expect(stageIndex('upcoming')).toBe(0)
    expect(stageIndex('paid')).toBe(4)
  })
})
