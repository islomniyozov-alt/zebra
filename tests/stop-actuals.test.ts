import { describe, expect, it } from 'vitest'
import {
  dwellLabel,
  dwellMinutes,
  latenessLabel,
  sheetDates,
  shownStopTime,
} from '@/lib/stop-actuals'

// ---------------------------------------------------------------------------
// WHOSE CLOCK IS OPERATIVE.
//
// The numbers below are real trip T-115GY4TBD, whose Relay view shows the plan
// and the record hours apart: MEM4 scheduled 04:41, checked in 07:17; HME9
// scheduled 06:32, checked in 08:08; WE_PAY_WMBAF scheduled 07:32, checked in
// 09:20 — which Relay labels "1hr 18m late".
//
// THE THIRD RULE IS THE ONE WORTH TESTING HARDEST: a stop with no actual keeps
// its plan and is labelled, INCLUDING on a delivered load where every stop
// around it is a record. That is where a plan is likeliest to be read as one.
// ---------------------------------------------------------------------------

const at = (iso: string) => new Date(iso)

const stop = (over: Partial<Parameters<typeof shownStopTime>[0]> = {}) => ({
  scheduledAt: at('2026-08-24T09:41:00Z'), // 04:41 CDT
  arrivedAt: at('2026-08-24T12:17:00Z'), // 07:17 CDT
  departedAt: at('2026-08-24T12:52:00Z'),
  ...over,
})

describe('a delivered load', () => {
  const shown = shownStopTime(stop(), { delivered: true })

  it('shows the actual check-in', () => {
    expect(shown.at?.toISOString()).toBe('2026-08-24T12:17:00.000Z')
    expect(shown.isActual).toBe(true)
  })

  it('keeps the plan for reference beneath it', () => {
    expect(shown.scheduledAt?.toISOString()).toBe('2026-08-24T09:41:00.000Z')
  })

  it('carries the actual departure', () => {
    expect(shown.departedAt?.toISOString()).toBe('2026-08-24T12:52:00.000Z')
  })

  // Relay's own figure for this stop: 04:41 planned, 07:17 actual.
  it('derives the lateness rather than storing it', () => {
    expect(shown.latenessMinutes).toBe(156)
  })
})

describe('a booked load', () => {
  const shown = shownStopTime(stop(), { delivered: false })

  it('shows the plan', () => {
    expect(shown.at?.toISOString()).toBe('2026-08-24T09:41:00.000Z')
    expect(shown.isActual).toBe(false)
  })

  // THE ACTUALS EXIST ON THE ROW HERE and are still not shown — a load that
  // has not been marked delivered is one whose record is not yet final, and
  // the plan is what the office is working to.
  it('does not show an actual it has not accepted yet', () => {
    expect(shown.departedAt).toBeNull()
    expect(shown.latenessMinutes).toBeNull()
  })
})

describe('a stop with no actual, on a delivered load', () => {
  const shown = shownStopTime(stop({ arrivedAt: null, departedAt: null }), {
    delivered: true,
  })

  it('falls back to the plan', () => {
    expect(shown.at?.toISOString()).toBe('2026-08-24T09:41:00.000Z')
  })

  // THE WHOLE POINT. Its neighbours are actuals; if this said `isActual` the
  // screen would present an intention as a record with nothing to distinguish
  // it.
  it('is not presented as an actual', () => {
    expect(shown.isActual).toBe(false)
  })

  it('offers no lateness, because it was late for nothing', () => {
    expect(shown.latenessMinutes).toBeNull()
  })
})

describe('a stop with nothing at all', () => {
  it('shows nothing rather than inventing a time', () => {
    const shown = shownStopTime(
      { scheduledAt: null, arrivedAt: null, departedAt: null },
      { delivered: true },
    )
    expect(shown.at).toBeNull()
    expect(shown.isActual).toBe(false)
  })
})

describe('the plan is not repeated when it agrees with the record', () => {
  it('drops a scheduled time identical to the actual', () => {
    const same = at('2026-08-24T12:17:00Z')
    const shown = shownStopTime(
      { scheduledAt: same, arrivedAt: same, departedAt: null },
      { delivered: true },
    )
    expect(shown.scheduledAt).toBeNull()
    expect(shown.latenessMinutes).toBe(0)
  })
})

describe("the lateness label, in Relay's own phrasing", () => {
  const labels = { late: 'late', early: 'early' }

  it('reads like the portal does', () => {
    expect(latenessLabel(78, labels)).toBe('1hr 18m late')
  })

  it('drops the hour when there is none', () => {
    expect(latenessLabel(12, labels)).toBe('12m late')
  })

  it('says early for a negative', () => {
    expect(latenessLabel(-25, labels)).toBe('25m early')
  })

  it('says nothing at all for on-time or unknown', () => {
    expect(latenessLabel(0, labels)).toBeNull()
    expect(latenessLabel(null, labels)).toBeNull()
  })
})

