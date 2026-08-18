import { parseCsv } from './relay-csv'

// ---------------------------------------------------------------------------
// THE RELAY **TRIPS** EXPORT, PARSED. NO MODEL, NO GUESSES.
//
// A different file from the load-board export that `relay-csv.ts` reads, and a
// different shape: ONE FILE PER TRIP, ONE ROW PER LEG. A two-leg trip is two
// rows carrying the same Trip ID, each naming its own facilities, distance and
// clocks.
//
// WHAT THIS FILE WILL NOT DO:
//
//   * It does not read `Estimated Cost`. Amazon's internal allocation summed
//     to ~$310 on a trip that paid $1,776, and a column nothing parses cannot
//     leak into a rate field later. Rule 6, enforced by absence.
//   * It does not decide anything about loads. Legs come out; what becomes a
//     stop chain is `trips-import.ts`'s judgment, made where it can be tested
//     without a file.
//
// THE HEADER NEEDS NORMALISING BEFORE IT CAN BE MATCHED. Real exports begin
// with a BOM, and several stop columns carry DOUBLE SPACES — "Stop 1  Actual
// Arrival Date" — inconsistently, between adjacent columns of the same family.
// Matching literals against that would be matching Amazon's typing.
//
// CLOCKS ARE PRINTED FACES, NOT INSTANTS, which is flag 14's rule and the
// reason a `RelayClock` exists. Each stop carries its own UTC offset column,
// and that offset is STANDARD-TIME METADATA: it does not follow the printed
// clock into daylight saving. So the pair is kept apart here and resolved by
// the importer against the facility's real zone, exactly as the load-board
// importer does.
// ---------------------------------------------------------------------------

/** No file in the 1,600-export sweep came close; this is a runaway guard. */
export const MAX_TRIP_LEGS = 60

/** One printed clock face: the date and time as the document shows them. */
export interface TripClock {
  /** `YYYY-MM-DD`, from the export's `MM/DD/YYYY`. */
  date: string
  /** `HH:MM`, 24-hour. */
  time: string
  /**
   * The offset column beside it, in whole hours, or null.
   *
   * NOT USED TO BUILD AN INSTANT. Flag 14: this is standard-time metadata and
   * disagrees with the printed clock by an hour for half the year. It travels
   * so the importer can cross-check the zone it resolves and warn when the two
   * disagree by more than daylight saving explains.
   */
  utcOffsetHours: number | null
}

/** One stop as a leg names it. */
export interface TripLegStop {
  /** The facility code — "DEN7", "MKC6". The seed's key. */
  facilityCode: string
  plannedArrival: TripClock | null
  plannedDeparture: TripClock | null
  actualArrival: TripClock | null
  actualDeparture: TripClock | null
}

/** One row: one leg of one trip. */
export interface TripLeg {
  tripId: string
  /** This leg's own load number. Becomes the STOP's referenceNumber. */
  loadId: string
  /** "DEN7->MKC6", as printed. */
  facilitySequence: string
  /** "Completed", "Cancelled", "Not Started", "In Progress". */
  status: string
  /** `Estimate Distance`, in the unit the file names. Null when absent. */
  distance: number | null
  /** `Unit` — "mi" everywhere in the sweep, kept rather than assumed. */
  distanceUnit: string | null
  /** `Shipper Account`. The only evidence of loaded-versus-empty. */
  shipperAccount: string
  /** Informational for v1: shown in the preview, never auto-assigned. */
  driverName: string
  trailerId: string
  tractorId: string
  /** In file order, as the Stop N columns appear. */
  stops: TripLegStop[]
}

/** A row that could not become a leg, and why — surfaced, never dropped. */
export interface TripRowProblem {
  /** 1-based, counting the header as row 1, so it matches a spreadsheet. */
  row: number
  reason: 'no_trip_id' | 'no_stops' | 'too_many_stops'
  detail: string
}

export interface ParsedTripsFile {
  legs: TripLeg[]
  problems: TripRowProblem[]
}

/**
 * A header cell as it will be matched.
 *
 * The BOM goes, runs of whitespace collapse to one space, and the case is
 * folded. "Stop 1  Actual Arrival Date" and "Stop 1 Actual Arrival Date" are
 * the same column written twice by the same exporter.
 */
export function normalizeHeader(cell: string): string {
  return cell.replace(/^﻿/, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/** `MM/DD/YYYY` to `YYYY-MM-DD`, or null if it is not that. */
export function tripDate(value: string): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim())
  if (!match) return null
  const [, month, day, year] = match
  const m = Number(month)
  const d = Number(day)
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** `HH:MM` (24-hour) as printed, or null. */
export function tripTime(value: string): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return `${String(hour).padStart(2, '0')}:${match[2]}`
}

