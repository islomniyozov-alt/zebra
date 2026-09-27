import { describe, expect, it } from 'vitest'
import {
  filesAsDelivered,
  rateThatWouldLand,
  stageSentence,
  tripRowView,
  type TripWriteView,
} from '@/lib/trips-preview'
import { planTrips, type PlannedTrip } from '@/lib/trips-import'
import type { TripLeg } from '@/lib/trips-csv'

// ---------------------------------------------------------------------------
// THE MONEY WALL ON THE PREVIEW, ASSERTED IN BOTH DIRECTIONS.
//
// §1.3: a field a role cannot see is ABSENT FROM THE PAYLOAD, never hidden in
// CSS. So the test that matters is not "the column is missing" — it is that
// the OBJECT has no `rate` key, because a key sent to a browser is sent
// whatever the table chooses to draw.
//
// And the other direction is not decoration: a wall nobody has watched let the
// right person through is a wall that might be refusing everyone.
// ---------------------------------------------------------------------------

const LABELS = {
  create: 'books a new load',
  unchanged: 'already has its stops and mileage',
  addsStops: 'adds stops',
  addsMiles: 'adds mileage',
  cancelled: 'load is cancelled — skipped',
  addsActuals: 'adds actual times',
  marksDelivered: 'marks delivered',
  closedHistory: 'closed history — untouched',
  seatsCrew: 'seats the crew',
  driver: 'driver',
  truck: 'truck',
  matchesNobody: 'matches nobody',
  matchesTwo: 'matches two',
  fileDisagrees: 'the file names two',
  rateFromRow: "the row's own cost",
  rateFromLegs: 'the legs added up',
}

const trip = (over: Partial<PlannedTrip> = {}): PlannedTrip => ({
  tripId: 'T-1165YNVHN',
  stops: [
    {
      sequence: 1,
      facilityCode: 'DEN7',
      legMiles: null,
      legEmpty: null,
      referenceNumber: null,
      plannedArrival: null,
      plannedDeparture: null,
      actualArrival: null,
      actualDeparture: null,
    },
    {
      sequence: 2,
      facilityCode: 'MKC6',
      legMiles: 583,
      legEmpty: false,
      referenceNumber: '1165YNVHN',
      plannedArrival: null,
      plannedDeparture: null,
      actualArrival: null,
      actualDeparture: null,
    },
  ],
  totalMiles: 583,
  emptyMiles: 0,
  driverNames: ['A DRIVER'],
  trailerIds: ['HV1'],
  tractorIds: ['ZP1'],
  cancelledLegs: 0,
  stage: 'finished' as const,
  rateCents: 508907,
  // The reading the owner verified against the Relay portal, on this very trip.
  rateBasis: 'load_row',
  ...over,
})

const view = (
  maySeeMoney: boolean,
  over: Partial<PlannedTrip> = {},
  write = { action: 'create' as const },
) =>
  tripRowView(trip(over), write, [], LABELS, { maySeeMoney, locale: 'en-US' })

describe('a confirmer who may see money', () => {
  // THE VERIFIED FIGURE. Trip 1165YNVHN reads $5,089.07 in the Relay portal.
  it('is shown what will land', () => {
    expect(view(true).rate).toBe('$5,089.07')
  })

  it('is shown a dash when the trip has no price to write', () => {
    // Multi-leg: planTrips refused to call the per-leg allocation a rate.
    expect(view(true, { rateCents: null }).rate).toBe('—')
  })

  // ENRICHMENT ADDS AND NEVER REPLACES, so a load that already carries money
  // will not be touched — and the preview must not imply otherwise.
  it('is shown a dash when the load already carries a rate', () => {
    expect(
      view(true, {}, {
        action: 'enrich',
        isClosedHistory: false,
        hasDriver: false,
        hasTruck: false,
        hasStops: false,
        hasMiles: false,
        hasRate: true,
        hasActuals: true,
        isDelivered: false,
        isCancelled: false,
      } as never).rate,
    ).toBe('—')
  })

  it('is shown the figure when the load carries none yet', () => {
    expect(
      view(true, {}, {
        action: 'enrich',
        isClosedHistory: false,
        hasDriver: false,
        hasTruck: false,
        hasStops: false,
        hasMiles: false,
        hasRate: false,
        hasActuals: true,
        isDelivered: false,
        isCancelled: false,
      } as never).rate,
    ).toBe('$5,089.07')
  })
})

