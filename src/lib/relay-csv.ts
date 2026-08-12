import { MoneyFormatError, parseMoneyToCents } from './money'

// ---------------------------------------------------------------------------
// THE AMAZON RELAY TRIPS EXPORT, AS COLUMNS (Phase 6 §3a).
//
// NO MODEL CALL HAPPENS IN THIS FILE, and that is the whole design. Phase 5
// built an extraction because a rate confirmation is a PAGE — every broker
// lays one out differently and only a reader can tell a pickup date from a
// print date. A Relay export is a SPREADSHEET Amazon generates: the columns
// are in a fixed order with fixed names, and "Stop 2 Planned Arrival Time" is
// the planned arrival time of stop 2 in every file that will ever be exported.
//
// Asking a model to read that would be paying per token for a lookup, and
// worse, it would make a deterministic mapping non-deterministic — the
// extraction contract's own observed-instability tables are the argument. A
// column is a mapping. Only a page is an extraction.
//
// WHAT THIS FILE REFUSES TO DO is as important as what it does:
//
//   * it does not GUESS A TIMEZONE. Every stop carries its own UTC offset
//     column and that column is the authority. The facility codes — `FOE1`,
//     `BNSF-FAIRBURN-EFC` — carry no address at all, so there is nothing else
//     to derive a zone from, and deriving one from a code would be inventing
//     a fact. A time with no offset beside it is a refusal, not a guess.
//   * it does not SPLIT `LG_ELECT_37040_1720_825` into a street and a ZIP.
//     37040 is Clarksville, Tennessee and 1720 looks like a building number,
//     and both of those are inferences about a string Amazon composed for its
//     own reasons. The code is carried through as a facility name.
//   * it does not MATCH A DRIVER BY NAME. See relay-import.ts for what that
//     costs.
// ---------------------------------------------------------------------------

export type RelayCsvFailure =
  | 'empty'
  | 'not_relay'
  | 'no_rows'
  | 'too_many_rows'

export class RelayCsvError extends Error {
  constructor(
    readonly reason: RelayCsvFailure,
    message: string,
  ) {
    super(message)
    this.name = 'RelayCsvError'
  }
}

/**
 * A ceiling on one import.
 *
 * Not a technical limit — a blast radius. The confirm step posts the whole
 * file back and writes every row in one transaction, and a file with ten
 * thousand rows in it is a mistake rather than a week's work.
 */
export const MAX_IMPORT_ROWS = 200

export interface RelayStop {
  /** The facility CODE, verbatim. `FOE1`, `BNSF-FAIRBURN-EFC`. */
  facility: string
  /** Hours from UTC, as the file gives it: `-6`. Null when the column is empty. */
  utcOffsetHours: number | null
  plannedArrival: Date | null
  plannedDeparture: Date | null
  actualArrival: Date | null
  actualDeparture: Date | null
  containerId: string | null
}

export interface RelayTrip {
  /** 1-based, counting data rows only. What the preview names a row by. */
  rowNumber: number
  tripId: string | null
  /** The per-load key. One trip can carry several. */
  loadId: string | null
  /** `FOE1->MCI4` — Amazon's own statement of the sequence. Cross-checked. */
  facilitySequence: string | null
  /** `Completed`, `In Progress`. Per LOAD, unlike `tripStage`. */
  executionStatus: string | null
  tripStage: string | null
  driverName: string | null
  /** `53' Trailer`, `53' Container`. */
  equipmentText: string | null
  trailerId: string | null
  tractorId: string | null
  /** Whole miles, floored. `wholeNumber` refuses a decimal and every row has one. */
  distanceMiles: number | null
  /** `Estimated Cost`, in integer cents. Amazon's estimate, not a booked rate. */
  costCents: number | null
  currency: string | null
  shipperAccount: string | null
  subCarrier: string | null
  stops: RelayStop[]
}

// --- the CSV itself --------------------------------------------------------

/**
 * Rows of fields, quotes honoured.
 *
 * Written rather than depended on: the whole grammar is three rules, it runs
 * on workerd, and a parser dependency for this is a supply chain for a
 * hundred lines. Handles the two things Amazon's export actually does — a
 * UTF-8 BOM and bare LF endings — and the one it could start doing at any
 * time, which is quoting a facility name that contains a comma.
 */
