import { describe, expect, it } from 'vitest'
import {
  MAX_IMPORT_ROWS,
  RelayCsvError,
  parseCsv,
  parseRelayCsv,
  relayClock,
} from '@/lib/relay-csv'
import { RELAY_HEADER, relayRow as row } from './fixtures/relay'

const file = (...rows: string[]) => `﻿${RELAY_HEADER}\n${rows.join('\n')}\n`

describe('the CSV itself', () => {
  it('strips the BOM the real export ships with', () => {
    const rows = parseCsv('﻿a,b\n1,2\n')
    expect(rows[0]).toEqual(['a', 'b'])
  })

  it('reads quoted fields, including a comma and a doubled quote', () => {
    const rows = parseCsv('a,b\n"Austell, GA","53"" Container"\n')
    expect(rows[1]).toEqual(['Austell, GA', '53" Container'])
  })

  it('treats CRLF as one ending', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('keeps the last row when the file does not end in a newline', () => {
    expect(parseCsv('a,b\n1,2')).toHaveLength(2)
  })
})

describe('the Relay columns', () => {
  it('reads a trip', () => {
    const [trip] = parseRelayCsv(file(row()))
    expect(trip).toBeDefined()
    expect(trip!.loadId).toBe('TESTLOAD1')
    expect(trip!.tripId).toBe('T-TESTTRIP1')
    expect(trip!.stops).toHaveLength(2)
    expect(trip!.stops[0]!.facility).toBe('AAA1')
    expect(trip!.stops[1]!.facility).toBe('BBB2')
  })

  // THE DOUBLE-SPACE BUG, ASSERTED. An exact-name lookup finds every arrival
  // and misses every departure, which is a window with no end on every stop of
  // every load — and nothing else in this suite would have failed.
  it('finds the departure columns despite the doubled space in the header', () => {
    const [trip] = parseRelayCsv(file(row()))
    expect(trip!.stops[0]!.plannedDeparture).not.toBeNull()
    expect(trip!.stops[1]!.plannedDeparture).not.toBeNull()
  })

  // The departure has its own DATE column and the real export uses it: a stop
  // planned in at 23:30 is planned out at 00:01 the NEXT day. Reusing the
  // arrival date would make this window end 23 hours before it starts.
  it('reads a window that crosses midnight without inverting it', () => {
    const [trip] = parseRelayCsv(file(row()))
    const stop = trip!.stops[0]!
    expect(stop.plannedArrival).toEqual({
      date: '2026-08-11',
      hour: 23,
      minute: 30,
    })
    expect(stop.plannedDeparture).toEqual({
      date: '2026-08-12',
      hour: 0,
      minute: 1,
    })
  })

  // FLAG 14. The parser hands back the clock face the export PRINTED and does
  // not turn it into an instant, because the printed clock is the facility's
  // wall clock and this file cannot know where the facility is. The offset
  // column is carried through untouched, as the static standard-time metadata
  // the Relay portal proved it to be.
  it('keeps the printed clock and does not convert it', () => {
    const [trip] = parseRelayCsv(file(row()))
    expect(trip!.stops[0]!.plannedArrival).toEqual({
      date: '2026-08-11',
      hour: 23,
      minute: 30,
    })
    expect(trip!.stops[0]!.utcOffsetHours).toBe(-6)
    // A different offset on the same load — what a cross-zone run looks like.
    expect(trip!.stops[1]!.utcOffsetHours).toBe(-5)
    expect(trip!.stops[1]!.plannedArrival).toEqual({
      date: '2026-08-12',
      hour: 6,
      minute: 31,
    })
  })

  it('floors the distance rather than refusing the decimal every row has', () => {
    const [trip] = parseRelayCsv(file(row({ distance: '26.94' })))
    expect(trip!.distanceMiles).toBe(26)
  })

  it('refuses a distance in anything but miles', () => {
    const [trip] = parseRelayCsv(file(row({ distance: '241.6', unit: 'km' })))
    expect(trip!.distanceMiles).toBeNull()
  })

  it('reads the cost as exact cents', () => {
    const [trip] = parseRelayCsv(file(row({ cost: '17.18' })))
    expect(trip!.costCents).toBe(1718)
    // The one that a float multiply gets wrong.
    expect(parseRelayCsv(file(row({ cost: '211.63' })))[0]!.costCents).toBe(
      21163,
    )
  })

  it('carries a missing cost as null rather than as free freight', () => {
    expect(parseRelayCsv(file(row({ cost: '' })))[0]!.costCents).toBeNull()
  })

  it('skips a trailing empty stop column instead of inventing a stop', () => {
    const [trip] = parseRelayCsv(
      file(row({ s2: '', s2offset: '', s2planArrDate: '', s2planArrTime: '' })),
    )
    expect(trip!.stops).toHaveLength(1)
  })

  it('numbers rows from one, so the preview can name them', () => {
    const trips = parseRelayCsv(
      file(row({ loadId: 'A' }), row({ loadId: 'B' })),
    )
    expect(trips.map((trip) => [trip.rowNumber, trip.loadId])).toEqual([
      [1, 'A'],
      [2, 'B'],
    ])
  })
})

describe('what it refuses', () => {
  it('refuses an empty file by name', () => {
    expect(() => parseRelayCsv('   ')).toThrow(RelayCsvError)
    try {
      parseRelayCsv('')
    } catch (error) {
      expect((error as RelayCsvError).reason).toBe('empty')
    }
  })

  // A dispatcher who uploads the wrong export should be told THAT, not handed
  // a preview of zero loads that reads like the file was fine and empty.
  it('refuses a file that is not a Trips export', () => {
    try {
      parseRelayCsv('Invoice Number,Amount\n1001,42\n')
      throw new Error('should have refused')
    } catch (error) {
      expect((error as RelayCsvError).reason).toBe('not_relay')
    }
  })

  it('refuses a header with no rows under it', () => {
    try {
      parseRelayCsv(`﻿${RELAY_HEADER}\n`)
      throw new Error('should have refused')
    } catch (error) {
      expect((error as RelayCsvError).reason).toBe('no_rows')
    }
  })

  it('refuses more rows than one import covers', () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, index) =>
      row({ loadId: `L${index}` }),
    )
    try {
      parseRelayCsv(file(...rows))
      throw new Error('should have refused')
    } catch (error) {
      expect((error as RelayCsvError).reason).toBe('too_many_rows')
    }
  })
})

