import { describe, expect, it } from 'vitest'
import {
  SPLIT_STATES,
  ZONE_CHOICES,
  renderDateOnly,
  renderStopTime,
  resolveZone,
  unambiguousZone,
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

describe('a facility’s own timezone wins over the state', () => {
  it('uses the recorded zone, not the state’s', () => {
    // The Florida panhandle: the state map says Eastern, the dock is Central.
    // Whoever entered the dock knew; the map did not.
    const rendered = renderStopTime(AUGUST, 'FL', {
      fallbackZone: 'UTC',
      zone: 'America/Chicago',
    })
    expect(rendered?.text).toBe('Aug 10, 08:30 CDT')
    expect(rendered?.zone).toBe('America/Chicago')
  })

  it('stops calling it approximate once it is known', () => {
    // The marking exists to say "this was derived". A recorded zone was not.
    expect(
      renderStopTime(AUGUST, 'FL', {
        fallbackZone: 'UTC',
        zone: 'America/Chicago',
      })?.approximate,
    ).toBe(false)
    // The pairing: the same split state with nothing recorded is still marked.
    expect(
      renderStopTime(AUGUST, 'FL', { fallbackZone: 'UTC' })?.approximate,
    ).toBe(true)
  })

  it('falls back to the state when nothing is recorded', () => {
    expect(resolveZone(null, 'IL', 'UTC')).toEqual({
      zone: 'America/Chicago',
      approximate: false,
    })
  })

  it('only stores a zone for a state that has exactly one', () => {
    // What may be written to the database as fact, versus what may be shown as
    // a marked guess. A guess in a column stops looking like a guess.
    expect(unambiguousZone('IL')).toBe('America/Chicago')
    expect(unambiguousZone('AZ')).toBe('America/Phoenix')
    for (const split of SPLIT_STATES) {
      expect(unambiguousZone(split), split).toBeNull()
    }
    expect(unambiguousZone(null)).toBeNull()
    expect(unambiguousZone('ZZ')).toBeNull()
  })
})

describe('the zones a place may be set to', () => {
  // The load screen writes whatever this list offers straight into
  // `Location.timezone`, and `setStopZoneAction` refuses anything not in it.
  // So the list is the validation, and a bad entry here is a wrong
  // appointment time discovered weeks later by a driver at a closed dock.

  it('offers only names Intl can actually resolve', () => {
    for (const zone of ZONE_CHOICES) {
      expect(() =>
        new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(new Date()),
      ).not.toThrow()
    }
  })

  it('offers every zone the derivation can produce', () => {
    // Otherwise a place could be showing a zone it cannot be set back to,
    // and "clear it and start again" would silently change the answer.
    for (const state of ['IL', 'AZ', 'CA', 'NY', 'ON', 'SK', 'HI']) {
      const derived = zoneForState(state, 'UTC')
      expect(ZONE_CHOICES, state).toContain(derived)
    }
  })

  it('has no duplicates', () => {
    expect(new Set(ZONE_CHOICES).size).toBe(ZONE_CHOICES.length)
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