describe("the driver's sheet dates", () => {
  const chain = (over: {
    puArrived?: Date | null
    delArrived?: Date | null
  }) => [
    {
      sequence: 1,
      type: 'PICKUP' as const,
      scheduledAt: at('2026-08-24T09:41:00Z'),
      arrivedAt:
        'puArrived' in over ? over.puArrived! : at('2026-08-24T12:17:00Z'),
      departedAt: null,
    },
    {
      sequence: 2,
      type: 'INTERMEDIATE' as const,
      scheduledAt: at('2026-08-24T14:00:00Z'),
      arrivedAt: at('2026-08-24T15:00:00Z'),
      departedAt: null,
    },
    {
      sequence: 3,
      type: 'DELIVERY' as const,
      scheduledAt: at('2026-08-25T11:32:00Z'),
      arrivedAt:
        'delArrived' in over ? over.delArrived! : at('2026-08-25T13:20:00Z'),
      departedAt: null,
    },
  ]

  it('takes PU from the first pickup and DEL from the last delivery', () => {
    const dates = sheetDates(chain({}))
    expect(dates.puAt?.toISOString()).toBe('2026-08-24T12:17:00.000Z')
    expect(dates.delAt?.toISOString()).toBe('2026-08-25T13:20:00.000Z')
    expect(dates.puActual).toBe(true)
    expect(dates.delActual).toBe(true)
  })

  // THE INTERMEDIATE STOP IS NOT THE DELIVERY, even though it has a later
  // check-in than the pickup and sits between them.
  it('ignores an intermediate stop entirely', () => {
    const dates = sheetDates(chain({}))
    expect(dates.delAt?.toISOString()).not.toBe('2026-08-24T15:00:00.000Z')
  })

  // PER DATE, NOT PER LINE. A real check-in at the shipper and none at the
  // consignee is an ordinary week.
  it('marks only the date that fell back to a plan', () => {
    const dates = sheetDates(chain({ delArrived: null }))
    expect(dates.puActual).toBe(true)
    expect(dates.delActual).toBe(false)
    expect(dates.delAt?.toISOString()).toBe('2026-08-25T11:32:00.000Z')
  })

  it('marks both when neither stop was checked into', () => {
    const dates = sheetDates(chain({ puArrived: null, delArrived: null }))
    expect(dates.puActual).toBe(false)
    expect(dates.delActual).toBe(false)
  })

  it('says nothing rather than guessing when a load has no stops', () => {
    const dates = sheetDates([])
    expect(dates.puAt).toBeNull()
    expect(dates.delAt).toBeNull()
    expect(dates.puActual).toBe(false)
    expect(dates.delActual).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// DWELL: HOW LONG THE TRUCK SAT THERE.
//
// From the two ACTUAL clocks, and from nothing else. The column was specified
// as "Waiting" and the alternative reading was detention — time past the
// appointment, which is billable and already an accessorial type. This one
// measures the gap between arriving and leaving, so it can be shown on freight
// with no appointment at all and cannot be mistaken for a charge.
// ---------------------------------------------------------------------------

describe('how long the truck waited', () => {
  it('measures arrival to departure', () => {
    expect(
      dwellMinutes({
        arrivedAt: at('2026-08-31T13:17:00Z'),
        departedAt: at('2026-08-31T16:18:00Z'),
      }),
    ).toBe(181)
  })

  // HALF A WINDOW IS NOT A DURATION. A stop that has arrived and not left has
  // not finished waiting; a number here would be the time at render, on a page
  // that does not refresh, ageing silently.
  it('says nothing when the truck has not left yet', () => {
    expect(
      dwellMinutes({ arrivedAt: at('2026-08-31T13:17:00Z'), departedAt: null }),
    ).toBeNull()
  })

  it('says nothing when there is no arrival', () => {
    expect(
      dwellMinutes({ arrivedAt: null, departedAt: at('2026-08-31T16:18:00Z') }),
    ).toBeNull()
  })

  // BAD DATA IS ABSENT, NOT NEGATIVE. "-2h" on a screen invites somebody to
  // explain the number rather than correct the row.
  it('treats a departure before its arrival as unknown', () => {
    expect(
      dwellMinutes({
        arrivedAt: at('2026-08-31T16:18:00Z'),
        departedAt: at('2026-08-31T13:17:00Z'),
      }),
    ).toBeNull()
  })
})

describe('a duration as a dispatcher says it', () => {
  it('reads minutes under an hour', () => {
    expect(dwellLabel(45)).toBe('45m')
    expect(dwellLabel(0)).toBe('0m')
  })

  it('reads hours and minutes', () => {
    expect(dwellLabel(181)).toBe('3h 1m')
    expect(dwellLabel(120)).toBe('2h')
  })

  it('reads days once a truck has sat that long', () => {
    // Real: a trailer left over a weekend. "52h" is arithmetic; "2d 4h" is
    // the thing a dispatcher recognises.
    expect(dwellLabel(52 * 60)).toBe('2d 4h')
    expect(dwellLabel(48 * 60)).toBe('2d')
  })

  it('shows an em dash rather than a zero for unknown', () => {
    expect(dwellLabel(null)).toBe('—')
  })
})