describe('a confirmer who may not see money', () => {
  // ABSENT, NOT EMPTY. `toBeUndefined` would also pass for `rate: undefined`,
  // which is a key that was sent; `in` is the question §1.3 actually asks.
  it('gets an object with no rate key at all', () => {
    const row = view(false)
    expect('rate' in row).toBe(false)
    expect(JSON.stringify(row)).not.toContain('5089')
    expect(JSON.stringify(row)).not.toContain('5,089')
  })

  it('gets every other field unchanged', () => {
    const withMoney = view(true)
    const without = view(false)
    // BOTH MONEY KEYS COME OFF, and `rateBasis` is one of them: it is a
    // statement about how a figure was read, which is a statement about the
    // figure. A role that may not see the number may not be told it was a sum.
    const { rate, rateBasis, ...rest } = withMoney
    expect(rate).toBeDefined()
    expect(rateBasis).toBeDefined()
    expect(without).toEqual(rest)
    expect('rateBasis' in without).toBe(false)
  })
})

describe('what would land, decided once', () => {
  it('is the trip rate on a create', () => {
    expect(rateThatWouldLand(trip(), { action: 'create' })).toBe(508907)
  })

  it('is nothing when the trip has no rate', () => {
    expect(
      rateThatWouldLand(trip({ rateCents: null }), { action: 'create' }),
    ).toBeNull()
  })

  it('is nothing when the load already has one', () => {
    expect(
      rateThatWouldLand(trip(), {
        action: 'enrich',
        isClosedHistory: false,
        hasDriver: false,
        hasTruck: false,
        hasStops: true,
        hasMiles: true,
        hasRate: true,
        hasActuals: true,
        isDelivered: false,
        isCancelled: false,
      }),
    ).toBeNull()
  })
})

