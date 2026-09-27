import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  chooseExport,
  coDriverSeat,
  terminatedYieldsToTruck,
  crewFillFor,
  datatruckCents,
  importEventAt,
  otherPayDecision,
  parseDatatruckMoment,
  planLoads,
  readEquipment,
  readPlace,
  rateChangeFor,
  rateFreezeFor,
  readStatus,
  closeIfStale,
  DATATRUCK_CUTOVER,
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
  /** A day before the books cutover, and a day after it. */
  const beforeBooks = new Date('2026-09-12T23:59:59.000Z')
  const afterBooks = new Date('2026-09-13T00:00:00.000Z')

  // ── THE GUARD NAMED "pre-cutover never live" ────────────────────────
  it('files a finished row delivered BEFORE the cutover as closed history', () => {
    for (const word of ['delivered', 'invoiced', 'paid']) {
      const reading = readStatus(word, beforeBooks)
      expect(reading?.billing).toBe('CLOSED_IN_DATATRUCK')
      expect(reading?.operational).toBe('DELIVERED')
      expect(reading?.closed).toBe(true)
    }
  })

  // ── THE GUARD NAMED "post-cutover never closed" ─────────────────────
  it('files a finished row delivered ON OR AFTER the cutover as LIVE', () => {
    // POD_RECEIVED rather than DELIVERED, because `settleableWhere` selects
    // on that status AND an event of it. UNINVOICED because Zebra is going
    // to invoice it.
    for (const word of ['delivered', 'invoiced', 'paid']) {
      const reading = readStatus(word, afterBooks)
      expect(reading?.billing).toBe('UNINVOICED')
      expect(reading?.operational).toBe('POD_RECEIVED')
      expect(reading?.closed).toBe(false)
    }
  })

  it('is INCLUSIVE of the cutover day itself', () => {
    // The constant is midnight UTC on the 13th, and the 13th is the first
    // day of the week Zebra settles. An exclusive boundary would post that
    // day's freight to nobody.
    expect(readStatus('delivered', afterBooks)?.closed).toBe(false)
    expect(
      readStatus('delivered', new Date(afterBooks.getTime() - 1))?.closed,
    ).toBe(true)
  })

  // ── GUARD (b) AGAIN, THROUGH THE OTHER DOOR ─────────────────────────
  it('does not let closeIfStale close a load the books own', () => {
    // A load picked up in July 2025 and delivered inside the settled week is
    // Zebra’s. `closeIfStale` closes an OPEN row older than DATATRUCK_CUTOVER,
    // and without `booksOwn` it would close this one as stale — “post-cutover
    // never closed” failing by a route that has nothing to do with readStatus.
    const live = readStatus('delivered', afterBooks)!
    const stale = closeIfStale(live, new Date('2025-07-01T00:00:00.000Z'))
    expect(stale.billing).toBe('UNINVOICED')
    expect(stale.closed).toBe(false)
    expect(stale.booksOwn).toBe(true)
  })

  it('files an UNDATED finished row as history', () => {
    // Not a guess the other way: `importEventAt` refuses to stamp a POD
    // without a date, so calling it live would produce a live load that can
    // never settle and never says why.
    expect(readStatus('delivered', null)?.closed).toBe(true)
    expect(readStatus('delivered', null)?.billing).toBe('CLOSED_IN_DATATRUCK')
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
      // The date is irrelevant for a row that has not finished: the split
      // only touches delivered, invoiced and paid.
      const reading = readStatus(word, afterBooks)
      expect(reading?.billing).toBe('UNINVOICED')
      expect(reading?.closed).toBe(false)
      const pre = readStatus(word, beforeBooks)
      expect(pre?.billing).toBe('UNINVOICED')
      expect(pre?.closed).toBe(false)
    }
  })

  it('marks a cancellation cancelled and closed', () => {
    expect(readStatus('canceled', afterBooks)).toEqual({
      operational: 'BOOKED',
      billing: 'CLOSED_IN_DATATRUCK',
      cancelled: true,
      closed: true,
      // A CANCELLATION IS NEVER THE BOOKS’, whatever its delivery date says:
      // nothing will be invoiced for freight that did not happen.
      booksOwn: false,
    })
  })

  it('refuses a status it has no counterpart for', () => {
    expect(readStatus('teleported', afterBooks)).toBeNull()
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

  // ── THE SECOND SEAT ──────────────────────────────────────────────
  //
  // `Co-Driver` is column 7 of the export, right after `Driver/Carrier`.
  // 1,136 of the 14,451 rows in loads-and-trips_2026_09_08 carry one.
  it('keeps the raw co-driver too, when the export names one', () => {
    const [load] = planLoads([row({ 'Co-Driver': 'JULIA HALL' })]).planned
    expect(load?.coDriverName).toBe('JULIA HALL')
  })

  it('leaves it null on a solo load, not an empty string', () => {
    // THE PAIR. Null is what makes `coDriverId != null` mean 'team'; an
    // empty string resolved to nothing would still read as a second seat to
    // anything checking presence rather than truthiness.
    const [load] = planLoads([row()]).planned
    expect(load?.coDriverName).toBeNull()
  })

  it('keeps a CARRIER in that column verbatim, for the seed to fail to resolve', () => {
    // Many of the real values are not people: '7 Star', 'Said truck 3609'.
    // Parsing does not judge — the seed resolves names to drivers and simply
    // does not set a co-driver when the name lands on none.
    const [load] = planLoads([row({ 'Co-Driver': '7 Star' })]).planned
    expect(load?.coDriverName).toBe('7 Star')
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
    booksOwn = false,
  ) => ({ operational, billing, booksOwn })

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

  // CLOSED IS STILL FINAL FOR EVERYTHING BUT ONE CASE. An open export row
  // does not reopen finished history — which is the bug the first version of
  // the 2026-09-24 narrowing would have shipped, because it keyed on
  // `closed === false` and an open row is also not closed.
  it('leaves a closed load alone for any row the books do not own', () => {
    const decision = syncDecisionFor(
      at('DELIVERED', 'CLOSED_IN_DATATRUCK'),
      at('BOOKED', 'UNINVOICED'),
    )
    expect(decision).toEqual({ operational: null, billing: null, notes: [] })
  })

  // ── THE GUARD NAMED "re-run reclassifies idempotently" ──────────────
  it('REOPENS a load the books now own, and only then', () => {
    // Production holds loads closed by the pre-cutover rule, because that
    // is all the old `readStatus` could say. Some are delivered on or after
    // `BOOKS_CUTOVER`, and a re-import has to correct that or the first
    // settled week is missing freight nobody can find.
    const reopened = syncDecisionFor(
      at('DELIVERED', 'CLOSED_IN_DATATRUCK'),
      at('POD_RECEIVED', 'UNINVOICED', true),
    )
    expect(reopened.billing).toBe('UNINVOICED')
    expect(reopened.operational).toBe('POD_RECEIVED')
    expect(reopened.notes.join()).toContain('reopened')
  })

  it('and a SECOND run changes nothing — idempotent', () => {
    // The reopened load is now live, so the next export finds it already
    // where it belongs and the ranks do the rest. A reopen that fired twice
    // would write an event per run for freight that had not moved.
    const again = syncDecisionFor(
      at('POD_RECEIVED', 'UNINVOICED'),
      at('POD_RECEIVED', 'UNINVOICED', true),
    )
    expect(again).toEqual({ operational: null, billing: null, notes: [] })
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

// ---------------------------------------------------------------------------
// AN OPEN ROW TOO OLD TO BE LIVE IS FINISHED HISTORY, WHATEVER IT SAYS.
//
// ── THE MEASUREMENT, 2026-09-10 ──────────────────────────────────────────
//
// Production carried 54 imported loads in BOOKED, DISPATCHED or IN_TRANSIT
// with pickups back to 2024-12-01, and the 2026-09-08 export still calls every
// one of them booked, dispatched, assigned or in_transit. None delivered — so
// the forward-only sync would never advance them and they would sit open
// forever, each one a load this system could be asked to settle and each one
// blocking the drivers seed's date guard.
//
// Clearing them by hand without this rule means finding sixty more after the
// next export, which is the owner's phrasing and the reason the fix ships in
// the same batch as the clear-out.
// ---------------------------------------------------------------------------
describe('an open row older than the cutover', () => {
  const before = new Date('2025-06-06T00:00:00.000Z')
  const after = new Date('2026-08-02T00:00:00.000Z')

  it('closes on the billing axis and leaves the operational one alone', () => {
    const dispatched = readStatus('dispatched', null)!
    const stale = closeIfStale(dispatched, before)

    expect(stale.billing).toBe('CLOSED_IN_DATATRUCK')
    expect(stale.closed).toBe(true)
    // THE HONEST RECORD OF WHAT HAPPENED TO IT. A load that was dispatched and
    // never delivered stays DISPATCHED; only responsibility for the money
    // moves.
    expect(stale.operational).toBe('DISPATCHED')
    // AND IT IS NOT CANCELLED. Cancelling would assert the freight did not
    // happen — a claim about the world rather than about whose books it is on,
    // and several of these carry a driver, a truck and real revenue.
    expect(stale.cancelled).toBe(false)
  })

  // THE OTHER BRANCH, WATCHED. A rule that closed everything would pass the
  // assertion above just as happily.
  it('leaves freight after the cutover exactly as it was read', () => {
    const dispatched = readStatus('dispatched', null)!
    expect(closeIfStale(dispatched, after)).toEqual(dispatched)
    expect(closeIfStale(readStatus('booked', null)!, after).closed).toBe(false)
  })

  it('leaves an undated row alone rather than guessing at its age', () => {
    const booked = readStatus('booked', null)!
    expect(closeIfStale(booked, null)).toEqual(booked)
    expect(closeIfStale(booked, new Date('nonsense'))).toEqual(booked)
  })

  // ALREADY CLOSED IS UNTOUCHED, including a cancelled row — whose `cancelled`
  // flag must survive, since this rule must never be the thing that decides
  // freight did not happen.
  it('changes nothing about a row that is already finished', () => {
    // NULL, so every one of these is on the history side of the books
    // cutover — which is what "already finished" means here. The post-cutover
    // case is the opposite claim and has its own test above: `closeIfStale`
    // must leave a load the books own alone rather than close it as stale.
    for (const word of ['delivered', 'invoiced', 'paid', 'canceled']) {
      const reading = readStatus(word, null)!
      expect(closeIfStale(reading, before)).toEqual(reading)
    }
    expect(closeIfStale(readStatus('canceled', null)!, before).cancelled).toBe(
      true,
    )
  })

  // THE BOUNDARY ITSELF. A pickup exactly at the cutover is covered by the pay
  // rules, so it is live — off-by-one here would close a day of real freight.
  it('treats the cutover day itself as live', () => {
    const booked = readStatus('booked', null)!
    expect(closeIfStale(booked, DATATRUCK_CUTOVER).closed).toBe(false)
    expect(
      closeIfStale(booked, new Date(DATATRUCK_CUTOVER.getTime() - 1)).closed,
    ).toBe(true)
  })
})

// ── THE TAGS COLUMN ────────────────────────────────────────────────────
//
// Free text Datatruck writes comma-separated. Carried across so the fleet's
// own vocabulary survives the cutover rather than being retyped.
// ── THE ADD-MISSING CREW FILL (ruling of 2026-09-24) ───────────────────
describe('which seats a re-import may fill', () => {
  /** A map with one Aziz, one Julia, and two people called John Smith. */
  const resolve = (name: string) =>
    ({
      aziz: ['d-aziz'],
      julia: ['d-julia'],
      john: ['d-john-1', 'd-john-2'],
      nobody: [],
    })[name] ?? []

  const empty = { driverId: null, coDriverId: null }

  it('fills a null seat from a name that lands on exactly one driver', () => {
    expect(
      crewFillFor(empty, { driverName: 'aziz', coDriverName: null }, resolve),
    ).toEqual({ driverId: 'd-aziz' })
  })

  it('NEVER replaces a seat that is already filled', () => {
    // Either the first import resolved it or a dispatcher corrected it.
    // Both are newer truths than this file.
    expect(
      crewFillFor(
        { driverId: 'd-somebody', coDriverId: null },
        { driverName: 'aziz', coDriverName: null },
        resolve,
      ),
    ).toEqual({})
  })

  it('fills nothing from an AMBIGUOUS name, and names it', () => {
    // Two people called John Smith. A guess here is a wage paid to the
    // wrong person, so the load stays driverless and the report says why.
    expect(
      crewFillFor(empty, { driverName: 'john', coDriverName: null }, resolve),
    ).toEqual({ unresolvedDriverName: 'john' })
  })

  it('fills nothing from a name that matches NOBODY, and names it too', () => {
    expect(
      crewFillFor(empty, { driverName: 'nobody', coDriverName: null }, resolve),
    ).toEqual({ unresolvedDriverName: 'nobody' })
  })

  it('fills both seats when the export names two different people', () => {
    expect(
      crewFillFor(
        empty,
        { driverName: 'aziz', coDriverName: 'julia' },
        resolve,
      ),
    ).toEqual({ driverId: 'd-aziz', coDriverId: 'd-julia' })
  })

  it('REFUSES to put one person in both seats, filling both at once', () => {
    // THE CASE NO SOURCE GREP REACHES, and the whole reason this is one
    // function rather than two if-statements. The second seat is compared
    // against what the row WILL hold after the fill; two independent
    // checks would each see a null beside them, fill both, and the
    // database CHECK would fail the entire batch rather than one row.
    expect(
      crewFillFor(empty, { driverName: 'aziz', coDriverName: 'aziz' }, resolve),
    ).toEqual({ driverId: 'd-aziz' })
  })

  it('refuses the same person against a seat already filled', () => {
    expect(
      crewFillFor(
        { driverId: 'd-aziz', coDriverId: null },
        { driverName: null, coDriverName: 'aziz' },
        resolve,
      ),
    ).toEqual({})
  })

  it('is silent when the one hit is already the OTHER seat', () => {
    // Not unresolved, either: the person is on the load and the export is
    // describing the same crew the other way round. Reporting them as an
    // unresolved name would send somebody looking for a problem.
    expect(
      crewFillFor(
        { driverId: null, coDriverId: 'd-aziz' },
        { driverName: 'aziz', coDriverName: null },
        resolve,
      ),
    ).toEqual({})
  })

  it('does nothing at all when the export names nobody', () => {
    expect(
      crewFillFor(empty, { driverName: null, coDriverName: null }, resolve),
    ).toEqual({})
  })

  it('is what the seed actually calls', () => {
    // The rule is only closed if the writer uses it. The gap it closes was
    // a decision nobody had written down anywhere.
    const seed = readFileSync('scripts/seed-datatruck-loads.ts', 'utf8')
    expect(seed).toContain('crewFillFor(')
    expect(seed).toContain('driversFilled')
  })
})

// ── THE POD EVENT RULING (2026-09-24) ──────────────────────────────────
describe('when an imported load moved', () => {
  it('is the export\u2019s delivery date', () => {
    const at = new Date('2026-09-15T18:30:00.000Z')
    expect(importEventAt({ deliveryAt: at })).toEqual({
      kind: 'at',
      at,
    })
  })

  // ── THE GUARD NAMED "an event dated at import time" ──────────────────
  it('is NOT a date when the export gives none', () => {
    // AND THE TYPE IS WHY THIS MATTERS. `TransitionOptions.occurredAt` is
    // optional and `LoadStatusEvent.occurredAt` carries `@default(now())`,
    // so a null threaded through as `occurredAt: undefined` does not fail —
    // it silently writes exactly the event the ruling forbids. A union
    // cannot be passed by accident.
    expect(importEventAt({ deliveryAt: null })).toEqual({ kind: 'no-date' })
  })

  it('never reaches for the clock', () => {
    // The rule is three lines and has no way to invent a date. If it ever
    // grows one, it will be here.
    const lib = readFileSync('src/lib/datatruck/loads.ts', 'utf8')
    const rule = lib.slice(
      lib.indexOf('export function importEventAt'),
      lib.indexOf('export function rateFreezeFor'),
    )
    expect(rule).not.toContain('new Date()')
    expect(rule).not.toContain('Date.now')
  })

  // ── THE GUARD NAMED "a column write without an event" ────────────────
  it('has the importer transition rather than write the column', () => {
    // The failure this closes: `operationalStatus` set as a column value,
    // no operational event, and `settleableWhere` selecting on the event.
    // The load reads Delivered on every screen and appears in no pay week.
    const seed = readFileSync('scripts/seed-datatruck-loads.ts', 'utf8')
    // EVERY CALL, NOT ONE OF THEM. The first version of this asserted that a
    // dated call existed SOMEWHERE — and there are two call sites, the create
    // path and the sync path, so stripping the date from one left the
    // assertion satisfied. `watch-guard.mjs` reported THE BREAK DID NOT FIRE,
    // which is AGENTS.md’s “count the thing you are claiming, not a superset
    // of it” caught by the mechanism written for it.
    const calls = (seed.match(/transitionOperational\(/g) ?? []).length
    const dated = (seed.match(/occurredAt: when\.at/g) ?? []).length
    expect(calls).toBeGreaterThan(0)
    expect(dated).toBe(calls)
    expect(seed).toContain('DATATRUCK_EVENT_NOTE')

    // A FRESH LOAD LANDS AT A FLOOR. Creating it at its real status and
    // then asking for that status is the `unchanged` no-op that wrote
    // nothing — the trap `backfill-direct-pod.mjs` documents.
    expect(seed).not.toContain('operationalStatus: load.operational')
    expect(seed).toContain("operationalStatus: 'BOOKED'")

    // AND THE SYNC PATH TOO, which advanced a load an earlier run brought
    // in by writing the column straight.
    expect(seed).not.toContain(
      "data['operationalStatus'] = decision.operational",
    )
  })

  // ── THE GUARD NAMED "a repair on closed history" ─────────────────────
  it('has the repair refuse closed history, and COUNT what it refused', () => {
    const repair = readFileSync('scripts/repair-missing-pod-events.mjs', 'utf8')
    expect(repair).toContain('CLOSED_IN_DATATRUCK')

    // REFUSED IN JAVASCRIPT, NOT IN THE QUERY. A `WHERE` clause would make
    // the refusal invisible, and "it did nothing" would be
    // indistinguishable from "there was nothing to do" — on the one set
    // this script most obviously looks like it is for.
    expect(repair).toContain('const closed = candidates.filter')
    expect(repair).toContain('REFUSED by ruling')

    // And it never stamps a date it made up.
    expect(repair).toContain('NO DELIVERY DATE')
    expect(repair).not.toContain("now()', at")
  })

  it('keeps the repair dry by default', () => {
    const repair = readFileSync('scripts/repair-missing-pod-events.mjs', 'utf8')
    expect(repair).toContain('--apply')
    expect(repair).toContain('Mode:')
    // The write is behind the flag: the dry-run branch exits before it.
    expect(repair.indexOf('if (!apply)')).toBeLessThan(
      repair.indexOf('INSERT INTO "LoadStatusEvent"'),
    )
  })
})

describe('tags', () => {
  it('splits the column on commas and trims each one', () => {
    const [load] = planLoads([row({ Tags: 'hazmat, reefer ,  team ' })]).planned
    expect(load?.tags).toEqual(['hazmat', 'reefer', 'team'])
  })

  it('is an empty list when the column is blank', () => {
    // NOT NULL, NOT UNDEFINED. The column is NOT NULL with an empty-array
    // default, and a list that is sometimes absent is a list every caller has
    // to defend against.
    expect(planLoads([row()]).planned[0]?.tags).toEqual([])
  })

  it('collapses a tag written twice on one row', () => {
    const [load] = planLoads([row({ Tags: 'team,team' })]).planned
    expect(load?.tags).toEqual(['team'])
  })

  it('keeps a tag that is not comma-separated as one tag', () => {
    // Guessing a second separator would split a tag that legitimately
    // contains one.
    const [load] = planLoads([row({ Tags: 'east coast / midwest' })]).planned
    expect(load?.tags).toEqual(['east coast / midwest'])
  })

  // ── THE EXPORTER SPELLS IT BOTH WAYS ──────────────────────────────────
  it('reads the column when it is spelled `Tag`', () => {
    // The 2026-09-08 export says `Tags`; the 2026-09-24 re-export of the same
    // view says `Tag`. Reading one name meant the column was present in the
    // file and invisible to the importer — and a blank column and an unread
    // column look identical afterwards, which is why this went unnoticed for
    // a whole preview.
    const [load] = planLoads([row({ Tag: 'hazmat, team' })]).planned
    expect(load?.tags).toEqual(['hazmat', 'team'])
  })

  it('still reads it when it is spelled `Tags`', () => {
    const [load] = planLoads([row({ Tags: 'reefer' })]).planned
    expect(load?.tags).toEqual(['reefer'])
  })

  it('is empty when neither spelling is there', () => {
    // NOT a fallback over near-miss spellings: two exact names this exporter
    // has actually produced. A third stays invisible rather than guessed at.
    const [load] = planLoads([row({ Tagz: 'hazmat' })]).planned
    expect(load?.tags).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// WHEN THE EXPORT NAMES SOMEBODY WHO HAD ALREADY LEFT.
//
// The 2026-09-13..19 export put six loads on a driver terminated in June and
// four on one terminated in April, both on trucks linked to a different active
// driver. $10,549.89 held under two people with no pay rule while the two who
// hauled it got nothing.
// ---------------------------------------------------------------------------

describe('an export naming a terminated driver', () => {
  const JUNE = new Date('2026-06-25T00:00:00.000Z')
  const SEPT = new Date('2026-09-15T00:00:00.000Z')
  const MAY = new Date('2026-05-01T00:00:00.000Z')

  const gone = { id: 'drv_caner', name: 'CANER GUNAL', terminationDate: JUNE }
  const active = {
    id: 'drv_bener',
    name: 'GUNAL BENER',
    terminationDate: null,
    status: 'AVAILABLE',
    kind: 'PERSON',
  }

  it('YIELDS to the driver of the truck, and the note carries the original name', () => {
    const out = terminatedYieldsToTruck({
      named: gone,
      truckDriver: active,
      deliveredAt: SEPT,
      unitNumber: '0006',
    })
    expect(out.kind).toBe('yield')
    if (out.kind !== 'yield') return
    // THE ORIGINAL NAME IS THE POINT. A reattribution that does not record what
    // the export said leaves the load naming somebody the source never named.
    expect(out.note).toContain('CANER GUNAL')
    expect(out.note).toContain('GUNAL BENER')
    expect(out.note).toContain('2026-06-25')
    expect(out.note).toContain('0006')
  })

  // ── THE DATE IS WHAT MAKES IT A RULE AND NOT A SWEEP ──────────────────
  it('KEEPS the name for freight delivered BEFORE the termination', () => {
    // Freight they delivered in May is theirs. A rule that only asked "is this
    // driver terminated" would reassign their entire history to whoever holds
    // the truck now.
    expect(
      terminatedYieldsToTruck({
        named: gone,
        truckDriver: active,
        deliveredAt: MAY,
        unitNumber: '0006',
      }),
    ).toEqual({ kind: 'keep' })
  })

  it('KEEPS the name on the termination day itself', () => {
    // Their last day is a day they worked.
    expect(
      terminatedYieldsToTruck({
        named: gone,
        truckDriver: active,
        deliveredAt: JUNE,
        unitNumber: '0006',
      }),
    ).toEqual({ kind: 'keep' })
  })

  it('KEEPS the name when the driver was never terminated', () => {
    expect(
      terminatedYieldsToTruck({
        named: { ...gone, terminationDate: null },
        truckDriver: active,
        deliveredAt: SEPT,
        unitNumber: '0006',
      }),
    ).toEqual({ kind: 'keep' })
  })

  it('KEEPS the name when the truck has nobody linked', () => {
    // Nothing to yield to, and the preflight should still report the load.
    expect(
      terminatedYieldsToTruck({
        named: gone,
        truckDriver: null,
        deliveredAt: SEPT,
        unitNumber: '0006',
      }),
    ).toEqual({ kind: 'keep' })
  })

  it('KEEPS the name when the driver of the truck is ALSO gone', () => {
    // Reassigning would move the problem rather than fix it.
    expect(
      terminatedYieldsToTruck({
        named: gone,
        truckDriver: { ...active, terminationDate: JUNE },
        deliveredAt: SEPT,
        unitNumber: '0006',
      }),
    ).toEqual({ kind: 'keep' })
    expect(
      terminatedYieldsToTruck({
        named: gone,
        truckDriver: { ...active, status: 'INACTIVE' },
        deliveredAt: SEPT,
        unitNumber: '0006',
      }),
    ).toEqual({ kind: 'keep' })
  })

  it('KEEPS the name when the truck is linked to a REFERRAL PAYEE', () => {
    // A commission is not somebody who could have driven it.
    expect(
      terminatedYieldsToTruck({
        named: gone,
        truckDriver: { ...active, kind: 'PAYEE' },
        deliveredAt: SEPT,
        unitNumber: '0006',
      }),
    ).toEqual({ kind: 'keep' })
  })

  it('KEEPS the name when the export gave no delivery date', () => {
    // With no date there is no fact making the attribution impossible.
    expect(
      terminatedYieldsToTruck({
        named: gone,
        truckDriver: active,
        deliveredAt: null,
        unitNumber: '0006',
      }),
    ).toEqual({ kind: 'keep' })
  })

  it('KEEPS the name when the truck names the same driver', () => {
    expect(
      terminatedYieldsToTruck({
        named: gone,
        truckDriver: { ...active, id: gone.id },
        deliveredAt: SEPT,
        unitNumber: '0006',
      }),
    ).toEqual({ kind: 'keep' })
  })
})

// ---------------------------------------------------------------------------
// WHO SITS IN THE SECOND SEAT.
//
// Every one of these used to be a silent drop: the write decided, the preview
// never looked, and a co-driver who matched nobody left no trace.
// ---------------------------------------------------------------------------

describe('the second seat on an imported load', () => {
  const DRIVER = 'drv_julia'
  const CO = 'drv_haidar'

  it('fills the seat when the name resolves to exactly one other person', () => {
    expect(coDriverSeat('HAIDAR NIYOZOV', [CO], [DRIVER])).toEqual({
      kind: 'fill',
      driverId: CO,
    })
  })

  it('is no-name when the column is blank, which is most loads', () => {
    // Counted nowhere. A single-driver load is not a problem to report.
    expect(coDriverSeat(null, [], [DRIVER])).toEqual({ kind: 'no-name' })
  })

  it('REFUSES a name that matches nobody, rather than leaving no trace', () => {
    // `7 Star` and `Said truck 3609` are in the real column. It is free text
    // and the fleet writes notes in it.
    expect(coDriverSeat('7 Star', [], [DRIVER])).toEqual({ kind: 'unresolved' })
  })

  it('REFUSES a name that matches two people', () => {
    expect(coDriverSeat('J SMITH', ['drv_a', 'drv_b'], [DRIVER])).toEqual({
      kind: 'ambiguous',
    })
  })

  // ── NOBODY CREWS A LOAD TWICE ───────────────────────────────────────────
  it('REFUSES the driver in their own second seat, and says which case it is', () => {
    // NOT deduplicated into one seat: `settleableWhere` matches EITHER seat,
    // so a load carrying one person twice settles once and reads as a team run
    // forever. The database CHECK refuses it too — but a CHECK failure kills
    // the whole insert batch, so it is caught here where it can be counted.
    expect(coDriverSeat('JULIA ROSE HALL', [DRIVER], [DRIVER])).toEqual({
      kind: 'same-as-driver',
    })
  })

  it('fills the seat when the load has no driver at all', () => {
    // A co-driver with an empty first seat is odd but not contradictory, and
    // refusing it would drop a name for a reason nobody stated.
    expect(coDriverSeat('HAIDAR NIYOZOV', [CO], [])).toEqual({
      kind: 'fill',
      driverId: CO,
    })
  })

  // ── AND BOTH PATHS CALL IT ──────────────────────────────────────────────
  it('is what the seed uses for BOTH the preview and the write', () => {
    // The defect this replaced was two definitions: the write decided with an
    // inline condition and the preview did not look at all. One call site is
    // not enough — there must be one in the counting and one in the create.
    const seed = readFileSync('scripts/seed-datatruck-loads.ts', 'utf8')

    expect((seed.match(/coDriverSeat\(/g) ?? []).length).toBe(2)
    expect(seed).toContain('CO-DRIVER NAMES THAT RESOLVE TO NOTHING')
    expect(seed).toContain('CO-DRIVER NAMES THAT ARE THE DRIVER')
    // The inline condition must be gone, not merely bypassed.
    expect(seed).not.toContain('coDriverIds[0] !== driverIds[0]')
  })
})

// ---------------------------------------------------------------------------
// WHICH FILE THE IMPORTER READS.
//
// The rule this replaced dropped an argument it could not use and read the
// default export instead, which is a wrong answer wearing the right file's
// name. These are its four cases.
// ---------------------------------------------------------------------------

describe('which export the importer will read', () => {
  const DEFAULT = 'corpus/datatruck/loads-and-trips_2026_09_08_20_05_05.xlsx'

  // ── THE 2026-09-24 NEAR-MISS, AS A TEST ─────────────────────────────────
  it('REFUSES a CSV, and names it', () => {
    // The real file, verbatim. A Relay trips export landed in the Datatruck
    // folder for the first settled week, and the old predicate would have
    // ignored it and previewed the September 8 workbook instead.
    const csv = 'corpus/datatruck/Trips - 2026-09-24T090710.426.csv'
    const choice = chooseExport(['--production', csv], DEFAULT)

    expect(choice.kind).toBe('refuse')
    // NAMING IT IS THE POINT. A refusal that does not say which file was
    // rejected sends you looking at the flags.
    if (choice.kind === 'refuse') expect(choice.rejected).toEqual([csv])
  })

  it('names EVERY rejected file, not just the first', () => {
    const choice = chooseExport(['a.csv', 'b.xls', '--write'], DEFAULT)
    expect(choice.kind === 'refuse' && choice.rejected).toEqual([
      'a.csv',
      'b.xls',
    ])
  })

  it('reads the workbook it is given', () => {
    const named = 'corpus/datatruck/loads-and-trips_2026_09_22_08_00_00.xlsx'
    expect(chooseExport([named, '--production'], DEFAULT)).toEqual({
      kind: 'read',
      path: named,
    })
  })

  it('falls back to the default when only flags are passed', () => {
    // FLAGS ARE NOT FILES. `--production` and `--write` must be neither read
    // nor rejected, or the ritual arguments would refuse every run.
    expect(chooseExport(['--production', '--write'], DEFAULT)).toEqual({
      kind: 'read',
      path: DEFAULT,
    })
    expect(chooseExport([], DEFAULT)).toEqual({ kind: 'read', path: DEFAULT })
  })

  it('does not care how the extension is capitalised', () => {
    // A workbook saved by hand off a Windows share arrives as .XLSX, and
    // refusing it would be this rule failing in the unhelpful direction.
    expect(chooseExport(['WEEK.XLSX'], DEFAULT)).toEqual({
      kind: 'read',
      path: 'WEEK.XLSX',
    })
  })

  // ── AND THE SEED ACTUALLY CALLS IT ──────────────────────────────────────
  it('is what the seed actually uses to pick its file', () => {
    // The rule being right is worth nothing if the script still holds its own
    // copy of the old predicate. This is the shape of guard that caught the
    // undated POD event: assert against the source that calls it.
    const seed = readFileSync('scripts/seed-datatruck-loads.ts', 'utf8')

    expect(seed).toContain('chooseExport(process.argv.slice(2)')
    expect(seed).toContain("if (CHOICE.kind === 'refuse')")
    // The predicate it replaced must be gone, not merely unused.
    expect(seed).not.toContain("argument.endsWith('.xlsx')")
  })
})

// ---------------------------------------------------------------------------
// `Total other pay` THAT IS REALLY THE RATE AGAIN. Owner's ruling, 2026-09-27.
//
// Hold it as a duplicate of the cancellation fee when `Load pay` is above zero
// and Amazon's `LOAD - CANCELLED` for the reference equals it. Loud, never
// booked.
//
// THE CASE IT COMES FROM is `1138JCPWX` / DT-015371, one line of ST-005317:
// Load pay 137.82, Total other pay 137, Total pay 274.82, and Amazon remitted
// $137.82. One payment in two columns, added by the export's own total.
// ---------------------------------------------------------------------------

describe('the cancellation fee written twice', () => {
  // ── THE REAL ROW, WITH THE REAL FIGURES ─────────────────────────────────
  it('HOLDS the other pay when Amazon matches the rate', () => {
    const decision = otherPayDecision({
      loadPayCents: 13782,
      otherPayCents: 13700,
      cancellationCents: 13782,
    })
    expect(decision.kind).toBe('hold')
    if (decision.kind !== 'hold') return
    expect(decision.cents).toBe(13700)
    // THE REASON CARRIES ALL THREE FIGURES, because a reader deciding whether
    // the rule was right needs the two it compared and the one it dropped.
    expect(decision.reason).toContain('13782')
    expect(decision.reason).toContain('13700')
  })

  // ── THE 41 THE RULE MUST NOT TOUCH ──────────────────────────────────────
  //
  // A plain cancellation puts the whole fee in other pay with `Load pay 0`. That
  // is the load's ONLY money; holding it would pay the driver nothing for the
  // cancellation. Measured on dev: 41 of the 42 loads carrying both an Amazon
  // TONU and a Datatruck other-pay row are this shape.
  it('BOOKS the other pay when there is no rate beside it', () => {
    expect(
      otherPayDecision({
        loadPayCents: 0,
        otherPayCents: 17500,
        cancellationCents: 17500,
      }).kind,
    ).toBe('book')
  })

  // ── ORDINARY EXTRA PAY IS NOT A DUPLICATE ───────────────────────────────
  it('BOOKS detention or a layover on a load that also earned a rate', () => {
    expect(
      otherPayDecision({
        loadPayCents: 245000,
        otherPayCents: 15000,
        cancellationCents: null,
      }).kind,
    ).toBe('book')
  })

  // AND A CANCELLATION THAT DOES NOT MATCH THE RATE IS NOT THE RATE AGAIN.
  // Two different amounts are two different facts; the rule refuses to guess
  // which of them the other pay echoes.
  it('BOOKS it when Amazon disagrees with the rate', () => {
    expect(
      otherPayDecision({
        loadPayCents: 13782,
        otherPayCents: 13700,
        cancellationCents: 17500,
      }).kind,
    ).toBe('book')
  })

  // ── THE EQUALITY IS AGAINST `Load pay`, WHICH IS THE WHOLE DESIGN ────────
  //
  // Amazon sent $137.82 and the other-pay column says $137.00 — 82 cents apart,
  // because that column is a rounded re-typing. A rule keyed on the OTHER PAY
  // matching would never fire on the row that produced it, so this asserts the
  // choice rather than leaving it to be re-derived.
  it('does not require the other pay to equal the cancellation', () => {
    expect(
      otherPayDecision({
        loadPayCents: 13782,
        otherPayCents: 13700,
        cancellationCents: 13782,
      }).kind,
    ).toBe('hold')
    // …and the converse: matching the other pay is not sufficient on its own.
    expect(
      otherPayDecision({
        loadPayCents: 20000,
        otherPayCents: 13700,
        cancellationCents: 13700,
      }).kind,
    ).toBe('book')
  })

  // ── THE ONE INPUT THE `Load pay > 0` CLAUSE DECIDES ─────────────────────
  //
  // A zero cancellation total beside a zero rate. Without that clause `0 !== 0`
  // is false and the load's only money would be held; with it nothing is.
  //
  // THIS TEST EXISTS BECAUSE `watch-guard` REFUSED TO PASS WITHOUT IT. Breaking
  // the clause failed nothing — the equality below it caught every input the
  // suite had — so the clause was not known to do anything. It is the difference
  // between a guard and a comment.
  it('BOOKS when the cancellation total is zero and so is the rate', () => {
    expect(
      otherPayDecision({
        loadPayCents: 0,
        otherPayCents: 17500,
        cancellationCents: 0,
      }).kind,
    ).toBe('book')
  })

  it('BOOKS nothing to hold when the other pay is zero', () => {
    expect(
      otherPayDecision({
        loadPayCents: 13782,
        otherPayCents: 0,
        cancellationCents: 13782,
      }).kind,
    ).toBe('book')
  })
})

describe('the planner holds it and still imports the load', () => {
  const row = (over: Record<string, string> = {}) => ({
    'Shipment ID': 'DT-099001',
    'Load ID': '1138JCPWX',
    'MC Number': 'RAM Haulage LLC',
    // REQUIRED BY THE PLANNER — a row with no customer is held whole, which is
    // how the first version of this fixture reported zero planned loads and
    // looked like a failure of the rule under test.
    Customer: 'AMAZON LOGISTICS',
    'Load status': 'delivered',
    'Load pay': '137.82',
    'Total other pay': '137',
    'Total pay': '274.82',
    'PU date': 'Aug 16, 2026',
    'DEL date': 'Aug 16, 2026',
    'Pickup location': 'Greenfield, IN, 46140',
    'Delivery location': 'Fort Wayne, IN, 46818',
    ...over,
  })

  it('keeps the rate, drops the echo, and names the row', () => {
    const plan = planLoads([row()], {
      cancellationFeeFor: () => 13782,
    })

    // THE LOAD IS IMPORTED. The freight is real and the rate is right; one
    // accessorial was not booked. Reporting it as held would say the load is
    // missing when it is present and correct.
    expect(plan.planned).toHaveLength(1)
    expect(plan.held).toHaveLength(0)

    const load = plan.planned[0]!
    expect(load.linehaulCents).toBe(13782)
    expect(load.accessorialCents).toBe(0)
    // AND THE TOTAL FOLLOWS, which is the figure a settlement prices on.
    expect(load.totalRevenueCents).toBe(13782)

    // LOUD IN BOTH PLACES.
    expect(plan.duplicateOtherPay).toHaveLength(1)
    expect(plan.duplicateOtherPay[0]!.externalId).toBe('DT-099001')
    expect(load.corrections.join(' ')).toContain('duplicate')
  })

  // WITHOUT THE LOOKUP NOTHING CHANGES, which is what keeps every existing
  // caller — and every past import — reading exactly as it did.
  it('books the other pay when no cancellation figure is supplied', () => {
    const plan = planLoads([row()])
    expect(plan.planned[0]!.accessorialCents).toBe(13700)
    expect(plan.planned[0]!.totalRevenueCents).toBe(27482)
    expect(plan.duplicateOtherPay).toHaveLength(0)
  })

  // THE EXPORT'S OWN CROSS-CHECK STILL RUNS FIRST, against the columns as
  // printed. A row whose `Total pay` disagrees with its own parts is held whole,
  // and this rule never gets to see it — the two questions are not the same and
  // the order between them is deliberate.
  it('still refuses a row whose Total pay does not add up', () => {
    const plan = planLoads([row({ 'Total pay': '999.99' })], {
      cancellationFeeFor: () => 13782,
    })
    expect(plan.planned).toHaveLength(0)
    expect(plan.held).toHaveLength(1)
    expect(plan.duplicateOtherPay).toHaveLength(0)
  })
})
