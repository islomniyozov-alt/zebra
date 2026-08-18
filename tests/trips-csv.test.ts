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

  // RULE 6, ENFORCED BY ABSENCE. Amazon's internal allocation summed to ~$310
  // on a trip that paid $1,776. A column nothing parses cannot leak into a
  // rate field later, so the type has no home for it at all.
  it('does not carry Estimated Cost anywhere', () => {
    expect(JSON.stringify(legs[0])).not.toContain('1657.64')
    expect(Object.keys(legs[0] ?? {})).not.toContain('estimatedCost')
    const source = readFileSync('src/lib/trips-csv.ts', 'utf8')
    expect(source.toLowerCase()).not.toContain("'estimated cost'")
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