describe('the preview says what a Finished re-import will do', () => {
  // A trip that RAN: check-ins on its stops and every leg Completed.
  const ran = () =>
    trip({
      stage: 'finished',
      stops: [
        {
          sequence: 1,
          facilityCode: 'DEN7',
          legMiles: null,
          legEmpty: null,
          referenceNumber: null,
          plannedArrival: {
            date: '2026-08-24',
            time: '04:41',
            utcOffsetHours: -6,
          },
          plannedDeparture: null,
          actualArrival: {
            date: '2026-08-24',
            time: '07:17',
            utcOffsetHours: -6,
          },
          actualDeparture: null,
        },
      ],
    })

  const enrich = (over: {
    hasActuals?: boolean
    isDelivered?: boolean
    isCancelled?: boolean
  }) =>
    tripRowView(
      ran(),
      {
        action: 'enrich',
        isClosedHistory: false,
        hasDriver: false,
        hasTruck: false,
        hasStops: true,
        hasMiles: true,
        hasRate: true,
        hasActuals: over.hasActuals ?? false,
        isDelivered: over.isDelivered ?? false,
        isCancelled: over.isCancelled ?? false,
      },
      [],
      LABELS,
      { maySeeMoney: false, locale: 'en-US' },
    )

  // THE LIVE SYMPTOM. A load booked from an Upcoming export has stops and
  // mileage, so this used to read "already has its stops and mileage" — and a
  // dispatcher who believed it would never have imported the file again.
  it('does not call a load with unread check-ins complete', () => {
    const row = enrich({})
    expect(row.action).toBe('enrich')
    expect(row.actionDetail).toContain('adds actual times')
    expect(row.actionDetail).toContain('marks delivered')
    expect(row.actionDetail).not.toContain('already has')
  })

  // AND A DISPATCHER IS TOLD BEFORE CONFIRMING, not after. Moving a load to
  // Delivered puts it in front of the invoice queue; an import that did that
  // silently would be changing money-adjacent state unannounced.
  it('announces the status change as part of the sentence', () => {
    expect(enrich({}).actionDetail).toContain('marks delivered')
  })

  it('offers nothing once the times and the status are both there', () => {
    const row = enrich({ hasActuals: true, isDelivered: true })
    expect(row.action).toBe('unchanged')
    expect(row.actionDetail).toBe(LABELS.unchanged)
  })

  // A trip with no check-ins in the file has nothing to add, whatever its
  // legs say — the preview must not promise times that are not there.
  it('promises no actuals when the export carries none', () => {
    const row = tripRowView(
      trip({ stage: 'finished' }),
      {
        action: 'enrich',
        isClosedHistory: false,
        hasDriver: false,
        hasTruck: false,
        hasStops: true,
        hasMiles: true,
        hasRate: true,
        hasActuals: false,
        isDelivered: true,
        isCancelled: false,
      },
      [],
      LABELS,
      { maySeeMoney: false, locale: 'en-US' },
    )
    expect(row.actionDetail).not.toContain('adds actual times')
  })

  describe('a cancelled load is skipped and said so', () => {
    // Load 1010 / T-115GY4TBD: booked, delivered by hand, then CANCELLED by
    // hand, then the Completed export re-imported. The preview promised "adds
    // actual times" while the only change it could still make — the status move
    // — was the one `transitionOperational` refuses on a cancelled load.
    it('reads as cancelled rather than as an enrich', () => {
      const row = enrich({ isCancelled: true })
      expect(row.action).toBe('cancelled')
      expect(row.actionDetail).toBe(LABELS.cancelled)
    })

    it('promises nothing at all — not actuals, not delivery', () => {
      const row = enrich({ isCancelled: true })
      expect(row.actionDetail).not.toContain('adds actual times')
      expect(row.actionDetail).not.toContain('marks delivered')
    })

    // NOT FOLDED INTO "already complete". A cancelled load counted as unchanged
    // would read as freight that needs nothing, when it is freight somebody
    // stopped — a different sentence and a different decision.
    it('is not the same verdict as an untouched complete load', () => {
      expect(enrich({ isCancelled: true }).action).not.toBe(
        enrich({ hasActuals: true, isDelivered: true }).action,
      )
    })
  })
})

// ---------------------------------------------------------------------------
// THE CREATE ROW SAYS WHAT THE CREATE WILL DO.
//
// `createTripLoad` used to leave every load BOOKED, so "to book" was true of a
// finished trip too. It reads `trip.stage` now and lands a Completed export
// delivered on the first import — at which point the unchanged preview row was
// describing the old write. A preview that understates is the same defect as
// one that overstates: the sentence a dispatcher confirms has to be the
// sentence the writer performs.
// ---------------------------------------------------------------------------

describe('a create row from a completed export', () => {
  it('says it will book the load AND mark it delivered', () => {
    expect(view(true, { stage: 'finished' }).actionDetail).toBe(
      'books a new load, marks delivered',
    )
  })

  it('says only "to book" for a trip that has not run', () => {
    expect(view(true, { stage: 'upcoming' }).actionDetail).toBe(
      'books a new load',
    )
    expect(view(true, { stage: 'running' }).actionDetail).toBe(
      'books a new load',
    )
  })
})

