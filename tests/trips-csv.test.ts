import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  normalizeHeader,
  parseTripsCsv,
  tripDate,
  tripOffset,
  tripTime,
} from '@/lib/trips-csv'
import { parseCsv, parseRelayCsv } from '@/lib/relay-csv'
import { isEmptyLeg, legPurpose } from '@/lib/leg-purpose'

// ---------------------------------------------------------------------------
// THE TRIPS EXPORT, READ THE WAY AMAZON ACTUALLY WRITES IT.
//
// One file per trip, one row per leg. The fixtures are 1,600 real exports
// swept from the owner's download history — so the awkward parts here are not
// invented edge cases, they are what arrived.
// ---------------------------------------------------------------------------

const CORPUS = join(process.cwd(), 'corpus', 'relay-trips')

/** A minimal file in the real shape, for the cases fixtures cannot stage. */
function file(rows: string[][]): string {
  return rows.map((row) => row.join(',')).join('\n')
}

const HEADER = [
  'Trip ID',
  'Load ID',
  'Facility Sequence',
  'Load Execution Status',
  'Estimate Distance',
  'Unit',
  'Estimated Cost',
  'Shipper Account',
  'Driver Name',
  'Trailer ID',
  'Tractor Vehicle ID',
  'Stop 1',
  'Stop 1 UTC Offset',
  'Stop 1 Planned Arrival Date',
  'Stop 1 Planned Arrival Time',
  'Stop 2',
  'Stop 2 UTC Offset',
  'Stop 2  Planned Arrival Date',
  'Stop 2  Planned Arrival Time',
]

/** Where 'Estimated Cost' sits in HEADER/ROW, by name rather than by count. */
const COST_COLUMN = HEADER.indexOf('Estimated Cost')

const ROW = [
  'T-115HXB4HH',
  '115HXB4HH',
  'DEN7->MKC6',
  'Completed',
  '583.26',
  'mi',
  '1657.64',
  'OutboundAmazonManaged',
  'Belal Sultani',
  'HV2504452',
  'ZP33494',
  'DEN7',
  '-7',
  '01/10/2025',
  '07:30',
  'MKC6',
  '-6',
  '01/11/2025',
  '07:30',
]

describe('the header, as the exporter really writes it', () => {
  it('strips the byte-order mark every real file starts with', () => {
    expect(normalizeHeader('﻿Trip ID')).toBe('trip id')
  })

  // OBSERVED, NOT IMAGINED: "Stop 1  Actual Arrival Date" carries two spaces
  // in the real export, inconsistently, between adjacent columns of one family.
  it('collapses the double spaces Amazon leaves in stop columns', () => {
    expect(normalizeHeader('Stop 1  Actual Arrival Date')).toBe(
      normalizeHeader('Stop 1 Actual Arrival Date'),
    )
  })
})

describe('the printed values', () => {
  it('reads the export date format', () => {
    expect(tripDate('01/10/2025')).toBe('2025-01-10')
    expect(tripDate('1/9/2025')).toBe('2025-01-09')
  })

  it('refuses anything that is not that, rather than guessing', () => {
    expect(tripDate('2025-01-10')).toBeNull()
    expect(tripDate('13/40/2025')).toBeNull()
    expect(tripDate('')).toBeNull()
  })

  it('reads a 24-hour clock', () => {
    expect(tripTime('07:30')).toBe('07:30')
    expect(tripTime('7:30')).toBe('07:30')
    expect(tripTime('23:59')).toBe('23:59')
  })

  it('refuses an impossible clock', () => {
    expect(tripTime('24:00')).toBeNull()
    expect(tripTime('07:60')).toBeNull()
  })

  it('reads the offset column as whole hours', () => {
    expect(tripOffset('-7')).toBe(-7)
    expect(tripOffset('0')).toBe(0)
    expect(tripOffset('')).toBeNull()
    expect(tripOffset('nonsense')).toBeNull()
  })
})