export function parseCsv(text: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let index = 0; index < source.length; index++) {
    const char = source[index]!

    if (quoted) {
      if (char === '"') {
        // A doubled quote is a literal one; a lone quote closes the field.
        if (source[index + 1] === '"') {
          field += '"'
          index++
        } else {
          quoted = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"' && field === '') {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      // CRLF is one ending, not two. Skip the LF that follows a CR.
      if (char === '\r' && source[index + 1] === '\n') index++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }

  // A file that does not end in a newline still has a last row.
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows.filter((entry) => entry.some((value) => value.trim() !== ''))
}

/**
 * A header, folded for lookup.
 *
 * WHITESPACE RUNS COLLAPSE, and that is not decoration. The real export ships
 * `Stop 1  Planned Departure Date` with TWO spaces — every stop's departure
 * columns do — while every other column has one. An exact-name lookup finds
 * the arrival times and silently misses every departure, which is a window
 * with no end on every stop of every load, and nothing would have failed.
 */
function fold(header: string): string {
  return header.trim().replace(/\s+/g, ' ').toLowerCase()
}

// --- the columns -----------------------------------------------------------

/** `08/11/2026` → [2026, 8, 11], or null. Strict: no repair, no rearranging. */
function monthDayYear(value: string): [number, number, number] | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim())
  if (!match) return null
  const month = Number(match[1])
  const day = Number(match[2])
  const year = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  // A round trip catches February the 30th, which the range check does not.
  const probe = new Date(Date.UTC(year, month - 1, day))
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null
  }
  return [year, month, day]
}

/** `23:30` → [23, 30], or null. */
function hourMinute(value: string): [number, number] | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return [hour, minute]
}

/**
 * A date, a clock time and the stop's own offset, as an instant.
 *
 * THE OFFSET COLUMN IS THE AUTHORITY — the owner's ruling, and the only
 * defensible reading: a facility code has no address, so there is no zone to
 * look up and no state to fall back on. `zoneMidnight` cannot help here
 * because it needs an IANA zone and this file has none.
 *
 * Returns null unless all three are present and valid. A time with a date and
 * no offset is reported as a refusal by the caller rather than anchored to a
 * zone somebody assumed.
 */
export function relayInstant(
  date: string,
  time: string,
  utcOffsetHours: number | null,
): Date | null {
  if (utcOffsetHours === null) return null
  const day = monthDayYear(date)
  const clock = hourMinute(time)
  if (!day || !clock) return null
  return new Date(
    Date.UTC(day[0], day[1] - 1, day[2], clock[0], clock[1]) -
      utcOffsetHours * 3_600_000,
  )
}

/** `-6` → -6. Refuses anything that is not a plain signed hour count. */
function offsetHours(value: string): number | null {
  const text = value.trim()
  if (text === '') return null
  if (!/^[+-]?\d{1,2}(\.\d+)?$/.test(text)) return null
  const hours = Number(text)
  // Real offsets run -12..+14. Anything outside is a column that has changed
  // meaning, and shifting a load by fifty hours is not a rounding error.
  return hours >= -12 && hours <= 14 ? hours : null
}

/**
 * The Relay export, as trips.
 *
 * One data row is one LOAD — `Trip ID` repeats across the rows of a
 * multi-load trip, `Load ID` does not.
 */