// ---------------------------------------------------------------------------
// THE SENTENCE THE OWNER ASKED FOR, ASSERTED WORD FOR WORD.
//
// "3 trips: 1 books, 1 in transit, 1 files as delivered" is the whole preview
// in one line, and it is the kind of thing that rots silently: nothing breaks
// if a stage goes missing, the order flips, or a synonym creeps back in. It
// lived as three .replace() calls inside a form component, where the only way
// to check it was to read it.
// ---------------------------------------------------------------------------
describe('the preview sentence', () => {
  const labels = {
    previewTrip: '{n} trip:',
    previewTrips: '{n} trips:',
    stageUpcoming: '{n} books',
    stageRunning: '{n} in transit',
    stageFinished: '{n} files as delivered',
  }

  it("prints the owner's sentence exactly", () => {
    expect(
      stageSentence(3, { upcoming: 1, running: 1, finished: 1 }, labels),
    ).toBe('3 trips: 1 books, 1 in transit, 1 files as delivered')
  })

  it('runs in the order the freight does, not the order of the counts', () => {
    const said = stageSentence(
      9,
      { finished: 5, upcoming: 3, running: 1 },
      labels,
    )
    expect(said.indexOf('books')).toBeLessThan(said.indexOf('in transit'))
    expect(said.indexOf('in transit')).toBeLessThan(said.indexOf('delivered'))
  })

  it('omits a stage with nothing in it rather than printing a zero', () => {
    // "0 in transit" is a fact nobody asked for, and three of them bury the
    // one number that matters.
    expect(
      stageSentence(4, { upcoming: 0, running: 0, finished: 4 }, labels),
    ).toBe('4 trips: 4 files as delivered')
  })

  it('says "1 trip:" rather than "1 trips:"', () => {
    expect(
      stageSentence(1, { upcoming: 0, running: 1, finished: 0 }, labels),
    ).toBe('1 trip: 1 in transit')
  })

  it('never says "still running" again', () => {
    // The synonym this replaced. A screen inventing a fourth word for a state
    // the tracker, the badge and the dispatcher already agree on makes the
    // reader translate before they can decide.
    const said = stageSentence(
      2,
      { upcoming: 0, running: 2, finished: 0 },
      labels,
    )
    expect(said).not.toContain('running')
    expect(said).toContain('in transit')
  })
})

// ---------------------------------------------------------------------------
// THE ESCAPE HATCH IS A GROUPING, NOT A SECOND IMPORTER.
// ---------------------------------------------------------------------------
describe('one load per row', () => {
  const leg = (tripId: string, loadId: string): TripLeg => ({
    tripId,
    loadId,
    facilitySequence: 'DEN7->MKC6',
    status: 'Completed',
    distance: 100,
    costCents: null,
    distanceUnit: 'mi',
    shipperAccount: 'Outbound',
    driverName: '',
    trailerId: '',
    tractorId: '',
    stops: [],
  })

  const legs = [
    leg('T-1', 'L-A'),
    leg('T-1', 'L-B'),
    leg('T-1', 'L-C'),
    leg('T-2', 'L-D'),
  ]

  it('groups by trip by default — four rows, two loads', () => {
    expect(planTrips(legs).trips.map((t) => t.tripId)).toEqual(['T-1', 'T-2'])
  })

  it('groups by row when asked — four rows, four loads', () => {
    // The number the hatch prints: "4 loads instead of 2".
    expect(planTrips(legs, 'row').trips.map((t) => t.tripId)).toEqual([
      'L-A',
      'L-B',
      'L-C',
      'L-D',
    ])
  })

  it('reads the same file both ways without reparsing it', () => {
    // Same legs in, both groupings out: the readings cannot drift apart,
    // because there is only one parse and one planner behind both.
    expect(planTrips(legs).trips).toHaveLength(2)
    expect(planTrips(legs, 'row').trips).toHaveLength(4)
  })
})

// ---------------------------------------------------------------------------
// WHAT THE IMPORT WOULD FILE AS DELIVERED — ONE READER FOR THE ROW AND THE COUNT.
//
// The count first searched `actionDetail` for the translated label, which is a
// second reader of the same fact in disguise: it breaks on a translation, a
// moved comma, or a label that is a substring of another — and it breaks into a
// wrong NUMBER rather than an error. Both call this now.
// ---------------------------------------------------------------------------