describe('a leg', () => {
  const { legs, problems } = parseTripsCsv(file([HEADER, ROW]))

  it('comes out whole', () => {
    expect(problems).toEqual([])
    expect(legs).toHaveLength(1)
    expect(legs[0]?.tripId).toBe('T-115HXB4HH')
    expect(legs[0]?.loadId).toBe('115HXB4HH')
    expect(legs[0]?.facilitySequence).toBe('DEN7->MKC6')
    expect(legs[0]?.distance).toBe(583.26)
  })

  it('keeps both stops with their own offsets', () => {
    expect(legs[0]?.stops.map((stop) => stop.facilityCode)).toEqual([
      'DEN7',
      'MKC6',
    ])
    expect(legs[0]?.stops[0]?.plannedArrival).toEqual({
      date: '2025-01-10',
      time: '07:30',
      utcOffsetHours: -7,
    })
    // The double-spaced header still found its column.
    expect(legs[0]?.stops[1]?.plannedArrival?.utcOffsetHours).toBe(-6)
  })

  // RULE 6 NO LONGER MEANS "NEVER PARSED", AND THIS TEST CHANGED WITH IT.
  //
  // The old assertion was that this file did not contain the string 'estimated
  // cost' at all — absence as the guarantee. On 2026-08-20 the owner verified
  // trip 1165YNVHN against the Relay portal at $5,089.07 and found the column
  // exact on a single-load trip, so the value is now carried and the judgement
  // moved to `planTrips`.
  //
  // THE GUARD MOVED RATHER THAN DISAPPEARED. Parsing is not permission: this
  // asserts only that the number arrives intact and in CENTS. What may be
  // called a rate is asserted in trips-import.test.ts, against the partition,
  // which is the thing that actually protects the money.
  it('carries Estimated Cost as integer cents, deciding nothing', () => {
    expect(legs[0]?.costCents).toBe(165764)
  })

  it('treats a blank or unreadable cost as absence rather than zero', () => {
    const blank = [...ROW]
    blank[COST_COLUMN] = ''
    expect(parseTripsCsv(file([HEADER, blank])).legs[0]?.costCents).toBeNull()

    // A malformed figure must not cost the other forty trips in the file.
    const junk = [...ROW]
    junk[COST_COLUMN] = 'see contract'
    const parsed = parseTripsCsv(file([HEADER, junk]))
    expect(parsed.legs).toHaveLength(1)
    expect(parsed.legs[0]?.costCents).toBeNull()
  })

  it('says which row it could not read, rather than dropping it', () => {
    const bad = parseTripsCsv(file([HEADER, ROW, ['', ...ROW.slice(1)], ROW]))
    expect(bad.legs).toHaveLength(2)
    expect(bad.problems).toEqual([
      { row: 3, reason: 'no_trip_id', detail: 'the row names no trip' },
    ])
  })

  it('reports a row naming no facility at all', () => {
    const noStops = [...ROW]
    noStops[11] = ''
    noStops[15] = ''
    const parsed = parseTripsCsv(file([HEADER, noStops]))
    expect(parsed.legs).toHaveLength(0)
    expect(parsed.problems[0]?.reason).toBe('no_stops')
  })
})

