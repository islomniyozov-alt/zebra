import { describe, expect, it } from 'vitest'
import {
  editedStops,
  plannedStop,
  stopFormValues,
  type StoredStop,
} from '@/lib/load-form'

// ---------------------------------------------------------------------------
// EDIT LOAD'S STOP ROUND TRIP (TMS §7.14 part 7, v11.60).
//
// The edit page fills the form through `stopFormValues`, and the save
// compares what came back against the same function. These pin the three
// cases: unchanged keeps the stored stop whole, a new clock is re-read in the
// stop's zone, a new place is resolved afresh.
// ---------------------------------------------------------------------------

const stop = (over: Partial<StoredStop> = {}): StoredStop => ({
  id: 's1',
  type: 'PICKUP',
  locationId: 'loc1',
  name: 'Springfield, OH',
  addressLine1: '1 Dock Rd',
  addressLine2: null,
  city: 'Springfield',
  state: 'OH',
  postalCode: '45505',
  appointmentType: 'APPOINTMENT',
  scheduledAt: null,
  windowStart: null,
  windowEnd: null,
  arrivedAt: new Date('2026-11-22T21:58:00Z'),
  departedAt: null,
  legMiles: 410,
  legEmpty: false,
  referenceNumber: 'PU-9',
  contactName: 'Dana',
  contactPhone: null,
  instructions: 'gate 4',
  location: { timezone: null, state: 'OH' },
  ...over,
})

describe('a stored stop, as the form shows it', () => {
  it('an appointment in the stop’s own zone (Ohio, Eastern)', () => {
    // 22:00 UTC is 17:00 EST on Nov 22.
    expect(
      stopFormValues(stop({ scheduledAt: new Date('2026-11-22T22:00:00Z') })),
    ).toEqual({
      id: 's1',
      place: 'Springfield, OH',
      type: 'PICKUP',
      date: '2026-11-22',
      from: '17:00',
      to: '',
    })
  })

  it('a date with no clock: midnight in the zone reads back as no clock', () => {
    // Midnight EST on Nov 22 is 05:00 UTC.
    expect(
      stopFormValues(stop({ scheduledAt: new Date('2026-11-22T05:00:00Z') })),
    ).toMatchObject({ date: '2026-11-22', from: '', to: '' })
  })

  it('a window: both clocks, the date of its start', () => {
    expect(
      stopFormValues(
        stop({
          windowStart: new Date('2026-11-21T08:31:00Z'),
          windowEnd: new Date('2026-11-22T05:58:00Z'),
          scheduledAt: new Date('2026-11-21T08:31:00Z'),
          location: { timezone: 'America/Chicago', state: 'WI' },
          state: 'WI',
        }),
      ),
    ).toMatchObject({ date: '2026-11-21', from: '02:31', to: '23:58' })
  })
})

describe('what an edit saves for each stop', () => {
  const window = stop({
    windowStart: new Date('2026-11-22T08:31:00Z'),
    // Two days later: a window the form's one date cannot express.
    windowEnd: new Date('2026-11-25T05:58:00Z'),
    scheduledAt: new Date('2026-11-22T08:31:00Z'),
    location: { timezone: 'America/Chicago', state: 'WI' },
    state: 'WI',
    name: 'Menomonie, WI',
  })

  it('unchanged keeps the stored stop whole — actuals, address and a multi-day window', () => {
    const [result] = editedStops([stopFormValues(window)], [window])
    expect(result).toMatchObject({
      kind: 'kept',
      input: {
        windowStart: window.windowStart,
        windowEnd: window.windowEnd,
        scheduledAt: window.scheduledAt,
        arrivedAt: window.arrivedAt,
        addressLine1: '1 Dock Rd',
        legMiles: 410,
        contactName: 'Dana',
      },
    })
  })

  it('a new clock is read in the stop’s zone, the place kept', () => {
    const shown = stopFormValues(window)
    const [result] = editedStops(
      [{ ...shown, from: '06:00', to: '' }],
      [window],
    )
    expect(result?.kind).toBe('kept')
    if (result?.kind !== 'kept') return
    // 06:00 CST on Nov 22 is 12:00 UTC.
    expect(result.input.scheduledAt).toEqual(new Date('2026-11-22T12:00:00Z'))
    expect(result.input.windowEnd).toBeNull()
    expect(result.input.locationId).toBe('loc1')
    expect(result.input.arrivedAt).toEqual(window.arrivedAt)
  })

  it('a new place is resolved afresh; a row with no id is new', () => {
    const shown = stopFormValues(window)
    const results = editedStops(
      [
        { ...shown, place: 'Eau Claire, WI' },
        { place: 'Fargo, ND', type: 'DELIVERY', date: '', from: '', to: '' },
      ],
      [window],
    )
    expect(results.map((result) => result.kind)).toEqual(['moved', 'moved'])
  })

  it('a row is matched by its id, never by its position', () => {
    const second = stop({ id: 's2', name: 'Dallas, TX', type: 'DELIVERY' })
    const results = editedStops(
      [stopFormValues(second), stopFormValues(window)],
      [window, second],
    )
    expect(
      results.map((r) => (r.kind === 'kept' ? r.input.name : r.kind)),
    ).toEqual(['Dallas, TX', 'Menomonie, WI'])
  })
})

describe('a duplicate copies the plan, never what happened', () => {
  it('no arrival, no departure, no leg miles', () => {
    const planned = plannedStop(stop({ departedAt: new Date() }))
    expect(planned).not.toHaveProperty('arrivedAt')
    expect(planned).not.toHaveProperty('departedAt')
    expect(planned).not.toHaveProperty('legMiles')
    expect(planned).toMatchObject({
      locationId: 'loc1',
      referenceNumber: 'PU-9',
      contactName: 'Dana',
      instructions: 'gate 4',
    })
  })
})
