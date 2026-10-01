import { describe, expect, it } from 'vitest'
import {
  chargeableCents,
  fuelChargeFor,
  fuelModeOf,
  lineTypeFor,
  showsBoth,
  tollChargeFor,
  type ChargeableFuel,
} from '../src/lib/fuel-charge'

// ---------------------------------------------------------------------------
// THE FUEL AND TOLL CHARGE SIDE (§6.2.3, migration 61).
//
// THE NUMBERS COME OFF THE ARTEFACT: $339.92 at the pump and $284.43 on the
// fuel-card invoice, the same gallon of diesel. That $55.49 gap is the whole
// reason the four modes exist, and it is why these cases use those two figures
// rather than round ones — a test on $100 and $90 would pass against an
// implementation that had the two amounts the wrong way round.
// ---------------------------------------------------------------------------

const RETAIL = 33992
const INVOICE = 28443
const FEES = 450

const fuel = (over: Partial<ChargeableFuel> = {}): ChargeableFuel => ({
  id: 'ft-1',
  purchasedAt: new Date(Date.UTC(2026, 7, 11)),
  totalCents: RETAIL,
  invoiceCents: INVOICE,
  feesCents: FEES,
  ...over,
})

const WEEK = {
  start: new Date(Date.UTC(2026, 7, 9)),
  end: new Date(Date.UTC(2026, 7, 15)),
}

describe('each mode charges a different amount', () => {
  it('RETAIL is the pump price', () => {
    expect(chargeableCents(fuel(), 'RETAIL')).toEqual({
      cents: RETAIL,
      fellBackToRetail: false,
    })
  })

  it('RETAIL_PLUS_FEES adds the card fees', () => {
    expect(chargeableCents(fuel(), 'RETAIL_PLUS_FEES').cents).toBe(
      RETAIL + FEES,
    )
  })

  it('INVOICE is what the card billed, which is LESS', () => {
    expect(chargeableCents(fuel(), 'INVOICE').cents).toBe(INVOICE)
    // THE DIRECTION MATTERS. Retail is the larger figure on every row in the
    // corpus; an implementation with the two columns swapped would overcharge
    // every driver on an INVOICE authority by the spread.
    expect(chargeableCents(fuel(), 'INVOICE').cents).toBeLessThan(RETAIL)
  })

  // THE TWO INVOICE MODES CHARGE THE SAME AND PRINT DIFFERENTLY. A mode that
  // changed the figure as well as the presentation would make "show me retail
  // too" a request that altered somebody's pay.
  it('INVOICE_SHOW_BOTH charges the same as INVOICE', () => {
    expect(chargeableCents(fuel(), 'INVOICE_SHOW_BOTH').cents).toBe(
      chargeableCents(fuel(), 'INVOICE').cents,
    )
    expect(showsBoth('INVOICE_SHOW_BOTH')).toBe(true)
    expect(showsBoth('INVOICE')).toBe(false)
  })
})

describe('a missing invoice amount falls back, and says so', () => {
  // `invoiceCents` is nullable because it arrives from the import. Charging
  // zero would be a gift; charging retail silently would produce a number the
  // mode does not describe.
  it('charges retail and reports the fallback', () => {
    const result = chargeableCents(fuel({ invoiceCents: null }), 'INVOICE')
    expect(result).toEqual({ cents: RETAIL, fellBackToRetail: true })
  })

  it('and the line says it out loud', () => {
    const result = fuelChargeFor({
      transactions: [fuel({ invoiceCents: null }), fuel({ id: 'ft-2' })],
      mode: 'INVOICE',
      period: WEEK,
      deduct: true,
    })
    expect(result.fellBackCount).toBe(1)
    expect(result.line?.note).toContain('1 of 2')
    expect(result.line?.note).toContain('retail')
  })

  it('and says nothing when every row had one', () => {
    const result = fuelChargeFor({
      transactions: [fuel(), fuel({ id: 'ft-2' })],
      mode: 'INVOICE',
      period: WEEK,
      deduct: true,
    })
    expect(result.fellBackCount).toBe(0)
    expect(result.line?.note).toBeUndefined()
  })
})

describe('show and deduct are two booleans', () => {
  // §6.2.3's load-bearing distinction: a company-fuel driver is shown what was
  // burned in his truck and charged NOTHING for it. A single boolean would make
  // that case inexpressible, and it is the common one in this fleet.
  it('deduct false charges nothing, and still reports the retail total', () => {
    const result = fuelChargeFor({
      transactions: [fuel()],
      mode: 'RETAIL',
      period: WEEK,
      deduct: false,
    })
    expect(result.line).toBeNull()
    expect(result.claimedIds).toEqual([])
    expect(result.retailCents).toBe(RETAIL)
  })

  it('and claims nothing it did not charge', () => {
    const result = fuelChargeFor({
      transactions: [fuel()],
      mode: 'RETAIL',
      period: WEEK,
      deduct: false,
    })
    // A CLAIMED-BUT-UNCHARGED ROW would be marked settled and never charged by
    // any later statement — fuel silently absorbed by the carrier.
    expect(result.claimedIds).toEqual([])
  })
})

