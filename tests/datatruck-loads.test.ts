import { describe, expect, it } from 'vitest'
import {
  datatruckCents,
  parseDatatruckMoment,
  planLoads,
  readEquipment,
  readPlace,
  rateChangeFor,
  rateFreezeFor,
  readStatus,
  syncDecisionFor,
} from '@/lib/datatruck/loads'

// ---------------------------------------------------------------------------
// THE LOAD IMPORT'S RULES, WITHOUT A DATABASE.
//
// Every one of these has a failure mode that looks like success: a rate a cent
// short, a stop with no state, a closed load filed as live. None of them would
// throw, and none would be visible in a row count.
// ---------------------------------------------------------------------------

describe('money, rounded half up rather than truncated', () => {
  // THE 854 ROWS THAT MADE THIS NECESSARY. `parseMoneyToCents` truncates on
  // purpose — for a typed amount a third decimal is a typo — and these are not
  // typed, they are Datatruck's own float artefacts.
  it('rounds an IEEE-754 artefact to the cent it plainly means', () => {
    expect(datatruckCents('597.5599999999999')).toBe(59_756)
    expect(datatruckCents('844.3200000000001')).toBe(84_432)
    expect(datatruckCents('968.6799999999999')).toBe(96_868)
  })

  it('leaves an ordinary two-decimal amount exactly alone', () => {
    expect(datatruckCents('1184.04')).toBe(118_404)
    expect(datatruckCents('0')).toBe(0)
    expect(datatruckCents('175')).toBe(17_500)
  })

  // Half UP, so the boundary goes up rather than to even or to the floor.
  it('carries at exactly half', () => {
    expect(datatruckCents('1.005')).toBe(101)
    expect(datatruckCents('1.004')).toBe(100)
  })

  it('refuses text rather than returning zero', () => {
    expect(() => datatruckCents('not money')).toThrow()
  })
})

describe('dates, which must not depend on where the process runs', () => {
  it('reads a day and a timestamp as UTC', () => {
    expect(parseDatatruckMoment('Sep 09, 2026')?.toISOString()).toBe(
      '2026-09-09T00:00:00.000Z',
    )
    expect(parseDatatruckMoment('Sep 08, 2026, 18:13')?.toISOString()).toBe(
      '2026-09-08T18:13:00.000Z',
    )
  })

  // `new Date('Sep 09, 2026')` would answer this differently in Chicago.
  it('refuses anything that is not the stated format', () => {
    expect(parseDatatruckMoment('2026-09-09')).toBeNull()
    expect(parseDatatruckMoment('Sept 9 2026')).toBeNull()
    expect(parseDatatruckMoment('')).toBeNull()
  })
})

describe('the two axes', () => {
  it('files delivered, invoiced and paid as one closed billing state', () => {
    for (const word of ['delivered', 'invoiced', 'paid']) {
      const reading = readStatus(word)
      expect(reading?.billing).toBe('CLOSED_IN_DATATRUCK')
      expect(reading?.operational).toBe('DELIVERED')
      expect(reading?.closed).toBe(true)
    }
  })

  // THE HALF THAT MATTERS FOR DRIFT. A live load's billing status is owned by
  // `billingStatusFor`, and writing anything but UNINVOICED here would make
  // the 88 live rows disagree with the rule the moment anything touched them.
  it('leaves the live rows on a computed billing status', () => {
    for (const word of [
      'booked',
      'assigned',
      'dispatched',
      'in_transit',
      'offer',
    ]) {
      const reading = readStatus(word)
      expect(reading?.billing).toBe('UNINVOICED')
      expect(reading?.closed).toBe(false)
    }
  })

  it('marks a cancellation cancelled and closed', () => {
    expect(readStatus('canceled')).toEqual({
      operational: 'BOOKED',
      billing: 'CLOSED_IN_DATATRUCK',
      cancelled: true,
      closed: true,
    })
  })

  it('refuses a status it has no counterpart for', () => {
    expect(readStatus('teleported')).toBeNull()
  })
})

describe('equipment', () => {
  it('reads the two the export carries and refuses the rest', () => {
    expect(readEquipment('dry_van')).toBe('DRY_VAN')
    expect(readEquipment('power_only')).toBe('POWER_ONLY')
    expect(readEquipment('')).toBeNull()
    expect(readEquipment('flatbed_maybe')).toBeNull()
  })
})

