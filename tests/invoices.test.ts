import { describe, expect, it } from 'vitest'
import {
  invoiceTotalFromLoads,
  linesForLoad,
  readyToInvoiceWhere,
} from '@/lib/invoices'
import { centsToInput } from '@/lib/money'

// ---------------------------------------------------------------------------
// §7: "A worked invoice example in tests: loads + accessorials in, exact cents
// out, checked by hand in the test comment."
//
// The arithmetic below is deliberately the kind somebody can do on paper while
// looking at a broker's remittance.
// ---------------------------------------------------------------------------

const labels = {
  linehaul: 'Linehaul',
  fuelSurcharge: 'Fuel surcharge',
  accessorial: (type: string) => type,
}

describe('the ready-to-invoice derivation', () => {
  const where = readyToInvoiceWhere()

  it('requires a POD', () => {
    expect(where.operationalStatus).toBe('POD_RECEIVED')
  })

  it('requires a rate', () => {
    // An invoice for nothing is worse than no invoice: it goes out, and it
    // has to be voided in front of the broker.
    expect(where.totalRevenueCents).toEqual({ gt: 0 })
  })

  it('excludes direct-settled freight', () => {
    // Amazon Relay pays RAM by weekly ACH statement. A Relay load has no
    // invoice in its life, and one sitting in a queue marked "ready" is one
    // somebody eventually sends.
    expect(where.directSettled).toBe(false)
  })

  it('excludes anything already on an invoice', () => {
    // Tested through the RELATION, not through billingStatus. The status is a
    // cache of this fact and caches drift; a load billed twice is how a
    // carrier gets accused of double-billing.
    expect(where.invoiceLines).toEqual({ none: {} })
  })

  it('excludes cancelled and deleted loads', () => {
    expect(where.isCancelled).toBe(false)
    expect(where.deletedAt).toBeNull()
  })
})

describe('the lines one load contributes', () => {
  const load = {
    id: 'load-1',
    loadNumber: '1042',
    linehaulCents: 245000,
    fuelSurchargeCents: 38000,
  }

  it('separates linehaul from fuel surcharge', () => {
    // Brokers audit them separately. A fuel surcharge folded into linehaul is
    // the first thing a claims department queries.
    const lines = linesForLoad(load, [], labels)
    expect(lines).toHaveLength(2)
    expect(lines[0]?.amountCents).toBe(245000)
    expect(lines[1]?.amountCents).toBe(38000)
    expect(lines[0]?.description).toContain('1042')
  })

  it('omits a zero component rather than printing a zero line', () => {
    const lines = linesForLoad({ ...load, fuelSurchargeCents: 0 }, [], labels)
    expect(lines).toHaveLength(1)
  })

  it('bills an approved billable accessorial', () => {
    const lines = linesForLoad(
      load,
      [
        {
          type: 'DETENTION',
          amountCents: 16250,
          isBillable: true,
          status: 'APPROVED',
        },
      ],
      labels,
    )
    expect(lines).toHaveLength(3)
    expect(lines[2]?.amountCents).toBe(16250)
  })

  it('does not bill a denied one, or a cost the carrier ate', () => {
    // The pair for the line above: same shape, one field different each time.
    const lines = linesForLoad(
      load,
      [
        {
          type: 'DETENTION',
          amountCents: 16250,
          isBillable: true,
          status: 'DENIED',
        },
        {
          type: 'LUMPER',
          amountCents: 12500,
          isBillable: false,
          status: 'APPROVED',
        },
      ],
      labels,
    )
    expect(lines).toHaveLength(2)
    expect(lines.map((line) => line.amountCents)).toEqual([245000, 38000])
  })

  it('bills a PENDING accessorial, because the load is worth what you intend to bill', () => {
    const lines = linesForLoad(
      load,
      [
        {
          type: 'LUMPER',
          amountCents: 12500,
          isBillable: true,
          status: 'PENDING',
        },
      ],
      labels,
    )
    expect(lines).toHaveLength(3)
  })

  it('keeps the sort order continuous across several loads', () => {
    const first = linesForLoad(load, [], labels, 0)
    const second = linesForLoad(
      { ...load, id: 'load-2', loadNumber: '1043' },
      [],
      labels,
      first.length,
    )
    expect([...first, ...second].map((line) => line.sortOrder)).toEqual([
      0, 1, 2, 3,
    ])
  })
})

describe('a worked invoice, checked by hand', () => {
  // TWO LOADS FOR ONE BROKER, the batch case brokers actually pay against.
  //
  //   Load 1042  linehaul        $2,450.00
  //              fuel surcharge    $380.00
  //              detention 2.5h    $162.50   (approved, billable)
  //              lumper            $125.00   (NOT billable — carrier ate it)
  //
  //   Load 1043  linehaul        $1,900.00
  //              fuel surcharge    $295.00
  //              layover           $150.00   (DENIED — not billed)
  //
  //   Billed:  2450.00 + 380.00 + 162.50 + 1900.00 + 295.00 = $5,187.50
  //   Subtotal (linehaul + fuel):        2450 + 380 + 1900 + 295 = $5,025.00
  //   Accessorials:                                                  $162.50
  const first = {
    id: 'a',
    loadNumber: '1042',
    linehaulCents: 245000,
    fuelSurchargeCents: 38000,
  }
  const second = {
    id: 'b',
    loadNumber: '1043',
    linehaulCents: 190000,
    fuelSurchargeCents: 29500,
  }

  const lines = [
    ...linesForLoad(
      first,
      [
        {
          type: 'DETENTION',
          amountCents: 16250,
          isBillable: true,
          status: 'APPROVED',
        },
        {
          type: 'LUMPER',
          amountCents: 12500,
          isBillable: false,
          status: 'APPROVED',
        },
      ],
      labels,
      0,
    ),
    ...linesForLoad(
      second,
      [
        {
          type: 'LAYOVER',
          amountCents: 15000,
          isBillable: true,
          status: 'DENIED',
        },
      ],
      labels,
      3,
    ),
  ]

  it('produces five billed lines', () => {
    expect(lines).toHaveLength(5)
    expect(lines.map((line) => line.amountCents)).toEqual([
      245000, 38000, 16250, 190000, 29500,
    ])
  })

  it('totals $5,187.50 exactly', () => {
    const total = lines.reduce((sum, line) => sum + line.amountCents, 0)
    expect(total).toBe(518750)
    expect(centsToInput(total)).toBe('5187.50')
  })

  it('splits into a $5,025.00 subtotal and $162.50 of accessorials', () => {
    const subtotal =
      first.linehaulCents +
      first.fuelSurchargeCents +
      second.linehaulCents +
      second.fuelSurchargeCents
    const total = lines.reduce((sum, line) => sum + line.amountCents, 0)
    expect(subtotal).toBe(502500)
    expect(total - subtotal).toBe(16250)
    expect(centsToInput(subtotal)).toBe('5025.00')
    expect(centsToInput(total - subtotal)).toBe('162.50')
  })

  it('agrees with what the loads say they are worth, minus what is not billed', () => {
    // The loads' own totalRevenue includes the non-billable lumper and the
    // denied layover, because those are real facts about the load. The invoice
    // does not. The difference is exactly those two lines — 125.00 + 150.00.
    const loadSideTotal = invoiceTotalFromLoads([
      { ...first, accessorialsCents: 16250 + 12500 },
      { ...second, accessorialsCents: 15000 },
    ])
    expect(loadSideTotal).toBe(518750 + 12500 + 15000)
    expect(loadSideTotal - 518750).toBe(27500)
    expect(centsToInput(27500)).toBe('275.00')
  })
})