describe('what would be filed as delivered', () => {
  const enrichWrite = (
    over: Partial<Extract<TripWriteView, { action: 'enrich' }>> = {},
  ) => ({
    action: 'enrich' as const,
    hasStops: true,
    hasMiles: true,
    hasRate: true,
    hasActuals: false,
    isDelivered: false,
    isCancelled: false,
    isClosedHistory: false,
    hasDriver: false,
    hasTruck: false,
    ...over,
  })

  it('files a finished trip on a create', () => {
    expect(
      filesAsDelivered(trip({ stage: 'finished' }), { action: 'create' }),
    ).toBe(true)
  })

  it('does not file a trip that has not finished', () => {
    expect(
      filesAsDelivered(trip({ stage: 'running' }), { action: 'create' }),
    ).toBe(false)
    expect(filesAsDelivered(trip({ stage: 'upcoming' }), enrichWrite())).toBe(
      false,
    )
  })

  it('files a finished trip whose load is not there yet', () => {
    expect(filesAsDelivered(trip({ stage: 'finished' }), enrichWrite())).toBe(
      true,
    )
  })

  it('does not file a load already at or past delivered', () => {
    expect(
      filesAsDelivered(
        trip({ stage: 'finished' }),
        enrichWrite({ isDelivered: true }),
      ),
    ).toBe(false)
  })

  // ── THE TWO REFUSALS ARE NOT DELIVERIES ─────────────────────────────────
  // `enrichLoad` returns before the landing for both, so counting them would
  // promise a status move that cannot happen.
  it('does not file a cancelled load', () => {
    expect(
      filesAsDelivered(
        trip({ stage: 'finished' }),
        enrichWrite({ isCancelled: true }),
      ),
    ).toBe(false)
  })

  it('does not file closed history', () => {
    expect(
      filesAsDelivered(
        trip({ stage: 'finished' }),
        enrichWrite({ isClosedHistory: true }),
      ),
    ).toBe(false)
  })
})

describe('the crew on the row', () => {
  const seated = (driverId: string | null, truckId: string | null) => ({
    kind: 'seated' as const,
    driverId,
    truckId,
  })

  it('says it seats the crew, and names the labels it used', () => {
    const row = tripRowView(
      trip({ stage: 'finished' }),
      { action: 'create' },
      [],
      LABELS,
      { maySeeMoney: false, locale: 'en-US' },
      seated('drv_1', 'trk_1'),
    )
    expect(row.seatsCrew).toBe(true)
    expect(row.actionDetail).toContain('seats the crew')
    expect(row.crewRefusals).toEqual([])
  })

  // THE PREVIEW MUST NOT PROMISE A WRITE THAT WILL NOT HAPPEN. Same defect as
  // showing the file's rate beside a load that already carries money.
  it('does not claim to seat a crew into seats that are already full', () => {
    const row = tripRowView(
      trip({ stage: 'finished' }),
      {
        action: 'enrich',
        hasStops: true,
        hasMiles: true,
        hasRate: true,
        hasActuals: true,
        isDelivered: true,
        isCancelled: false,
        isClosedHistory: false,
        hasDriver: true,
        hasTruck: true,
      },
      [],
      LABELS,
      { maySeeMoney: false, locale: 'en-US' },
      seated('drv_1', 'trk_1'),
    )
    expect(row.seatsCrew).toBe(false)
    expect(row.actionDetail).not.toContain('seats the crew')
  })

  it('does not seat a live trip, whatever the file says', () => {
    const row = tripRowView(
      trip({ stage: 'running' }),
      { action: 'create' },
      [],
      LABELS,
      { maySeeMoney: false, locale: 'en-US' },
      seated('drv_1', 'trk_1'),
    )
    expect(row.seatsCrew).toBe(false)
  })

  // REFUSALS BY NAME, which is the ruling's word. A count tells a dispatcher
  // there is a problem; the name tells them which roster row to add.
  it('reports a refusal with the column, the file’s own text and the reason', () => {
    const row = tripRowView(
      trip({ stage: 'finished' }),
      { action: 'create' },
      [],
      LABELS,
      { maySeeMoney: false, locale: 'en-US' },
      {
        kind: 'refused',
        reasons: [
          {
            column: 'driver',
            value: '  JULIA  ROSE HALL ',
            why: 'matches_nobody',
          },
          { column: 'truck', value: '1024', why: 'matches_two' },
        ],
      },
    )
    expect(row.seatsCrew).toBe(false)
    // EXACTLY AS THE FILE WROTE IT — that is the string somebody searches the
    // export for. `nameKey` normalises for matching, never for reporting.
    expect(row.crewRefusals[0]).toBe(
      'driver “  JULIA  ROSE HALL ”: matches nobody',
    )
    expect(row.crewRefusals[1]).toBe('truck “1024”: matches two')
  })
})