describe('locations, in the seven shapes the corpus really contains', () => {
  it('reads City, ST, ZIP', () => {
    expect(
      readPlace('Oklahoma City, OK, 73179', 'Oklahoma', 'Hobby Lobby'),
    ).toEqual({
      city: 'Oklahoma City',
      state: 'OK',
      postalCode: '73179',
      addressLine1: null,
      name: 'Hobby Lobby',
    })
  })

  // 4,208 rows across both columns. The string omits the state and the
  // separate column spells it out in full — `Oklahoma`, not `OK`.
  it('recovers the state from the other column when the string omits it', () => {
    expect(readPlace('Tallahassee, , 32303', 'Florida', 'Depot')).toEqual({
      city: 'Tallahassee',
      state: 'FL',
      postalCode: '32303',
      addressLine1: null,
      name: 'Depot',
    })
  })

  it('reads a street address, where state and zip share the last part', () => {
    expect(
      readPlace('12200 Telegraph Rd, Redford, MI 48239', 'Michigan', ''),
    ).toEqual({
      city: 'Redford',
      state: 'MI',
      postalCode: '48239',
      addressLine1: '12200 Telegraph Rd',
      name: null,
    })
  })

  it('reads a trailing comma without inventing a postcode', () => {
    expect(readPlace('Houston, TX,', 'Texas', 'Yard')).toEqual({
      city: 'Houston',
      state: 'TX',
      postalCode: null,
      addressLine1: null,
      name: 'Yard',
    })
  })

  // `HHO9` is an Amazon site code. Filing it as a city would put a place
  // nobody can find on a stop; it is kept as what it is.
  it('keeps a bare facility code as a name, never as a city', () => {
    const place = readPlace('HHO9', 'Tennessee', '')
    expect(place.city).toBeNull()
    expect(place.name).toBe('HHO9')
    expect(place.state).toBe('TN')
  })

  it('survives a blank location with only the state column to go on', () => {
    expect(readPlace('', 'Nebraska', '')).toEqual({
      city: null,
      state: 'NE',
      postalCode: null,
      addressLine1: null,
      name: null,
    })
  })
})

// ---------------------------------------------------------------------------
// THE PLANNER, over rows shaped exactly like the export's.
// ---------------------------------------------------------------------------

const row = (over: Record<string, string> = {}): Record<string, string> => ({
  'Shipment ID': 'DT-000001',
  'Load ID': '2004449168',
  'Trip ID': 'TR-000001-01',
  'MC Number': 'RAM Haulage LLC',
  Customer: 'WERNER ENTERPRISES INC',
  'Driver/Carrier': 'Sebastian Zorzoli',
  Truck: '1995',
  'Load status': 'delivered',
  'Load pay': '1184.04',
  'Total other pay': '0',
  'Total pay': '1184.04',
  'Stops count': '2',
  'Created date': 'Sep 08, 2026, 18:13',
  'PU date': 'Sep 09, 2026',
  'DEL date': 'Sep 10, 2026',
  'Delivery Appointment Time': 'Sep 10, 2026, 08:00',
  'Pickup location': 'Oklahoma City, OK, 73179',
  'Pickup state': 'Oklahoma',
  'Pickup company': 'Hobby Lobby Distribution Cntr.',
  'Delivery location': 'Grand Island, NE, 68803',
  'Delivery state': 'Nebraska',
  'Delivery company': 'Hobby Lobby#134',
  'Equipment types': 'dry_van',
  Mile: '556.07',
  'Empty mile': '238.42',
  'Total miles': '445.05',
  ...over,
})

