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
// IT DOES NOT PRODUCE INSTANTS, and that is flag 14's ruling made structural.
//
// The first version turned each printed clock into a `Date` right here, using
// the row's own `Stop N UTC Offset` column as the authority. The Relay portal
// then settled what that column is: the printed clock is the FACILITY'S WALL
// CLOCK — `23:30` at FOE1 is 23:30 CDT — and the offset column is STATIC
// standard-time metadata that reads −6 all summer while Central is on −5.
// Subtracting it landed every August instant an hour late.
//
// So this file now hands back exactly what the file printed — a date and a
// clock, validated and not rearranged — and `relay-import.ts` turns them into
// instants in the stop's own zone, DST-aware, through the same machinery every
// other stop in Zebra uses. A parser that cannot see a facility cannot know
// its zone, and the zone is now part of the answer.
//
// WHAT THIS FILE REFUSES TO DO is as important as what it does:
//
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

/**
 * A clock face, as the export printed it — no zone attached.
 *
 * NOT a `Date`, on purpose. `08/11/2026 23:30` is a reading at a facility, and
 * it is not a moment in time until somebody says where the facility is. Making
 * it a `Date` here is what produced flag 14: it forced this file to pick an
 * offset, and the only one to hand was the wrong one.
 */
export interface RelayClock {
  /** ISO, so it can go straight into `zoneWallClock`. `2026-08-11`. */
  date: string
  hour: number
  minute: number
}

export interface RelayStop {
  /** The facility CODE, verbatim. `FOE1`, `BNSF-FAIRBURN-EFC`. */
  facility: string
  /**
   * The `Stop N UTC Offset` column, as the file gives it: `-6`.
   *
   * STATIC STANDARD-TIME METADATA, not the offset in force on the day — the
   * Relay portal settled that (flag 14). Kept because it still says which zone
   * family the facility is in and because it is worth cross-checking against
   * the resolved zone, but it no longer converts anything.
   */
  utcOffsetHours: number | null
  plannedArrival: RelayClock | null
  plannedDeparture: RelayClock | null
  actualArrival: RelayClock | null
  actualDeparture: RelayClock | null
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
  /**
   * `Estimated Cost`, in integer cents. Amazon's estimate, not a booked rate.
   *
   * THE OTHER RELAY EXPORT HAS A COLUMN OF THIS NAME AND IT IS READ BY
   * NOBODY. See `trips-csv.ts`, which parses the Trips export — a row per
   * LEG — where `Estimated Cost` is an internal allocation across the legs of
   * one trip and sums to about $310 on a trip that paid $1,776. Writing that
   * near a rate would be a fiction, so rule 6 of the trips build forbids
   * reading it at all and a test asserts the parser never names it.
   *
   * HERE IT IS THE ONLY RATE THERE IS. This file parses the load-board
   * export — a row per TRIP — where the column is one figure for the whole
   * move. Phase 6 flag 23 ruled it imported anyway: a load with no rate
   * cannot be reconciled against the weekly statement at all, and the
   * settlement is what corrects it.
   *
   * TWO TRUE RULINGS THAT LOOK CONTRADICTORY, so they point at each other.
   * The trap is proven: it alarmed the people who wrote both. Before citing
   * either, check which export is in hand — a row per trip, or a row per leg.
   */
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
 * A printed date and a printed time, as a clock face. No zone, no instant.
 *
 * Null unless both halves are there and both are exactly what the export
 * prints. Nothing is repaired and nothing is rearranged: `2026-08-11` in a
 * column documented as `MM/DD/YYYY` is a file that has changed shape, and
 * reading it anyway would be this parser deciding which of two readings of
 * `01/02/2026` it prefers.
 */
export function relayClock(date: string, time: string): RelayClock | null {
  const day = monthDayYear(date)
  const clock = hourMinute(time)
  if (!day || !clock) return null
  return {
    date: `${day[0]}-${String(day[1]).padStart(2, '0')}-${String(day[2]).padStart(2, '0')}`,
    hour: clock[0],
    minute: clock[1],
  }
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
      // THE FIRST NAME THAT YIELDS A WHOLE CLOCK, because Amazon renames
      // columns. This reader knew `Actual Check-In` and `trips-csv.ts` knew
      // `Actual Arrival`; both are right, for different halves of the archive,
      // and each was blind where the other could see. The pair is now a list
      // in both readers — one file, two readers, and never again two answers
      // about what a column is called.
      const moment = (...names: string[]) => {
        for (const name of names) {
          const clock = relayClock(at(`${name} Date`), at(`${name} Time`))
          if (clock) return clock
        }
        return null
      }

      stops.push({
        facility,
        utcOffsetHours: offset,
        plannedArrival: moment(`Stop ${number} Planned Arrival`),
        // The departure has its OWN date column and it is not always the
        // arrival's: `FOE1` in the corpus is planned in at 23:30 on the 11th
        // and out at 00:01 on the 12th. Reusing the arrival date would make
        // that window end twenty-three hours before it starts.
        plannedDeparture: moment(`Stop ${number} Planned Departure`),
        actualArrival: moment(
          `Stop ${number} Actual Check-In`,
          `Stop ${number} Actual Arrival`,
        ),
        actualDeparture: moment(`Stop ${number} Actual Departure`),
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
      // THE BOARD EXPORT'S COST, AND ONLY THIS FILE MAY READ IT. `trips-csv.ts`
      // refuses the same column name in the Trips export, where it means a
      // per-leg allocation rather than the trip's price. See `costCents` on
      // `RelayTrip` above for both rulings.
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
