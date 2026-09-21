import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  deliveryFactsFromStops,
  dispatchStatusFrom,
  headingToFrom,
  onTimeFrom,
  onTimeRateFrom,
  type OnTime,
} from '@/lib/dispatch-fields'

// ---------------------------------------------------------------------------
// FOUR DISPATCH FIELDS, DERIVED — AND ONE FLAG THAT CANNOT BE.
//
// Datatruck exports `Heading to`, `Dispatch status`, `Last Activity` and
// `On Time Delivery` as stored columns. These are the rules that replace them;
// the queries that feed them are graded in the integration suite, where a
// fan-out can be counted.
// ---------------------------------------------------------------------------

const NOW = new Date(Date.UTC(2026, 8, 20, 12, 0, 0))
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000)

describe('heading to', () => {
  it('is the last stop of the load the truck is on', () => {
    expect(
      headingToFrom([
        { city: 'Whiteland', state: 'IN' },
        { city: 'Gastonia', state: 'NC' },
      ]),
    ).toBe('Gastonia, NC')
  })

  it('is BLANK when the truck is on nothing', () => {
    // Not "Unknown", not "—" — null, so each screen phrases its own absence.
    expect(headingToFrom([])).toBeNull()
  })

  it('is blank rather than a stray comma when the place is empty', () => {
    expect(headingToFrom([{ city: null, state: null }])).toBeNull()
  })

  it('copes with a stop that has only one half of its place', () => {
    expect(headingToFrom([{ city: null, state: 'NC' }])).toBe('NC')
  })
})

describe('dispatch status', () => {
  const facts = (
    over: Partial<Parameters<typeof dispatchStatusFrom>[0]> = {},
  ) =>
    dispatchStatusFrom(
      { isOffDuty: false, offDutyUntil: null, activeStatuses: [], ...over },
      NOW,
    )

  it('is Available with no active freight', () => {
    expect(facts()).toBe('available')
  })

  it('is Assigned once there is freight that has not moved', () => {
    expect(facts({ activeStatuses: ['BOOKED'] })).toBe('assigned')
  })

  it('is In transit once any of it is moving', () => {
    expect(facts({ activeStatuses: ['IN_TRANSIT'] })).toBe('in_transit')
  })

  it('prefers In transit when a driver has both', () => {
    // What a dispatcher needs before offering anything is whether this person
    // is already out, not whether they also have something booked.
    expect(facts({ activeStatuses: ['BOOKED', 'AT_DELIVERY'] })).toBe(
      'in_transit',
    )
  })

  it('is Off duty when the flag is set, whatever the freight says', () => {
    // THE GUARD NAMED "an off-duty driver reading Available". Somebody on
    // holiday must not be offered a load because their last one closed.
    expect(facts({ isOffDuty: true })).toBe('off_duty')
    expect(facts({ isOffDuty: true, activeStatuses: ['IN_TRANSIT'] })).toBe(
      'off_duty',
    )
  })

  it('stays off duty until the return date', () => {
    expect(facts({ isOffDuty: true, offDutyUntil: hours(4) })).toBe('off_duty')
  })

  it('comes BACK on duty once the date has passed', () => {
    // The whole reason the date exists: without it somebody has to remember
    // to clear a boolean, and the one nobody clears is the one that matters.
    expect(facts({ isOffDuty: true, offDutyUntil: hours(-1) })).toBe(
      'available',
    )
    expect(
      facts({
        isOffDuty: true,
        offDutyUntil: hours(-1),
        activeStatuses: ['BOOKED'],
      }),
    ).toBe('assigned')
  })

  it('treats a null return date as indefinite', () => {
    expect(facts({ isOffDuty: true, offDutyUntil: null })).toBe('off_duty')
  })
})

describe('on-time delivery', () => {
  it('is on time when the truck checked in inside the window', () => {
    expect(
      onTimeFrom({
        arrivedAt: hours(-1),
        windowEnd: NOW,
        scheduledAt: null,
      }),
    ).toBe('on_time')
  })

  it('is late when it checked in after the window closed', () => {
    expect(
      onTimeFrom({ arrivedAt: hours(1), windowEnd: NOW, scheduledAt: null }),
    ).toBe('late')
  })

  it('falls back to the appointment when there is no window', () => {
    expect(
      onTimeFrom({ arrivedAt: hours(2), windowEnd: null, scheduledAt: NOW }),
    ).toBe('late')
  })

  it('counts early as on time', () => {
    expect(
      onTimeFrom({ arrivedAt: hours(-9), windowEnd: NOW, scheduledAt: null }),
    ).toBe('on_time')
  })

  it('is UNKNOWN with no check-in, never on time', () => {
    // THE GUARD NAMED "a load without actuals counted". Counting it on time
    // flatters the number; counting it late punishes a driver for a
    // dispatcher who did not tick a box.
    expect(
      onTimeFrom({ arrivedAt: null, windowEnd: NOW, scheduledAt: NOW }),
    ).toBe('unknown')
  })

  it('is unknown with nothing promised either', () => {
    expect(
      onTimeFrom({ arrivedAt: NOW, windowEnd: null, scheduledAt: null }),
    ).toBe('unknown')
  })
})

