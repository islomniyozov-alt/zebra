import { describe, expect, it } from 'vitest'
import { rateThatWouldLand, tripRowView } from '@/lib/trips-preview'
import type { PlannedTrip } from '@/lib/trips-import'

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
  addsActuals: 'adds actual times',
  marksDelivered: 'marks delivered',
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
        hasStops: false,
        hasMiles: false,
        hasRate: true,
        hasActuals: true,
        isDelivered: false,
      } as never).rate,
    ).toBe('—')
  })

  it('is shown the figure when the load carries none yet', () => {
    expect(
      view(true, {}, {
        action: 'enrich',
        hasStops: false,
        hasMiles: false,
        hasRate: false,
        hasActuals: true,
        isDelivered: false,
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
    const { rate, ...rest } = withMoney
    expect(rate).toBeDefined()
    expect(without).toEqual(rest)
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
        hasStops: true,
        hasMiles: true,
        hasRate: true,
        hasActuals: true,
        isDelivered: false,
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

  const enrich = (over: { hasActuals?: boolean; isDelivered?: boolean }) =>
    tripRowView(
      ran(),
      {
        action: 'enrich',
        hasStops: true,
        hasMiles: true,
        hasRate: true,
        hasActuals: over.hasActuals ?? false,
        isDelivered: over.isDelivered ?? false,
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
        hasStops: true,
        hasMiles: true,
        hasRate: true,
        hasActuals: false,
        isDelivered: true,
      },
      [],
      LABELS,
      { maySeeMoney: false, locale: 'en-US' },
    )
    expect(row.actionDetail).not.toContain('adds actual times')
  })
})
