import { describe, expect, it } from 'vitest'
import { addDays, DEFAULT_ZONE, rangeOf, viewContext } from '@/lib/load-views'
import {
  listWhere,
  loadListWhere,
  readLoadListParams,
  statusCountWhere,
} from '@/lib/load-list'
import {
  localDateIn,
  MAPPED_STATES,
  statesInZone,
  stopLocalDate,
  ZONE_CHOICES,
  zoneMidnight,
} from '@/lib/stop-time'

// ---------------------------------------------------------------------------
// THE PURE HALF OF §6.7. The database half, with rows the seed never makes, is
// `tests/integration/load-list.test.ts`.
// ---------------------------------------------------------------------------

describe('dates', () => {
  it('adds calendar days across a month and a year', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-11-18', 7)).toBe('2026-11-25')
  })

  it('reads a range, or refuses it', () => {
    expect(rangeOf({ from: '2026-10-01', to: '2026-10-07' })).toEqual({
      from: '2026-10-01',
      to: '2026-10-07',
    })
    // `from` alone is that one day.
    expect(rangeOf({ from: '2026-10-01' })).toEqual({
      from: '2026-10-01',
      to: '2026-10-01',
    })
    expect(rangeOf({ from: '2026-10-07', to: '2026-10-01' })).toBeNull()
    expect(rangeOf({ from: '2026-02-30' })).toBeNull()
    expect(rangeOf({})).toBeNull()
  })
})

describe('today is the default authority’s date', () => {
  // 04:30 UTC on the 9th is 00:30 in New York and 23:30 on the 8th in Chicago.
  const now = new Date('2026-10-09T04:30:00Z')

  it('in the zone of the authority marked default', () => {
    const ctx = viewContext(
      [
        { timezone: 'America/Chicago', isDefault: false },
        { timezone: 'America/New_York', isDefault: true },
      ],
      now,
    )
    expect(ctx.today).toBe('2026-10-09')
  })

  it('and in the schema default when none is marked', () => {
    expect(viewContext([], now).today).toBe('2026-10-08')
    expect(DEFAULT_ZONE).toBe('America/Chicago')
  })

  it('carries every authority zone, including one no state maps to', () => {
    const ctx = viewContext(
      [{ timezone: 'Asia/Dushanbe', isDefault: false }],
      now,
    )
    expect(ctx.zones).toContain('Asia/Dushanbe')
    for (const zone of ZONE_CHOICES) expect(ctx.zones).toContain(zone)
  })
})

describe('a stop is dated in exactly one zone', () => {
  it('every mapped state belongs to one zone, and only one', () => {
    const seen = ZONE_CHOICES.flatMap((zone) => statesInZone(zone))
    expect([...seen].sort()).toEqual([...MAPPED_STATES].sort())
    expect(new Set(seen).size).toBe(seen.length)
  })

  // THE INVERSE THE PREDICATE RELIES ON: a stop stored at midnight in its zone
  // reads back as the day typed, including across both DST changes.
  it.each(['2026-03-08', '2026-03-09', '2026-11-01', '2026-11-02'])(
    'midnight on %s reads back as %s in every zone',
    (day) => {
      for (const zone of ZONE_CHOICES) {
        expect(localDateIn(zoneMidnight(day, zone), zone)).toBe(day)
      }
    },
  )

  it('the DEL date reads the state, else the authority', () => {
    const nyMidnight = zoneMidnight('2026-11-18', 'America/New_York')
    expect(stopLocalDate(nyMidnight, 'NY', 'America/Chicago')).toBe(
      '2026-11-18',
    )
    // The same instant with no state is read in the authority's zone.
    expect(stopLocalDate(nyMidnight, null, 'America/Chicago')).toBe(
      '2026-11-17',
    )
    expect(stopLocalDate(null, 'NY', 'America/Chicago')).toBeNull()
  })
})

describe('the list’s where is one AND', () => {
  const ctx = viewContext([], new Date('2026-10-08T15:00:00Z'))
  const parts = (where: object) =>
    (where as { AND: object[] }).AND.map((part) => JSON.stringify(part))

  it('keeps the search and the view side by side, never merged', () => {
    const where = loadListWhere(
      readLoadListParams({ ref: 'T-1', view: 'unassigned' }),
      {},
      ctx,
    )
    const list = JSON.stringify(listWhere(where))
    // Both ORs survive: the search's over two columns, the view's over two seats.
    expect(list).toContain('"referenceNumber"')
    expect(list).toContain('"driverId":null')
  })

  it('counts a status chip under the active view', () => {
    const where = loadListWhere(
      readLoadListParams({ status: 'BOOKED', view: 'unpaid' }),
      {},
      ctx,
    )
    const counted = parts(statusCountWhere(where))
    expect(counted).toContain(JSON.stringify(where.view))
    expect(counted).not.toContain(JSON.stringify(where.status))
  })

  it('matches the driver in either seat', () => {
    const where = loadListWhere(readLoadListParams({ driver: 'd1' }), {}, ctx)
    expect(JSON.stringify(where.base)).toContain(
      '{"OR":[{"driverId":"d1"},{"coDriverId":"d1"}]}',
    )
  })
})