/** The offset column: "-7", "-6", "+0". Null when absent or unreadable. */
export function tripOffset(value: string): number | null {
  const text = value.trim()
  if (text === '') return null
  const hours = Number(text)
  if (!Number.isFinite(hours) || Math.abs(hours) > 14) return null
  return hours
}

function clockAt(
  cells: readonly string[],
  index: Record<string, number>,
  dateKey: string,
  timeKey: string,
  offset: number | null,
): TripClock | null {
  const date = tripDate(cells[index[dateKey] ?? -1] ?? '')
  const time = tripTime(cells[index[timeKey] ?? -1] ?? '')
  // BOTH HALVES OR NEITHER. A date with no clock is not a moment, and half a
  // clock printed into a window is worse than an absent one.
  if (date === null || time === null) return null
  return { date, time, utcOffsetHours: offset }
}

/**
 * Every leg in one Trips export.
 *
 * Deterministic and total: a row this cannot read becomes a problem with its
 * spreadsheet row number, never a silent omission. A file whose rows all fail
 * produces zero legs and a list of reasons, which is a thing a preview can
 * show and a thing an empty result cannot.
 */
export function parseTripsCsv(text: string): ParsedTripsFile {
  const rows = parseCsv(text)
  if (rows.length < 2) return { legs: [], problems: [] }

  const header = (rows[0] ?? []).map(normalizeHeader)
  const index: Record<string, number> = {}
  header.forEach((name, at) => {
    // FIRST WINS. A duplicated header is Amazon's business; silently taking
    // the last would make the column that answered a question depend on how
    // many times it was asked.
    if (!(name in index)) index[name] = at
  })

  const at = (name: string) => index[name.toLowerCase()] ?? -1
  const cell = (cells: readonly string[], name: string) =>
    (cells[at(name)] ?? '').trim()

  /** How many "Stop N" columns this file declares. */
  const stopCount = header.filter((name) => /^stop \d+$/.test(name)).length

  const legs: TripLeg[] = []
  const problems: TripRowProblem[] = []

  rows.slice(1).forEach((cells, offset) => {
    const row = offset + 2
    if (cells.every((value) => value.trim() === '')) return

    const tripId = cell(cells, 'Trip ID')
    if (tripId === '') {
      problems.push({
        row,
        reason: 'no_trip_id',
        detail: 'the row names no trip',
      })
      return
    }

    const stops: TripLegStop[] = []
    for (let n = 1; n <= stopCount; n++) {
      const code = cell(cells, `Stop ${n}`)
      if (code === '') continue

      const utc = tripOffset(cell(cells, `Stop ${n} UTC Offset`))
      stops.push({
        facilityCode: code,
        plannedArrival: clockAt(
          cells,
          index,
          `stop ${n} planned arrival date`,
          `stop ${n} planned arrival time`,
          utc,
        ),
        plannedDeparture: clockAt(
          cells,
          index,
          `stop ${n} planned departure date`,
          `stop ${n} planned departure time`,
          utc,
        ),
        actualArrival: clockAt(
          cells,
          index,
          `stop ${n} actual arrival date`,
          `stop ${n} actual arrival time`,
          utc,
        ),
        actualDeparture: clockAt(
          cells,
          index,
          `stop ${n} actual departure date`,
          `stop ${n} actual departure time`,
          utc,
        ),
      })
    }

    if (stops.length === 0) {
      problems.push({
        row,
        reason: 'no_stops',
        detail: `${tripId} names no facilities`,
      })
      return
    }

    if (stops.length > MAX_TRIP_LEGS) {
      problems.push({
        row,
        reason: 'too_many_stops',
        detail: `${tripId} declares ${stops.length} stops`,
      })
      return
    }

    const distanceText = cell(cells, 'Estimate Distance')
    const distance = distanceText === '' ? null : Number(distanceText)

    legs.push({
      tripId,
      loadId: cell(cells, 'Load ID'),
      facilitySequence: cell(cells, 'Facility Sequence'),
      status: cell(cells, 'Load Execution Status'),
      distance: Number.isFinite(distance) ? distance : null,
      distanceUnit: cell(cells, 'Unit') || null,
      shipperAccount: cell(cells, 'Shipper Account'),
      driverName: cell(cells, 'Driver Name'),
      trailerId: cell(cells, 'Trailer ID'),
      tractorId: cell(cells, 'Tractor Vehicle ID'),
      stops,
    })
  })

  return { legs, problems }
}