export function parseRelayCsv(text: string): RelayTrip[] {
  if (text.trim() === '') {
    throw new RelayCsvError('empty', 'The file is empty.')
  }

  const rows = parseCsv(text)
  const header = rows[0]
  if (!header) {
    throw new RelayCsvError('empty', 'The file has no header row.')
  }

  const index = new Map<string, number>()
  header.forEach((name, position) => {
    const key = fold(name)
    // FIRST WINS. A duplicated header — Amazon has shipped `Stop 1 Actual
    // Check-In Time` and `Stop 1 Actual Check-in Date/Time` in one file — must
    // not have its earlier column quietly replaced by a later one.
    if (key !== '' && !index.has(key)) index.set(key, position)
  })

  // IS THIS THE RIGHT FILE AT ALL? A dispatcher who uploads a settlement
  // export instead of a trips export should be told that, not handed a
  // preview of zero loads that looks like the file was fine and empty.
  if (!index.has('load id') || !index.has('stop 1')) {
    throw new RelayCsvError(
      'not_relay',
      'This is not a Relay Trips export: it has no "Load ID" or "Stop 1" column.',
    )
  }

  // HOW MANY STOPS THE FILE HAS, from the file. The corpus is two-stop
  // throughout, and a multi-stop Amazon run is exactly what §5 of the spec is
  // about — counting the columns costs nothing and hard-coding 2 would drop
  // stops 3 and 4 the first time one arrives, silently and in the middle.
  let stopCount = 0
  while (index.has(`stop ${stopCount + 1}`)) stopCount++

  const body = rows.slice(1)
  if (body.length === 0) {
    throw new RelayCsvError('no_rows', 'The file has a header and no trips.')
  }
  if (body.length > MAX_IMPORT_ROWS) {
    throw new RelayCsvError(
      'too_many_rows',
      `The file has ${body.length} rows; one import covers ${MAX_IMPORT_ROWS}.`,
    )
  }

  return body.map((row, position) => {
    const at = (name: string): string => {
      const column = index.get(fold(name))
      if (column === undefined) return ''
      return (row[column] ?? '').trim()
    }
    const text = (name: string): string | null => at(name) || null

    const stops: RelayStop[] = []
    for (let number = 1; number <= stopCount; number++) {
      const facility = at(`Stop ${number}`)
      // A trailing empty stop column is how a two-stop row sits in a
      // four-stop file. Skipped, not recorded as a stop with no name.
      if (facility === '') continue

      const offset = offsetHours(at(`Stop ${number} UTC Offset`))
      const moment = (date: string, time: string) =>
        relayInstant(at(date), at(time), offset)

      stops.push({
        facility,
        utcOffsetHours: offset,
        plannedArrival: moment(
          `Stop ${number} Planned Arrival Date`,
          `Stop ${number} Planned Arrival Time`,
        ),
        // The departure has its OWN date column and it is not always the
        // arrival's: `FOE1` in the corpus is planned in at 23:30 on the 11th
        // and out at 00:01 on the 12th. Reusing the arrival date would make
        // that window end twenty-three hours before it starts.
        plannedDeparture: moment(
          `Stop ${number} Planned Departure Date`,
          `Stop ${number} Planned Departure Time`,
        ),
        actualArrival: moment(
          `Stop ${number} Actual Check-In Date`,
          `Stop ${number} Actual Check-In Time`,
        ),
        actualDeparture: moment(
          `Stop ${number} Actual Departure Date`,
          `Stop ${number} Actual Departure Time`,
        ),
        containerId: text(`Stop ${number} Container ID`),
      })
    }

    return {
      rowNumber: position + 1,
      tripId: text('Trip ID'),
      loadId: text('Load ID'),
      facilitySequence: text('Facility Sequence'),
      executionStatus: text('Load Execution Status'),
      tripStage: text('Trip Stage'),
      driverName: text('Driver Name'),
      equipmentText: text('Equipment Type'),
      trailerId: text('Trailer ID'),
      tractorId: text('Tractor Vehicle ID'),
      distanceMiles: wholeMiles(at('Estimate Distance'), at('Unit')),
      costCents: money(at('Estimated Cost')),
      currency: text('Currency'),
      shipperAccount: text('Shipper Account'),
      subCarrier: text('Sub Carrier'),
      stops,
    }
  })
}

/**
 * `26.04` → 26.
 *
 * FLOORED for the reason the extracted weight is floored: `wholeNumber` in
 * loads.ts refuses a decimal outright, every row of the export carries one,
 * and 26 is what a dispatcher would file. Rounding up would invent distance
 * the load did not run, which is the direction that overstates a per-mile
 * figure later.
 *
 * A unit that is not miles returns null rather than being converted:
 * `dispatchedMiles` is a column named in miles, and quietly storing
 * kilometres in it would be wrong in a way no screen could show.
 */
function wholeMiles(value: string, unit: string): number | null {
  if (value === '') return null
  if (unit !== '' && unit.toLowerCase() !== 'mi') return null
  const miles = Number(value)
  if (!Number.isFinite(miles) || miles < 0) return null
  return Math.floor(miles)
}

/** `477.89` → 47789. Exact, via the money module — never `× 100` on a float. */
function money(value: string): number | null {
  if (value === '') return null
  try {
    const cents = parseMoneyToCents(value)
    return cents >= 0 ? cents : null
  } catch (error) {
    if (error instanceof MoneyFormatError) return null
    throw error
  }
}