describe('planning a load', () => {
  it('carries the three ids to the three places the ruling names', () => {
    const [load] = planLoads([row()]).planned
    expect(load?.externalId).toBe('DT-000001')
    expect(load?.referenceNumber).toBe('2004449168')
    expect(load?.tripId).toBe('TR-000001-01')
  })

  it('splits the money and sums it', () => {
    const [load] = planLoads([
      row({
        'Load pay': '1000',
        'Total other pay': '175',
        'Total pay': '1175',
      }),
    ]).planned
    expect(load?.linehaulCents).toBe(100_000)
    expect(load?.accessorialCents).toBe(17_500)
    expect(load?.totalRevenueCents).toBe(117_500)
  })

  // The export's own arithmetic held on all 14,451 rows when measured. A row
  // where it stops holding is a row whose money nobody should assume.
  it('REFUSES a row whose own total disagrees with its parts', () => {
    const plan = planLoads([
      row({ 'Load pay': '1000', 'Total other pay': '0', 'Total pay': '9999' }),
    ])
    expect(plan.planned).toHaveLength(0)
    expect(plan.held[0]?.reason).toContain('Total pay says')
  })

  it('records the declared stop count and says what is missing', () => {
    const [load] = planLoads([row({ 'Stops count': '4' })]).planned
    expect(load?.declaredStops).toBe(4)
    expect(load?.corrections.join(' ')).toContain('2 of them not in the export')
  })

  it('refuses an authority this system does not operate under', () => {
    const plan = planLoads([row({ 'MC Number': 'SOMEBODY ELSE LLC' })])
    expect(plan.planned).toHaveLength(0)
    expect(plan.held[0]?.reason).toContain('SOMEBODY ELSE LLC')
  })

  it('accepts the three retired authorities, which have Company rows', () => {
    for (const mc of [
      'Midwest Global Logistics LLC',
      'American Soldier Transport LLC',
      'AG FREIGHT INC',
    ]) {
      expect(planLoads([row({ 'MC Number': mc })]).planned).toHaveLength(1)
    }
  })

  it('refuses a row with no Shipment ID, and a repeated one', () => {
    expect(planLoads([row({ 'Shipment ID': '' })]).held[0]?.reason).toContain(
      'import key',
    )
    const twice = planLoads([row(), row()])
    expect(twice.planned).toHaveLength(1)
    expect(twice.held[0]?.reason).toContain('twice')
  })

  it('refuses a load with no customer, because the column is NOT NULL', () => {
    expect(planLoads([row({ Customer: '' })]).held[0]?.reason).toContain(
      'no customer',
    )
  })

  it('keeps the raw driver and truck for the seed to resolve', () => {
    const [load] = planLoads([row()]).planned
    expect(load?.driverName).toBe('Sebastian Zorzoli')
    expect(load?.truckUnit).toBe('1995')
  })
})

// ---------------------------------------------------------------------------
// THE RECURRING SYNC, WHICH ONLY EVER MOVES FREIGHT FORWARD.
//
// Dispatchers stay on Datatruck until Zebra is finished, so the same export
// arrives again with the same Shipment IDs and some rows have moved on. Every
// assertion here is about the direction of travel, because the failure mode is
// silent: a stale export re-run would undeliver freight that has arrived, and
// nothing on any screen would say it had happened.
// ---------------------------------------------------------------------------

