import { describe, expect, it } from 'vitest'
import {
  SPLIT_STATES,
  renderDateOnly,
  renderStopTime,
  zoneMidnight,
  zoneForState,
} from '@/lib/stop-time'

// Design-system rule 3: "the single most expensive bug class in dispatch
// software". A driver told to be at a Dallas dock at 08:00 does not care what
// time it is in Dushanbe, and rendering in the viewer's zone is the failure —
// silent, plausible, and a truck six hours late.

const AUGUST = new Date('2026-08-10T13:30:00.000Z') // 08:30 CDT, 09:30 EDT
const JANUARY = new Date('2026-01-10T14:30:00.000Z') // 08:30 CST, 09:30 EST

describe('an appointment renders in the STOP’s zone', () => {
  it('shows Central for a Texas stop, whatever the server thinks', () => {
    const rendered = renderStopTime(AUGUST, 'TX', {
      fallbackZone: 'Asia/Dushanbe',
    })
    expect(rendered?.text).toBe('Aug 10, 08:30 CDT')
  })

  it('shows Eastern for a Georgia stop at the same instant', () => {
    // Same Date object, two stops, two different wall clocks. This is the
    // whole point of the rule.
    expect(renderStopTime(AUGUST, 'GA', { fallbackZone: 'UTC' })?.text).toBe(
      'Aug 10, 09:30 EDT',
    )
  })

  it('follows daylight saving without a table', () => {
    // Intl supplies the abbreviation, so the same zone is CDT in August and
    // CST in January. Hard-coding either is wrong for half the year.
    expect(renderStopTime(AUGUST, 'IL', { fallbackZone: 'UTC' })?.text).toBe(
      'Aug 10, 08:30 CDT',
    )
    expect(renderStopTime(JANUARY, 'IL', { fallbackZone: 'UTC' })?.text).toBe(
      'Jan 10, 08:30 CST',
    )
  })

  it('handles Arizona, which does not observe it at all', () => {
    expect(renderStopTime(AUGUST, 'AZ', { fallbackZone: 'UTC' })?.text).toBe(
      'Aug 10, 06:30 MST',
    )
  })

  it('falls back to the company zone when the stop has no state', () => {
    const rendered = renderStopTime(AUGUST, null, {
      fallbackZone: 'America/Chicago',
    })
    expect(rendered?.zone).toBe('America/Chicago')
    // ...and says it is a guess, so the interface can mark it.
    expect(rendered?.approximate).toBe(true)
  })

  it('marks a split state as approximate', () => {
    // The map puts Florida in Eastern, which is wrong for the panhandle. The
    // interface shows the zone it used rather than pretending to certainty.
    expect(
      renderStopTime(AUGUST, 'FL', { fallbackZone: 'UTC' })?.approximate,
    ).toBe(true)
    expect(
      renderStopTime(AUGUST, 'IL', { fallbackZone: 'UTC' })?.approximate,
    ).toBe(false)
  })

  it('every split state is in the map it is split about', () => {
    // A state listed as split but missing from STATE_ZONES would silently take
    // the fallback and never be marked.
    for (const state of SPLIT_STATES) {
      expect(zoneForState(state, 'UTC'), state).not.toBe('UTC')
    }
  })

  it('is null for a stop with no appointment', () => {
    expect(renderStopTime(null, 'TX', { fallbackZone: 'UTC' })).toBeNull()
  })
})

describe('a date typed with no time survives the round trip', () => {
  // The bug this exists for, found in a screenshot of the Step 5 detail
  // screen: a pickup typed as September 15th, stored at UTC midnight and then
  // rendered in the stop's zone per rule 3, came back as "Sep 14, 19:00 CDT".
  // The rule's own failure mode, committed by the code meant to honour it.
  it.each([
    ['TX', 'America/Chicago'],
    ['GA', 'America/New_York'],
    ['CA', 'America/Los_Angeles'],
    ['AZ', 'America/Phoenix'],
  ])('stays the same day for a %s stop', (state, zone) => {
    const stored = zoneMidnight('2026-09-15', zone)
    expect(renderStopTime(stored, state, { fallbackZone: 'UTC' })?.text).toBe(
      'Sep 15',
    )
  })

  it('shows no time at all when none was given', () => {
    // §8 — a date-only field takes no timezone. Rendering "00:00 CDT" would be
    // inventing a midnight appointment nobody made.
    const stored = zoneMidnight('2026-09-15', 'America/Chicago')
    const rendered = renderStopTime(stored, 'TX', { fallbackZone: 'UTC' })
    expect(rendered?.text).not.toContain(':')
    expect(rendered?.text).not.toContain('CDT')
  })

  it('still shows the time and zone when there IS one', () => {
    // The pairing: the date-only path must not swallow real appointments.
    expect(
      renderStopTime(new Date('2026-09-15T19:30:00.000Z'), 'TX', {
        fallbackZone: 'UTC',
      })?.text,
    ).toBe('Sep 15, 14:30 CDT')
  })

  it('is right across the DST boundary in both directions', () => {
    // Chicago is UTC-5 in September and UTC-6 in January. Arithmetic on a
    // fixed offset gets one of them wrong.
    expect(
      renderStopTime(zoneMidnight('2026-09-15', 'America/Chicago'), 'IL', {
        fallbackZone: 'UTC',
      })?.text,
    ).toBe('Sep 15')
    expect(
      renderStopTime(zoneMidnight('2026-01-15', 'America/Chicago'), 'IL', {
        fallbackZone: 'UTC',
      })?.text,
    ).toBe('Jan 15')
  })
})

describe('a date-only field takes no timezone (§8)', () => {
  it('renders the stored day, not the viewer’s day', () => {
    // 2026-08-10T00:00:00Z is the 9th of August anywhere west of Greenwich.
    // A hire date or an invoice due date is a DATE, and must not move.
    expect(renderDateOnly(new Date('2026-08-10T00:00:00.000Z'))).toBe(
      'Aug 10, 2026',
    )
  })
})