describe('what the trailer was doing', () => {
  it('calls the observed empty categories empty', () => {
    expect(legPurpose('BobtailMovementAnnotation')).toBe('EMPTY')
    expect(legPurpose('FleetManagementEquipmentRepositioning')).toBe('EMPTY')
    expect(legPurpose('TransfersEmptyCarts')).toBe('EMPTY')
    // THE SINGLE /Empty/ RULE, replacing an EmptyCarts anchor and an
    // EmptyContainer pattern that matched nothing in 2,987 rows.
    expect(legPurpose('CustomerFacingEmptyTrailer')).toBe('EMPTY')
    expect(legPurpose('TransfersEmptyPod')).toBe('EMPTY')
  })

  it('calls freight loaded', () => {
    expect(legPurpose('OutboundAmazonManaged')).toBe('LOADED')
    expect(legPurpose('TransfersInitialPlacement')).toBe('LOADED')
    // A domain question with the owner, not a pattern question. Unmatched
    // overstates loaded miles visibly rather than understating them quietly.
    expect(legPurpose('TrailerPoolAdjustmentDrop')).toBe('LOADED')
  })

  // UNMATCHED IS LOADED, and that is the safe direction: a loaded leg wrongly
  // called empty would understate the miles a rate is judged against.
  it('defaults an unknown account to loaded rather than guessing', () => {
    expect(legPurpose('SomethingAmazonInventedLastWeek')).toBe('LOADED')
    expect(legPurpose('')).toBe('LOADED')
    expect(legPurpose(null)).toBe('LOADED')
    expect(isEmptyLeg(null)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// THE COLUMN AMAZON RENAMED, WITHOUT THE CORPUS.
//
// The sweep is gitignored, so every corpus assertion in this file skips on CI
// and on a fresh clone — and the defect these describe was a column name. A
// guard that only exists where the fixtures happen to be is not a guard for
// the repository; it is a guard for one laptop.
//
// So the two spellings are staged by hand here as well. `Actual Arrival` is
// what all 1,600 swept exports print; `Actual Check-In` is what every export
// downloaded since 2026-08-17 prints. Both must be read, in both readers, and
// neither test can be deleted as redundant with the other: they are different
// files, from different years, that dispatch imports the same afternoon.
// ---------------------------------------------------------------------------

describe('the arrival column under both of its names', () => {
  const withActuals = (arrivalLabel: string) =>
    file([
      [
        'Trip ID',
        'Load ID',
        'Facility Sequence',
        'Load Execution Status',
        'Estimate Distance',
        'Unit',
        'Stop 1',
        'Stop 1 UTC Offset',
        `Stop 1 ${arrivalLabel} Date`,
        `Stop 1 ${arrivalLabel} Time`,
        'Stop 1 Actual Departure Date',
        'Stop 1 Actual Departure Time',
        'Stop 2',
        'Stop 2 UTC Offset',
        `Stop 2 ${arrivalLabel} Date`,
        `Stop 2 ${arrivalLabel} Time`,
        'Stop 2 Actual Departure Date',
        'Stop 2 Actual Departure Time',
      ],
      [
        'T-115GY4TBD',
        '111JPJ8YR',
        'MEM4->HME9',
        'Completed',
        '34.74',
        'mi',
        'MEM4',
        '-6',
        '08/31/2026',
        '07:17',
        '08/31/2026',
        '07:18',
        'HME9',
        '-6',
        '08/31/2026',
        '08:08',
        '08/31/2026',
        '08:28',
      ],
    ])

  // LOAD 1010'S OWN NUMBERS. This is the export that was imported on 2026-09-02
  // and wrote four departures and four null check-ins.
  it('reads a check-in beside its departure', () => {
    const [leg] = parseTripsCsv(withActuals('Actual Check-In')).legs
    expect(leg?.stops[0]?.actualArrival?.time).toBe('07:17')
    expect(leg?.stops[0]?.actualDeparture?.time).toBe('07:18')
    expect(leg?.stops[1]?.actualArrival?.time).toBe('08:08')
    expect(leg?.stops[1]?.actualDeparture?.time).toBe('08:28')
  })

  it('still reads the older name the whole sweep uses', () => {
    const [leg] = parseTripsCsv(withActuals('Actual Arrival')).legs
    expect(leg?.stops[0]?.actualArrival?.time).toBe('07:17')
    expect(leg?.stops[1]?.actualArrival?.time).toBe('08:08')
  })

  // ONE FILE, TWO READERS. The board importer reads the same export a row at a
  // time; it knew the new name and not the old one, which is the same defect
  // pointed the other way.
  it('reads both names in the board importer too', () => {
    for (const label of ['Actual Check-In', 'Actual Arrival']) {
      const [trip] = parseRelayCsv(withActuals(label))
      expect(trip?.stops[0]?.actualArrival, label).toMatchObject({
        hour: 7,
        minute: 17,
      })
      expect(trip?.stops[0]?.actualDeparture, label).toMatchObject({
        hour: 7,
        minute: 18,
      })
    }
  })
})
// ---------------------------------------------------------------------------
// AGAINST THE WHOLE SWEEP.
//
// A parser that works on a fixture written beside it proves the fixture. These
// run over every real export present, and are skipped rather than failed when
// the corpus is absent — it is gitignored, so CI and a fresh clone have none.
// ---------------------------------------------------------------------------

const files = existsSync(CORPUS)
  ? readdirSync(CORPUS).filter(
      // A trip export is named Trips*. Excluding one facilities file BY NAME
      // meant a second one — facilities-amazon-delta.csv — was fed to the trip
      // parser the day it arrived.
      (name) => name.startsWith('Trips') && name.endsWith('.csv'),
    )
  : []

describe.skipIf(files.length === 0)('every real export in the sweep', () => {
  const parsed = files.map((name) => ({
    name,
    ...parseTripsCsv(readFileSync(join(CORPUS, name), 'utf8')),
  }))

  it('reads them all without a single unreadable row', () => {
    const broken = parsed
      .filter((file) => file.problems.length > 0)
      .map((file) => `${file.name}: ${file.problems[0]?.detail}`)
    expect(broken).toEqual([])
  })

  it('finds a leg in every file', () => {
    expect(parsed.filter((file) => file.legs.length === 0)).toEqual([])
  })

  it('gives every leg at least two stops', () => {
    // A leg is a movement between facilities. One stop is not a leg.
    const thin = parsed.flatMap((file) =>
      file.legs.filter((leg) => leg.stops.length < 2).map(() => file.name),
    )
    expect(thin).toEqual([])
  })

  it('reads a distance for effectively all of them', () => {
    const legs = parsed.flatMap((file) => file.legs)
    const withDistance = legs.filter((leg) => leg.distance !== null)
    expect(legs.length).toBeGreaterThan(2_000)
    expect(withDistance.length / legs.length).toBeGreaterThan(0.99)
  })

  // THE MEASUREMENT THAT SETTLED THE JOIN RULE. Every bare Trip ID in 2,987
  // rows is its row's own Load ID; no prefixed one ever is. So a bare id is a
  // single-load booking named by its load, not a second namespace to
  // normalise — and the intersection of the two shapes is empty.
  it('confirms a bare Trip ID is always its own Load ID', () => {
    const legs = parsed.flatMap((file) => file.legs)
    const bare = legs.filter((leg) => !leg.tripId.startsWith('T-'))
    const prefixed = legs.filter((leg) => leg.tripId.startsWith('T-'))
    expect(bare.length).toBeGreaterThan(500)
    expect(bare.every((leg) => leg.tripId === leg.loadId)).toBe(true)
    expect(prefixed.some((leg) => leg.tripId === leg.loadId)).toBe(false)
  })

  it('and that the two id shapes never collide', () => {
    const legs = parsed.flatMap((file) => file.legs)
    const bare = new Set(
      legs
        .filter((leg) => !leg.tripId.startsWith('T-'))
        .map((leg) => leg.tripId),
    )
    const stripped = new Set(
      legs
        .filter((leg) => leg.tripId.startsWith('T-'))
        .map((leg) => leg.tripId.slice(2)),
    )
    const collisions = [...bare].filter((id) => stripped.has(id))
    expect(collisions).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// WHAT THE FILE PRINTS COMES BACK — PER STOP, PAIRWISE, IN BOTH READERS, AND
// THE HEADER NAMES ITSELF.
//
// Load 1010 lost every check-in while every DEPARTURE landed: four stops
// updated together, each taking a real `departedAt` beside a null `arrivedAt`.
// One column caused it. Amazon renamed the arrival pair from `Stop N Actual
// Arrival Date/Time` to `Stop N Actual Check-In Date/Time` — every export
// downloaded since 2026-08-17 carries the new name — and the departure pair
// beside it never changed, so the reader went on finding half of each stop.
//
// BOTH READERS ARE THE SUBJECT, because there is one file and two of them.
// `relay-csv.ts` knew only `Actual Check-In`; `trips-csv.ts`, written later,
// knew only `Actual Arrival`. Each was blind exactly where the other could
// see, for two phases, and nothing compared them because nothing ran the board
// reader over the sweep at all.
//
// THREE INSTRUMENTS MISSED IT, THE SAME WAY EVERY TIME.
//
//   * A corpus aggregate counted "stops carrying an arrival" across the sweep
//     and returned 1,002 of 1,285. It was read as proof arrivals parse. Every
//     swept file predated the rename, so the count was taken over a population
//     that could not contain the defect.
//   * The corpus itself was the second. Twenty-one post-rename exports sat
//     unswept in a downloads folder while the fixture directory held only
//     files from before it. A corpus that stops where the archive stops is a
//     record of what used to arrive.
//   * The first version of THIS test then ran over the renamed export and
//     passed, because it asked for `stop n actual arrival date` — the name the
//     parser believes in. A test that names the column cannot see the column
//     being renamed; it agrees with the bug in the parser's own words.
//
// SO NOTHING BELOW WRITES AN ARRIVAL COLUMN NAME. Every `Stop N <something>
// Date` with a `Time` beside it is discovered from the header, classified by
// whether its own name says departure, and the pair is asserted on the stop:
// both printed, both returned, by both readers. A column renamed next quarter
// arrives here as a named failure instead of as a delivered load with no
// check-ins.
// ---------------------------------------------------------------------------

describe.skipIf(files.length === 0)('every printed actual survives', () => {
  /**
   * The header, indexed HERE and not imported.
   *
   * A test that finds its columns the way the code under test finds them
   * cannot notice the code looking in the wrong place.
   */
  function ownIndex(header: readonly string[]): Map<string, number> {
    const index = new Map<string, number>()
    header.forEach((name, at) => {
      const key = name
        .replace(/^﻿/, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
      if (!index.has(key)) index.set(key, at)
    })
    return index
  }

  interface Family {
    /** What the header calls it: "actual check-in", "planned departure". */
    label: string
    date: number
    time: number
  }

  /**
   * Every date/time pair this file declares for stop N, as the file names them.
   *
   * DISCOVERED, NOT LISTED, which is the whole point: the labels come out of
   * the header, so a renamed column shows up here under its new name rather
   * than as an absent old one. The combined `Actual Check-in Date/Time` column
   * has no `Time` sibling and drops out, which is right — it is a different
   * column, not this pair written another way.
   */
  function familiesFor(index: Map<string, number>, n: number): Family[] {
    const out: Family[] = []
    const shape = new RegExp(`^stop ${n} (.+) date$`)
    for (const [key, at] of index) {
      const label = shape.exec(key)?.[1]
      if (label === undefined) continue
      const time = index.get(`stop ${n} ${label} time`)
      if (time === undefined) continue
      out.push({ label, date: at, time })
    }
    return out
  }

  const isActual = (family: Family) => family.label.includes('actual')
  const isDeparture = (family: Family) => family.label.includes('departure')

  /** One row's stops, as whichever reader is under test returned them. */
  interface ReadStop {
    facility: string
    arrival: unknown
    departure: unknown
  }

  interface Sweep {
    lost: string[]
    misaligned: string[]
    labels: Map<string, number>
    pairs: number
    compared: number
  }

  /**
   * Run one reader over the whole sweep and report what it lost.
   *
   * The reader is a parameter because the two of them disagreed about a column
   * name for two phases and no instrument put them side by side.
   */
  function sweep(read: (text: string) => ReadStop[][] | null): Sweep {
    const out: Sweep = {
      lost: [],
      misaligned: [],
      labels: new Map(),
      pairs: 0,
      compared: 0,
    }

    for (const name of files) {
      const text = readFileSync(join(CORPUS, name), 'utf8')
      const rows = parseCsv(text)
      if (rows.length < 2) continue

      const index = ownIndex(rows[0] ?? [])
      const at = (cells: readonly string[], column: number) =>
        (cells[column] ?? '').trim()
      const printed = (cells: readonly string[], family: Family) =>
        at(cells, family.date) !== '' && at(cells, family.time) !== ''
      const code = (cells: readonly string[], n: number) =>
        at(cells, index.get(`stop ${n}`) ?? -1)

      const dataRows = rows
        .slice(1)
        .filter((cells) => !cells.every((value) => value.trim() === ''))

      // Row alignment has to be exact for a per-stop comparison to mean
      // anything. A file the reader refuses, whole or in part, is a different
      // subject and is counted out rather than guessed at.
      const parsed = read(text)
      if (parsed === null || parsed.length !== dataRows.length) continue

      const stopCount = [...index.keys()].filter((key) =>
        /^stop \d+$/.test(key),
      ).length

      dataRows.forEach((cells, rowAt) => {
        const stops = parsed[rowAt]!

        // Both readers skip a Stop N whose code is blank, so `stops[2]` is not
        // necessarily stop 3. Rebuild the mapping rather than assume it.
        const numbers: number[] = []
        for (let n = 1; n <= stopCount; n++) {
          if (code(cells, n) !== '') numbers.push(n)
        }

        if (numbers.length !== stops.length) {
          out.misaligned.push(
            `${name} row ${rowAt + 2}: file names ${numbers.length} stops, ` +
              `reader returned ${stops.length}`,
          )
          return
        }

        stops.forEach((stop, position) => {
          const n = numbers[position]!
          out.compared++

          // If this fires the comparison below means nothing, so it is
          // reported as itself rather than surfacing as a lost clock.
          if (code(cells, n) !== stop.facility) {
            out.misaligned.push(
              `${name} row ${rowAt + 2} stop ${n}: file says ` +
                `${code(cells, n)}, reader says ${stop.facility}`,
            )
            return
          }

          const actuals = familiesFor(index, n).filter(isActual)
          for (const family of actuals) {
            if (printed(cells, family)) {
              out.labels.set(
                family.label,
                (out.labels.get(family.label) ?? 0) + 1,
              )
            }
          }

          const arrival = actuals
            .filter((family) => !isDeparture(family))
            .find((family) => printed(cells, family))
          const departure = actuals
            .filter(isDeparture)
            .find((family) => printed(cells, family))

          // THE PAIR. Both printed on this stop, so both must come back from
          // it. Either half alone is load 1010.
          if (!arrival || !departure) return
          out.pairs++

          if (!stop.arrival || !stop.departure) {
            out.lost.push(
              `${name} row ${rowAt + 2} stop ${n} (${stop.facility}): ` +
                `arrival=${stop.arrival ? 'read' : 'LOST'} from ` +
                `"${arrival.label}" ${at(cells, arrival.date)} ` +
                `${at(cells, arrival.time)}; ` +
                `departure=${stop.departure ? 'read' : 'LOST'} from ` +
                `"${departure.label}" ${at(cells, departure.date)} ` +
                `${at(cells, departure.time)}`,
            )
          }
        })
      })
    }

    return out
  }

  /** THE CONTROLS. An assertion that ran over nothing is the failure this
   * whole test exists to stop repeating, so the sample sizes are asserted
   * before the claim is. */
  function expectRealSample(result: Sweep) {
    expect(result.compared).toBeGreaterThan(1_000)
    expect(
      result.pairs,
      'no stop printed both halves — the pairwise claim was never tested',
    ).toBeGreaterThan(500)
    expect(result.misaligned.slice(0, 5)).toEqual([])
  }

  it('holds for the trips reader, which groups legs into a trip', () => {
    const result = sweep((text) => {
      const { legs, problems } = parseTripsCsv(text)
      if (problems.length > 0) return null
      return legs.map((leg) =>
        leg.stops.map((stop) => ({
          facility: stop.facilityCode,
          arrival: stop.actualArrival,
          departure: stop.actualDeparture,
        })),
      )
    })

    expectRealSample(result)
    expect(result.lost.slice(0, 5)).toEqual([])

    // AND THE CENSUS. Both spellings are live — the swept files carry one, the
    // exports downloaded since August carry the other — so a THIRD name
    // arriving fails here by name, before it costs a load its times.
    expect(
      [...result.labels.keys()].sort(),
      `actual-time columns printed in the sweep: ${[...result.labels]
        .map(([label, count]) => `${label} x${count}`)
        .join(', ')}`,
    ).toEqual(['actual arrival', 'actual check-in', 'actual departure'])
  })

  it('holds for the board reader, which makes a load per row', () => {
    const result = sweep((text) => {
      let trips
      try {
        trips = parseRelayCsv(text)
      } catch {
        // A file this reader refuses whole is not evidence about columns.
        return null
      }
      return trips.map((trip) =>
        trip.stops.map((stop) => ({
          facility: stop.facility,
          arrival: stop.actualArrival,
          departure: stop.actualDeparture,
        })),
      )
    })

    expectRealSample(result)
    expect(result.lost.slice(0, 5)).toEqual([])
  })
})