describe('what a later export may change', () => {
  const at = (
    operational: Parameters<typeof syncDecisionFor>[0]['operational'],
    billing: Parameters<typeof syncDecisionFor>[0]['billing'],
  ) => ({ operational, billing })

  it('advances a load that has moved on', () => {
    const decision = syncDecisionFor(
      at('BOOKED', 'UNINVOICED'),
      at('IN_TRANSIT', 'UNINVOICED'),
    )
    expect(decision.operational).toBe('IN_TRANSIT')
    expect(decision.billing).toBeNull()
    expect(decision.notes.join()).toContain('BOOKED -> IN_TRANSIT')
  })

  // THE ONE THAT MATTERS. Re-running last Tuesday's file must not undeliver
  // freight that arrived on Wednesday.
  it('REFUSES to walk a load backwards, and says so', () => {
    const decision = syncDecisionFor(
      at('DELIVERED', 'UNINVOICED'),
      at('BOOKED', 'UNINVOICED'),
    )
    expect(decision.operational).toBeNull()
    expect(decision.notes.join()).toContain('behind DELIVERED')
  })

  it('closes a load whatever its rank', () => {
    const decision = syncDecisionFor(
      at('BOOKED', 'UNINVOICED'),
      at('DELIVERED', 'CLOSED_IN_DATATRUCK'),
    )
    expect(decision.operational).toBe('DELIVERED')
    expect(decision.billing).toBe('CLOSED_IN_DATATRUCK')
  })

  // CLOSED IS FINAL. Nothing in a later export reopens finished history —
  // not a status, not a billing state, not a backward step.
  it('leaves a closed load entirely alone', () => {
    const decision = syncDecisionFor(
      at('DELIVERED', 'CLOSED_IN_DATATRUCK'),
      at('BOOKED', 'UNINVOICED'),
    )
    expect(decision).toEqual({ operational: null, billing: null, notes: [] })
  })

  it('does nothing at all when nothing moved', () => {
    const decision = syncDecisionFor(
      at('DELIVERED', 'UNINVOICED'),
      at('DELIVERED', 'UNINVOICED'),
    )
    expect(decision).toEqual({ operational: null, billing: null, notes: [] })
  })

  // A DISPUTE IS NOT A POINT ON THE LADDER. `billingStatusFor` does not own
  // DISPUTED or WRITTEN_OFF, and neither does an import: they are decisions
  // somebody made here, and an export has no opinion worth acting on.
  it('refuses to order a decided billing state', () => {
    const decision = syncDecisionFor(
      at('DELIVERED', 'DISPUTED'),
      at('DELIVERED', 'UNINVOICED'),
    )
    expect(decision.billing).toBeNull()
    expect(decision.notes.join()).toContain('not comparable')
  })

  it('still closes a disputed load, because closing is always allowed', () => {
    const decision = syncDecisionFor(
      at('DELIVERED', 'DISPUTED'),
      at('DELIVERED', 'CLOSED_IN_DATATRUCK'),
    )
    expect(decision.billing).toBe('CLOSED_IN_DATATRUCK')
  })

  it('advances billing forward when the ladder allows it', () => {
    expect(
      syncDecisionFor(
        at('DELIVERED', 'UNINVOICED'),
        at('DELIVERED', 'INVOICED'),
      ).billing,
    ).toBe('INVOICED')
    expect(
      syncDecisionFor(at('DELIVERED', 'PAID'), at('DELIVERED', 'INVOICED'))
        .billing,
    ).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// THE RATE, WHICH DATATRUCK OWNS UNTIL ZEBRA SPENDS AGAINST IT.
//
// The gate is commitment, not age: a load from January with nothing against it
// may be restated, and one from this morning that has been settled may not.
// Every branch is asserted because the failure is silent — a rate moving under
// a settled cheque makes the cheque disagree with the load it settled, and
// nothing on any screen would say so.
// ---------------------------------------------------------------------------

describe('when a fresh export may restate the money', () => {
  const load = (over: Partial<Parameters<typeof rateFreezeFor>[0]> = {}) => ({
    billing: 'UNINVOICED' as const,
    settlementLines: 0,
    paymentApplications: 0,
    ...over,
  })

  it('allows it on an open imported load with no money against it', () => {
    expect(rateFreezeFor(load())).toEqual({ frozen: false })
  })

  it('freezes once a settlement line exists', () => {
    expect(rateFreezeFor(load({ settlementLines: 1 }))).toEqual({
      frozen: true,
      why: 'settled',
    })
  })

  it('freezes once a payment has been applied', () => {
    expect(rateFreezeFor(load({ paymentApplications: 1 }))).toEqual({
      frozen: true,
      why: 'paid',
    })
  })

  it('freezes a closed load, whatever else is true of it', () => {
    expect(rateFreezeFor(load({ billing: 'CLOSED_IN_DATATRUCK' }))).toEqual({
      frozen: true,
      why: 'closed',
    })
  })
})

describe('what a restated rate looks like', () => {
  it('returns null when nothing moved', () => {
    expect(
      rateChangeFor(
        { linehaulCents: 100_000, accessorialCents: 0 },
        { linehaulCents: 100_000, accessorialCents: 0 },
      ),
    ).toBeNull()
  })

  // THE WHOLE PICTURE MOVES TOGETHER. `accessorialsCents` is the sum of the
  // load's billable accessorial rows; restating one without the other leaves
  // the two disagreeing, and the import's reconciliation sums all three.
  it('carries linehaul, accessorial and total together', () => {
    const change = rateChangeFor(
      { linehaulCents: 100_000, accessorialCents: 0 },
      { linehaulCents: 120_000, accessorialCents: 17_500 },
    )
    expect(change?.linehaulCents).toBe(120_000)
    expect(change?.accessorialCents).toBe(17_500)
    expect(change?.totalRevenueCents).toBe(137_500)
  })

  // OLD AND NEW, BOTH. "The rate changed" is not an audit answer; a dispute
  // turns on what it changed FROM.
  it('names both figures in the event note', () => {
    const change = rateChangeFor(
      { linehaulCents: 100_000, accessorialCents: 0 },
      { linehaulCents: 120_000, accessorialCents: 17_500 },
    )
    expect(change?.note).toContain('$1000.00 -> $1200.00')
    expect(change?.note).toContain('$0.00 -> $175.00')
  })

  it('notices an accessorial moving on its own', () => {
    const change = rateChangeFor(
      { linehaulCents: 100_000, accessorialCents: 0 },
      { linehaulCents: 100_000, accessorialCents: 5_000 },
    )
    expect(change?.totalRevenueCents).toBe(105_000)
  })
})