describe('a clock face from a Relay row', () => {
  it('reads a date and a time into ISO plus hands', () => {
    expect(relayClock('08/11/2026', '23:30')).toEqual({
      date: '2026-08-11',
      hour: 23,
      minute: 30,
    })
    // Single-digit month and day, padded — `zoneWallClock` splits on the
    // dashes and 2026-8-1 would parse as August anyway, but the stored shape
    // is what gets compared and logged.
    expect(relayClock('1/2/2026', '07:05')).toEqual({
      date: '2026-01-02',
      hour: 7,
      minute: 5,
    })
  })

  it('is null when either half is missing', () => {
    expect(relayClock('', '10:00')).toBeNull()
    expect(relayClock('08/11/2026', '')).toBeNull()
  })

  it('refuses a date that does not exist', () => {
    expect(relayClock('02/30/2026', '10:00')).toBeNull()
    expect(relayClock('13/01/2026', '10:00')).toBeNull()
  })

  it('refuses a clock time that does not exist', () => {
    expect(relayClock('08/11/2026', '24:00')).toBeNull()
    expect(relayClock('08/11/2026', '10:60')).toBeNull()
  })

  it('refuses a date it would have to rearrange to read', () => {
    expect(relayClock('2026-08-11', '10:00')).toBeNull()
  })
})