describe('the delivery stop a load is judged on', () => {
  const stop = (
    sequence: number,
    type: string,
    arrivedAt: Date | null = null,
  ) => ({ sequence, type, arrivedAt, windowEnd: NOW, scheduledAt: null })

  it('is the LAST delivery, not the last stop', () => {
    // A multi-drop trip ending at a pickup for the next run is not judged
    // on that pickup.
    const facts = deliveryFactsFromStops([
      stop(1, 'PICKUP'),
      stop(2, 'DELIVERY', hours(-3)),
      stop(3, 'DELIVERY', hours(2)),
    ])
    expect(facts?.arrivedAt).toEqual(hours(2))
    expect(onTimeFrom(facts!)).toBe('late')
  })

  it('does not depend on the order the rows arrive in', () => {
    // `findUnique` orders by sequence, but nothing in the type says so,
    // and a caller that forgets the orderBy must not silently judge the
    // wrong stop.
    const facts = deliveryFactsFromStops([
      stop(3, 'DELIVERY', hours(2)),
      stop(2, 'DELIVERY', hours(-3)),
      stop(1, 'PICKUP'),
    ])
    expect(facts?.arrivedAt).toEqual(hours(2))
  })

  it('is NULL when the load has no delivery at all', () => {
    // A malformed load, which is not the same fact as an unrecorded
    // arrival — the screen renders nothing rather than "No check-in".
    expect(deliveryFactsFromStops([stop(1, 'PICKUP')])).toBeNull()
  })

  it('agrees with the list loader about which stop it picked', () => {
    // ONE RULE, TWO SOURCES. The loader expresses "last delivery by
    // sequence" as an ORDER BY and this expresses it as a reduce; the way
    // they drift apart is one of them being changed alone.
    const loader = readFileSync('src/lib/dispatch-fields.ts', 'utf8')
    expect(loader).toContain(
      'st."type" = ' +
        String.fromCharCode(39) +
        'DELIVERY' +
        String.fromCharCode(39),
    )
    expect(loader).toContain('ORDER BY st."sequence" DESC')
  })
})

describe('a driver on-time rate', () => {
  const rate = (...outcomes: OnTime[]) => onTimeRateFrom(outcomes)

  it('is over the loads that can be judged, and says how many', () => {
    const out = rate('on_time', 'late', 'on_time', 'unknown')
    expect(out.counted).toBe(3)
    expect(out.onTime).toBe(2)
    expect(out.percent).toBe(67)
  })

  it('EXCLUDES unknowns rather than counting them on time', () => {
    // Three unknowns beside one late must not read as 25% late.
    const out = rate('late', 'unknown', 'unknown', 'unknown')
    expect(out.counted).toBe(1)
    expect(out.percent).toBe(0)
  })

  it('is NULL when nothing can be judged, not zero', () => {
    // Zero per cent and "no data" render the same under a naive template and
    // mean opposite things: always late, versus never recorded.
    const out = rate('unknown', 'unknown')
    expect(out.counted).toBe(0)
    expect(out.percent).toBeNull()
  })
})

// ── THE DESIGN GUARD ───────────────────────────────────────────────────
describe('what item 11 stores', () => {
  const schema = readFileSync('prisma/schema.prisma', 'utf8')
  const source = readFileSync('src/lib/dispatch-fields.ts', 'utf8')

  it('stores the off-duty flag and NOTHING else', () => {
    // THE GUARD NAMED "a stored derived value". Each of these would be a copy
    // of a fact with a shelf life and nothing to say when it expired.
    expect(schema).toMatch(/isOffDuty\s+Boolean/)
    expect(schema).not.toMatch(/headingTo\s+String/)
    expect(schema).not.toMatch(/dispatchStatus\s+/)
    expect(schema).not.toMatch(/lastActivityAt\s+/)
    expect(schema).not.toMatch(/onTime(Delivery|Rate)?\s+(Boolean|Float|Int)/)
  })

  it('keeps the rules free of the database', () => {
    const rules = source.slice(0, source.indexOf('// ── the loaders'))
    expect(rules).not.toContain('$queryRaw')
  })

  it('reads each list in exactly one statement', () => {
    // FIVE LOADERS, FIVE STATEMENTS — the number that must not grow with
    // the length of any list. Four take an array of ids; the fifth,
    // `onTimeRateForDriver`, takes one driver and answers over their whole
    // history in one statement rather than one per load.
    //
    // A count is a proxy for the thing that matters, which is that no
    // statement sits inside a loop. The costed form is in the integration
    // suite, where twenty drivers are asked for and the questions counted.
    expect(source.match(/\$queryRaw/g) ?? []).toHaveLength(5)
  })
})
