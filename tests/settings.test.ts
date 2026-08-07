import { describe, expect, it } from 'vitest'
import {
  lastFullWeekAcross,
  lastFullWeekEnding,
  parseMpg,
} from '@/lib/settings'
import { lastFullWeek } from '@/lib/settlements'

// ---------------------------------------------------------------------------
// THE SETTLEMENT WEEK.
//
// Phase 3 step 6 hard-coded Monday-to-Sunday; Phase 4 step 6 gave the boundary
// a column. The failure that matters is a week off by one day: every driver
// paid for six days or eight, on a screen whose whole job is to be right about
// which loads fall inside the period.
//
// Every case here is anchored to a real weekday so the arithmetic can be
// checked by eye. 2026-08-07 is a FRIDAY.
// ---------------------------------------------------------------------------

const FRIDAY = new Date('2026-08-07T12:00:00Z')

describe('the last full week', () => {
  it('ending Sunday, asked on a Friday, is the week before', () => {
    // The most recent Sunday is the 2nd; that week ran Mon 27 Jul – Sun 2 Aug.
    expect(lastFullWeekEnding(FRIDAY, 0)).toEqual({
      start: '2026-07-27',
      end: '2026-08-02',
    })
  })

  it('ending Friday, asked ON a Friday, is the week before — today never counts', () => {
    // THE RULE THAT COSTS MONEY IF IT IS WRONG. The week ending today is not
    // finished: freight is still moving. Offering it would settle a driver for
    // a week they are still working.
    expect(lastFullWeekEnding(FRIDAY, 5)).toEqual({
      start: '2026-07-25',
      end: '2026-07-31',
    })
  })

  it('ending Saturday, asked on a Friday, is the week that ended yesterday', () => {
    // Sat 1 Aug is the most recent Saturday and it is finished.
    expect(lastFullWeekEnding(FRIDAY, 6)).toEqual({
      start: '2026-07-26',
      end: '2026-08-01',
    })
  })

  it('always spans exactly seven days', () => {
    // Six days added to the start, so the two ends are inclusive. An off-by-one
    // here silently drops a Monday's freight out of every settlement.
    for (let day = 0; day <= 6; day++) {
      const week = lastFullWeekEnding(FRIDAY, day)
      const span =
        (Date.parse(`${week.end}T00:00:00Z`) -
          Date.parse(`${week.start}T00:00:00Z`)) /
        86_400_000
      expect(span, `ends on ${day}`).toBe(6)
    }
  })

  it('lands the end on the day it was asked for', () => {
    for (let day = 0; day <= 6; day++) {
      const week = lastFullWeekEnding(FRIDAY, day)
      expect(
        new Date(`${week.end}T00:00:00Z`).getUTCDay(),
        `ends on ${day}`,
      ).toBe(day)
    }
  })

  it('does not drift over lunch', () => {
    // Both ends floored to UTC midnight. Without that, a settlement generated
    // at 9am and one at 6pm would offer different weeks.
    const morning = new Date('2026-08-07T06:00:00Z')
    const evening = new Date('2026-08-07T23:30:00Z')
    expect(lastFullWeekEnding(morning, 0)).toEqual(
      lastFullWeekEnding(evening, 0),
    )
  })
})

describe('the Phase 3 function still answers as it did', () => {
  it('because it is now the Sunday case of the new one', () => {
    // `lastFullWeek` delegates rather than keeping its own copy. Two
    // computations would be two answers to "which week is being settled", and
    // only one of them would get noticed when the boundary moved.
    for (const day of [
      '2026-08-07',
      '2026-08-09',
      '2026-08-10',
      '2026-01-01',
    ]) {
      const today = new Date(`${day}T12:00:00Z`)
      expect(lastFullWeek(today), day).toEqual(lastFullWeekEnding(today, 0))
    }
  })

  it('and Sunday itself still means the week before', () => {
    // Phase 3 named this special case explicitly; it survives the generalising.
    const sunday = new Date('2026-08-09T12:00:00Z')
    expect(lastFullWeek(sunday)).toEqual({
      start: '2026-07-27',
      end: '2026-08-02',
    })
  })
})

describe('a user scoped to authorities that disagree', () => {
  it('gets the week that is finished for all of them', () => {
    // Sunday's last full week ended 2 Aug; Friday's ended 31 Jul. Offering the
    // later one would settle a driver mid-week under the carrier whose week is
    // still running.
    expect(lastFullWeekAcross(FRIDAY, [0, 5])).toEqual(
      lastFullWeekEnding(FRIDAY, 5),
    )
  })

  it('and exactly the one boundary when they agree', () => {
    expect(lastFullWeekAcross(FRIDAY, [0, 0, 0])).toEqual(
      lastFullWeekEnding(FRIDAY, 0),
    )
  })

  it('falls back to Sunday when there is nothing to read', () => {
    // A user with no authorities in scope, or an authority with no settings
    // row. The old constant, so the answer does not change shape.
    expect(lastFullWeekAcross(FRIDAY, [])).toEqual(
      lastFullWeekEnding(FRIDAY, 0),
    )
  })
})

describe('miles per gallon', () => {
  it('takes what a truck actually does', () => {
    expect(parseMpg('6.5')).toBe('6.5')
    expect(parseMpg(' 7 ')).toBe('7')
    expect(parseMpg('5.25')).toBe('5.25')
  })

  it('refuses what no truck does', () => {
    // Refused rather than clamped: a profitability figure computed from 0 or
    // 99 mpg is nonsense nobody could trace back to a typo.
    expect(parseMpg('0')).toBeNull()
    expect(parseMpg('99')).toBeNull()
    expect(parseMpg('')).toBeNull()
    expect(parseMpg('six')).toBeNull()
    // Three decimals is a typo, not a precision claim — the column is (5,2).
    expect(parseMpg('6.555')).toBeNull()
  })
})
