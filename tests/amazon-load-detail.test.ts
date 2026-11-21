import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  AMAZON_CUSTOMER_NAMES,
  amazonByBroker,
  amazonByRelay,
  isAmazonLoad,
} from '@/lib/amazon-load'
import { createdBy } from '@/lib/load-detail-view'
import { formatBp, profitBox } from '@/lib/load-profit'
import { trackerStep, TRACKER_STEPS } from '@/lib/load-tracker'
import { tripsFromStops } from '@/lib/load-trips'
import { RELAY_CUSTOMER_NAME } from '@/lib/relay-import'
import { loadWarnings } from '@/lib/warnings'

// ---------------------------------------------------------------------------
// §7.13 — THE AMAZON LOAD DETAIL, WITHOUT A BROWSER.
//
// THE FIXTURES ARE DT-018794 AS ISLOM'S SCREENSHOT SHOWS IT
// (`corpus/datatruck-load-detail-2026-11-16-1.png`): Load ID 114C544TK,
// AMAZON LOGISTICS under RAM Haulage LLC, EIK2 Aurora CO 80019 to TUL2 Tulsa
// OK 74116, delivered, total pay $175.00, driver gross $175.00, gross profit
// $0.00 at 0.0%. And the Relay trip T-111LZF1LH, legs 116H3G98L and
// 116KC2CKW, from `corpus/datatruck/Trips - 2026-09-24T090710.426.csv`.
// ---------------------------------------------------------------------------

describe('isAmazonLoad — two sides, and both of them alive', () => {
  /** The Datatruck history import: Amazon by name, never flagged direct. */
  const imported = {
    directSettled: false,
    customer: { name: 'AMAZON LOGISTICS' },
  }
  /** A Relay booking through createLoad: both sides. */
  const relayBooked = {
    directSettled: true,
    customer: { name: 'Amazon Relay' },
  }
  /**
   * The Relay side alone. No such customer exists today; it is here so the
   * side is exercised on its own, which is what makes it known to work.
   */
  const directElsewhere = {
    directSettled: true,
    customer: { name: 'A Direct Shipper' },
  }
  const werner = { directSettled: false, customer: { name: 'Werner' } }
  const fixture = [imported, relayBooked, directElsewhere, werner]

  // THE AGREEMENT TEST. "Matches no Amazon load" is true of a side that never
  // fires, which is the most comfortable way for a predicate to be wrong — so
  // each side must catch something the other does not, and the predicate
  // must be exactly their union.
  it('has each side catch a load the other does not', () => {
    const brokerOnly = fixture.filter(
      (load) => amazonByBroker(load) && !amazonByRelay(load),
    )
    const relayOnly = fixture.filter(
      (load) => amazonByRelay(load) && !amazonByBroker(load),
    )
    expect(brokerOnly.length).toBeGreaterThan(0)
    expect(relayOnly.length).toBeGreaterThan(0)
    for (const load of fixture) {
      expect(isAmazonLoad(load)).toBe(
        amazonByBroker(load) || amazonByRelay(load),
      )
    }
    expect(fixture.filter(isAmazonLoad)).toEqual([
      imported,
      relayBooked,
      directElsewhere,
    ])
  })

  it('names the customer the Relay importers book against', () => {
    expect(AMAZON_CUSTOMER_NAMES).toContain(RELAY_CUSTOMER_NAME)
  })

  it('compares exactly after case and spaces, never by similarity', () => {
    const named = (name: string) => amazonByBroker({ customer: { name } })
    expect(named('  amazon   logistics ')).toBe(true)
    expect(named('amazon relay')).toBe(true)
    expect(named('Amazon Logistics Inc')).toBe(false)
    expect(named('Amazon')).toBe(false)
  })
})