describe('no transactions means no line, never a zero one', () => {
  // §4, and the same rule `computeDeductions` applies to its own Fuel branch. A
  // zero line claims somebody looked and found nothing charged.
  it('an empty week prints nothing', () => {
    const result = fuelChargeFor({
      transactions: [],
      mode: 'RETAIL',
      period: WEEK,
      deduct: true,
    })
    expect(result.line).toBeNull()
    expect(result.retailCents).toBe(0)
  })

  it('and a week of zero-value fills prints nothing either', () => {
    const result = fuelChargeFor({
      transactions: [fuel({ totalCents: 0, invoiceCents: 0, feesCents: 0 })],
      mode: 'RETAIL',
      period: WEEK,
      deduct: true,
    })
    expect(result.line).toBeNull()
  })
})

describe('the line itself', () => {
  it('is ONE line for several fill-ups, summed, signed negative', () => {
    const result = fuelChargeFor({
      transactions: [fuel(), fuel({ id: 'ft-2' }), fuel({ id: 'ft-3' })],
      mode: 'RETAIL',
      period: WEEK,
      deduct: true,
    })
    expect(result.line?.totalCents).toBe(-RETAIL * 3)
    expect(result.line?.quantity).toBe(3)
    expect(result.claimedIds).toEqual(['ft-1', 'ft-2', 'ft-3'])
  })

  // A DRIVER COMPARING A DEDUCTION AGAINST THE RECEIPTS IN HIS CAB needs to
  // know he is looking at the card invoice, or the two numbers read as an error.
  it('names which amount it charged', () => {
    const retail = fuelChargeFor({
      transactions: [fuel()],
      mode: 'RETAIL',
      period: WEEK,
      deduct: true,
    })
    expect(retail.line?.description).toContain('retail')

    const invoiced = fuelChargeFor({
      transactions: [fuel()],
      mode: 'INVOICE',
      period: WEEK,
      deduct: true,
    })
    expect(invoiced.line?.description).toContain('card invoice')
  })

  it('and prints retail beside it under INVOICE_SHOW_BOTH', () => {
    const result = fuelChargeFor({
      transactions: [fuel()],
      mode: 'INVOICE_SHOW_BOTH',
      period: WEEK,
      deduct: true,
    })
    expect(result.line?.description).toContain('$339.92')
    expect(result.line?.totalCents).toBe(-INVOICE)
  })

  it('carries the period in the description', () => {
    const result = fuelChargeFor({
      transactions: [fuel()],
      mode: 'RETAIL',
      period: WEEK,
      deduct: true,
    })
    expect(result.line?.description).toContain('08/09/2026 to 08/15/2026')
  })
})

describe('tolls are the same shape under their own boolean', () => {
  const toll = {
    id: 'tt-1',
    incurredAt: new Date(Date.UTC(2026, 7, 11)),
    totalCents: 1250,
    invoiceCents: null,
    feesCents: 0,
  }

  it('charges when told to', () => {
    const result = tollChargeFor({
      transactions: [toll],
      mode: 'RETAIL',
      period: WEEK,
      deduct: true,
    })
    expect(result.line?.totalCents).toBe(-1250)
    expect(result.line?.type).toBe('Tolls')
    // THE SETTLEMENT'S PERIOD, NOT THE CORPUS'S MONTH. `ST-005336` prints
    // `TollPrePass 08/01/2026 to 08/31/2026` because Datatruck bills that
    // vendor monthly; a Zebra line covers the week it is charged on, and
    // printing a month span on a weekly statement would claim a window the
    // figure does not cover.
    expect(result.line?.description).toContain('08/09/2026 to 08/15/2026')
    expect(result.claimedIds).toEqual(['tt-1'])
  })

  // AN AUTHORITY THAT CHARGES FUEL AND ABSORBS TOLLS is the common case here,
  // and it is the reason these are two booleans and two functions.
  it('and nothing when the toll boolean is off, whatever fuel does', () => {
    const result = tollChargeFor({
      transactions: [toll],
      mode: 'RETAIL',
      period: WEEK,
      deduct: false,
    })
    expect(result.line).toBeNull()
  })
})

describe('the mode, read from a column that may hold anything', () => {
  it('passes the four it knows', () => {
    expect(fuelModeOf('INVOICE')).toBe('INVOICE')
    expect(fuelModeOf('INVOICE_SHOW_BOTH')).toBe('INVOICE_SHOW_BOTH')
    expect(fuelModeOf('RETAIL_PLUS_FEES')).toBe('RETAIL_PLUS_FEES')
    expect(fuelModeOf('RETAIL')).toBe('RETAIL')
  })

  // RETAIL FOR ANYTHING ELSE, which is the conservative end: retail is the
  // larger amount, so a typo overcharges and gets noticed rather than
  // undercharging forever at the carrier's expense.
  it('and falls to RETAIL for anything else', () => {
    expect(fuelModeOf('invoice')).toBe('RETAIL')
    expect(fuelModeOf('')).toBe('RETAIL')
    expect(fuelModeOf(null)).toBe('RETAIL')
    expect(fuelModeOf(undefined)).toBe('RETAIL')
  })
})

describe('the line type for a label', () => {
  it('maps Tolls to DEDUCTION_TOLL, which migration 61 added', () => {
    expect(lineTypeFor('Tolls')).toBe('DEDUCTION_TOLL')
  })

  it('and an unknown label to DEDUCTION_OTHER rather than throwing', () => {
    // `type` is a free string by design — a new kind of charge is a label,
    // never a migration — so the enum has to have a floor.
    expect(lineTypeFor('Lumper')).toBe('DEDUCTION_OTHER')
    expect(lineTypeFor('Fuel')).toBe('DEDUCTION_FUEL')
  })
})