describe('the eight-step tracker', () => {
  const step = (
    operationalStatus: Parameters<typeof trackerStep>[0]['operationalStatus'],
    billingStatus: Parameters<
      typeof trackerStep
    >[0]['billingStatus'] = 'UNINVOICED',
    assigned = false,
  ) => trackerStep({ operationalStatus, billingStatus, assigned })

  it("is Datatruck's eight words in Datatruck's order", () => {
    expect(TRACKER_STEPS).toEqual([
      'offer',
      'booked',
      'assigned',
      'dispatched',
      'inTransit',
      'delivered',
      'invoiced',
      'paid',
    ])
  })

  it('maps the operational axis', () => {
    expect(step('AVAILABLE')).toBe(1)
    expect(step('BOOKED')).toBe(2)
    expect(step('DISPATCHED')).toBe(4)
    expect(step('AT_PICKUP')).toBe(4)
    expect(step('LOADED')).toBe(5)
    expect(step('IN_TRANSIT')).toBe(5)
    expect(step('AT_DELIVERY')).toBe(5)
    // DT-018794 sits here: delivered, nothing invoiced.
    expect(step('DELIVERED')).toBe(6)
    expect(step('POD_RECEIVED')).toBe(6)
  })

  it('is Assigned once a driver or truck is on a booked load', () => {
    expect(step('BOOKED', 'UNINVOICED', true)).toBe(3)
    // ASSIGNED IS A BOOKED LOAD'S STEP ONLY. A moving load with a driver is
    // not taken back to Assigned.
    expect(step('IN_TRANSIT', 'UNINVOICED', true)).toBe(5)
  })

  it('lets the billing axis raise the step and never lower it', () => {
    expect(step('DELIVERED', 'INVOICED')).toBe(7)
    expect(step('DELIVERED', 'PARTIALLY_PAID')).toBe(7)
    expect(step('DELIVERED', 'FILED_WITH_FACTOR')).toBe(7)
    expect(step('DELIVERED', 'PAID')).toBe(8)
    expect(step('BOOKED', 'INVOICED')).toBe(7)
    expect(step('DELIVERED', 'READY_TO_INVOICE')).toBe(6)
  })

  it('takes nothing from closed Datatruck history', () => {
    expect(step('DELIVERED', 'CLOSED_IN_DATATRUCK')).toBe(6)
    expect(step('DISPATCHED', 'CLOSED_IN_DATATRUCK')).toBe(4)
  })

  it('is what the page draws the tracker from', () => {
    const page = readFileSync('src/app/(app)/loads/[id]/page.tsx', 'utf8')
    expect(page).toContain('trackerStep({')
  })
})

describe('the trips on a load', () => {
  const stop = (name: string, referenceNumber: string | null = null) => ({
    name,
    referenceNumber,
  })

  it('is one trip under the load reference when no stop marks a leg', () => {
    // DT-018794: two stops, no leg reference.
    const legs = tripsFromStops([stop('EIK2'), stop('TUL2')], '114C544TK')
    expect(legs).toEqual([
      { tripId: '114C544TK', pickup: stop('EIK2'), delivery: stop('TUL2') },
    ])
  })

  it('is one row per leg on a multi-leg Relay trip', () => {
    const stops = [
      stop('MEM4'),
      stop('BNA2', '116H3G98L'),
      stop('SDF8', '116KC2CKW'),
    ]
    expect(
      tripsFromStops(stops, 'T-111LZF1LH').map((leg) => [
        leg.tripId,
        leg.pickup.name,
        leg.delivery.name,
      ]),
    ).toEqual([
      ['116H3G98L', 'MEM4', 'BNA2'],
      ['116KC2CKW', 'BNA2', 'SDF8'],
    ])
  })

  it('keeps stops after the last marked leg as a final trip', () => {
    const stops = [stop('A'), stop('B', '116H3G98L'), stop('C')]
    expect(
      tripsFromStops(stops, 'T-111LZF1LH').map((leg) => leg.tripId),
    ).toEqual(['116H3G98L', 'T-111LZF1LH'])
  })

  it('has no trip with fewer than two stops', () => {
    expect(tripsFromStops([stop('A')], 'X')).toEqual([])
  })
})

describe('the profit box', () => {
  it('reads DT-018794 as the screenshot does: $0.00 at 0.0%', () => {
    expect(
      profitBox({
        totalRevenueCents: 17_500,
        accessorialsCents: 17_500,
        driverPayCents: 17_500,
      }),
    ).toEqual({
      revenueCents: 17_500,
      accessorialsCents: 17_500,
      driverPayCents: 17_500,
      grossProfitCents: 0,
      marginBp: 0,
    })
  })

  it('computes margin in basis points', () => {
    expect(
      profitBox({
        totalRevenueCents: 200_000,
        accessorialsCents: 0,
        driverPayCents: 150_000,
      }),
    ).toMatchObject({ grossProfitCents: 50_000, marginBp: 2_500 })
  })

  // UNKNOWN PAY IS NOT ZERO PAY: the whole revenue would print as profit.
  it('prints no profit while driver pay is unknown', () => {
    expect(
      profitBox({
        totalRevenueCents: 17_500,
        accessorialsCents: 0,
        driverPayCents: null,
      }),
    ).toMatchObject({ grossProfitCents: null, marginBp: null })
  })

  it('prints no margin on a load with no revenue', () => {
    expect(
      profitBox({
        totalRevenueCents: 0,
        accessorialsCents: 0,
        driverPayCents: 0,
      }).marginBp,
    ).toBeNull()
  })
})

describe('created by', () => {
  it('names the person on the CREATE row', () => {
    expect(createdBy({ externalId: null }, { name: 'Yusuf Mirzoev' })).toEqual({
      kind: 'person',
      name: 'Yusuf Mirzoev',
    })
  })

  it('names the history import, which writes no audit row', () => {
    expect(createdBy({ externalId: 'DT-018794' }, null)).toEqual({
      kind: 'import',
    })
  })

  it('says unknown rather than inventing an author', () => {
    expect(createdBy({ externalId: null }, null)).toEqual({ kind: 'unknown' })
    expect(createdBy({ externalId: null }, { name: null })).toEqual({
      kind: 'unknown',
    })
  })
})

describe('no document warning on a load', () => {
  // §7.13 ruling 1's third clause is ALREADY TRUE: no load warning reads a
  // document. Pinned here so a document warning added to loads has to meet
  // this test, and the Amazon exemption, on the way in.
  it('takes no document fact and raises no document warning', () => {
    const warnings = loadWarnings(
      {
        pickupAt: null,
        hasDriver: true,
        hasTruck: true,
        isCancelled: false,
        closedHistory: false,
        isFinished: true,
        truckRemoved: false,
        truckUnit: '08',
        directSettled: false,
        rateCents: 17_500,
        remittedCents: 0,
        hasRemittance: false,
        confirmedCents: null,
      },
      new Date('2026-11-16T12:00:00Z'),
    )
    expect(warnings.map((warning) => warning.name)).not.toContain(
      'document_missing',
    )
    const source = readFileSync('src/lib/warnings.ts', 'utf8')
    const facts = source.slice(
      source.indexOf('export interface LoadFacts'),
      source.indexOf('const DAY_MS'),
    )
    expect(facts.toLowerCase()).not.toContain('document')
  })
})

describe('the margin', () => {
  it('reads basis points as a percentage with one decimal', () => {
    expect(formatBp(0, 'en-US')).toBe('0.0%')
    expect(formatBp(2_500, 'en-US')).toBe('25.0%')
    expect(formatBp(-1_234, 'en-US')).toBe('-12.3%')
  })
})

// ---------------------------------------------------------------------------
// THE PAGE CALLS THE RULES, AND MONEY STAYS BEHIND ITS PERMISSION.
//
// The rules above are only closed if the page uses them; and the money on the
// Amazon shape — Total pay, driver gross, the Profit box, the Financials tab —
// must be absent from a role without `load.financials`, never hidden.
// ---------------------------------------------------------------------------

describe('the Amazon load detail page', () => {
  const page = readFileSync('src/app/(app)/loads/[id]/page.tsx', 'utf8')
  const documents = readFileSync(
    'src/app/(app)/loads/[id]/LoadDocuments.tsx',
    'utf8',
  )

  // §7.14: every load takes the shape now; what is Amazon's alone still
  // rides on the view, which takes it from isAmazonLoad.
  it('renders one shape for every load, the older stacked layout gone', () => {
    expect(page).not.toContain('view.datatruckShape')
    expect(page).not.toContain('<PipelineStrip')
    expect(page).not.toContain('<LoadFacts')
  })

  // v11.20 — scheduled against actual on one row. The portal's taps write
  // these clocks; a stops table without them would hide the comparison.
  it('keeps Arrived and Departed beside the appointment window', () => {
    const detail = readFileSync(
      'src/app/(app)/loads/[id]/AmazonDetail.tsx',
      'utf8',
    )
    expect(page).toContain("arrived: at(stop.arrivedAt) ?? '—'")
    expect(page).toContain("departed: at(stop.departedAt) ?? '—'")
    expect(detail).toMatch(
      /labels\.window,\s*labels\.arrived,\s*labels\.departed,/,
    )
    expect(detail).toContain('{stop.arrived}')
    expect(detail).toContain('{stop.departed}')
  })

  it('asks for no document on an Amazon load, and says where they are', () => {
    expect(page).toContain('const required = !view.documentsOnRelay')
    expect(page).toContain("note: t('loads.documentsOnRelay')")
    expect(documents).toContain('{note ? <p')
  })

  it('reads driver pay only for a role that may see money, signed-off only', () => {
    expect(page).toMatch(/const driverPayCents = maySeeRates*?/)
    expect(page).toContain(
      "settlement: { status: { in: ['APPROVED', 'PAID'] } }",
    )
  })

  it('builds the Profit box, the gross column and the tab only with money', () => {
    expect(page).toContain('const box = maySeeRate')
    expect(page).toContain('showDriverGross={maySeeRate}')
    expect(page).toMatch(/\.\.\.\(maySeeRate\s*\?\s*\[\{ key: 'financials'/)
  })

  // §7.13's flag: Zebra has no edit route, and §7.12 rules that nothing on
  // direct-settled freight asks for an invoice. Since §7.14 Create invoice
  // exists — on broker freight only, so an Amazon load never reaches it.
  it('offers Amazon freight no Create invoice, and no load Edit load', () => {
    expect(page).toMatch(/const mayInvoice =\s*view\.brokerShape &&/)
    expect(page.match(/createLoadInvoiceAction\.bind/g)).toHaveLength(1)
    expect(page).not.toMatch(/editLoad|\/edit`|Edit load/)
  })
})
