// ---------------------------------------------------------------------------
// APPOINTMENT TIMES, IN THE STOP'S ZONE (design-system rule 3)
//
// "Every appointment time renders in the stop's local timezone, with the zone
// abbreviation shown. Never the browser's timezone. This is the single most
// expensive bug class in dispatch software."
//
// A driver told to be at a Dallas dock at 08:00 does not care what time it is
// in Dushanbe, and a dispatcher reading the board in Dushanbe must still see
// 08:00 CDT rather than 18:00. Rendering in the viewer's zone is the failure —
// it is silent, it looks right, and it puts a truck at a dock six hours late.
//
// THE SCHEMA HAS NO PER-STOP TIMEZONE, so this derives one from the stop's
// state. That is a real limitation and it is flagged in the Step 5 report:
//
//   * Seven states are split across two zones (FL, TX, KS, NE, ND, SD, ID,
//     OR, MI, IN, KY, TN, AK). Each maps to the zone that holds most of the
//     freight, which is right for the large majority of stops and wrong for a
//     dock in the Florida panhandle.
//   * A stop with no state at all falls back to the COMPANY's timezone, which
//     `Company.timezone` already carries — a better guess than the server's.
//
// The correct fix is a `timezone` column on `Location` (and a nullable
// override on `LoadStop`), populated at create-on-miss time. That is a
// migration and belongs to whoever builds the Locations screen.
// ---------------------------------------------------------------------------

/**
 * US state or territory → IANA zone.
 *
 * Split states are marked. Where a state spans two zones, the entry is the one
 * containing most of its population and most of its truck stops.
 */
const STATE_ZONES: Record<string, string> = {
  AL: 'America/Chicago',
  AK: 'America/Anchorage', // split: Aleutians are Hawaii-Aleutian
  AZ: 'America/Phoenix', // no DST, except the Navajo Nation
  AR: 'America/Chicago',
  CA: 'America/Los_Angeles',
  CO: 'America/Denver',
  CT: 'America/New_York',
  DE: 'America/New_York',
  DC: 'America/New_York',
  FL: 'America/New_York', // split: the panhandle west of the Apalachicola is Central
  GA: 'America/New_York',
  HI: 'Pacific/Honolulu',
  ID: 'America/Boise', // split: the panhandle is Pacific
  IL: 'America/Chicago',
  IN: 'America/Indiana/Indianapolis', // split: the northwest and southwest corners are Central
  IA: 'America/Chicago',
  KS: 'America/Chicago', // split: four western counties are Mountain
  KY: 'America/New_York', // split: the western third is Central
  LA: 'America/Chicago',
  ME: 'America/New_York',
  MD: 'America/New_York',
  MA: 'America/New_York',
  MI: 'America/Detroit', // split: four Upper Peninsula counties are Central
  MN: 'America/Chicago',
  MS: 'America/Chicago',
  MO: 'America/Chicago',
  MT: 'America/Denver',
  NE: 'America/Chicago', // split: the western panhandle is Mountain
  NV: 'America/Los_Angeles',
  NH: 'America/New_York',
  NJ: 'America/New_York',
  NM: 'America/Denver',
  NY: 'America/New_York',
  NC: 'America/New_York',
  ND: 'America/Chicago', // split: the southwest is Mountain
  OH: 'America/New_York',
  OK: 'America/Chicago',
  OR: 'America/Los_Angeles', // split: most of Malheur County is Mountain
  PA: 'America/New_York',
  PR: 'America/Puerto_Rico',
  RI: 'America/New_York',
  SC: 'America/New_York',
  SD: 'America/Chicago', // split: the west is Mountain
  TN: 'America/New_York', // split: the western half is Central
  TX: 'America/Chicago', // split: El Paso and Hudspeth are Mountain
  UT: 'America/Denver',
  VT: 'America/New_York',
  VA: 'America/New_York',
  WA: 'America/Los_Angeles',
  WV: 'America/New_York',
  WI: 'America/Chicago',
  WY: 'America/Denver',
  // Canada, for the lanes that cross.
  AB: 'America/Edmonton',
  BC: 'America/Vancouver',
  MB: 'America/Winnipeg',
  ON: 'America/Toronto',
  QC: 'America/Toronto',
  SK: 'America/Regina',
}

/** States this map is knowingly wrong about for part of their area. */
export const SPLIT_STATES = new Set([
  'AK',
  'FL',
  'ID',
  'IN',
  'KS',
  'KY',
  'MI',
  'ND',
  'NE',
  'OR',
  'SD',
  'TN',
  'TX',
])

/**
 * The zones a place may be SET to, offered in the load screen.
 *
 * Derived from the map rather than typed out again, so a zone can never be
 * offered that nothing here knows how to render. A free-text field would let
 * somebody store `CST`, which is not an IANA name, does not observe daylight
 * time, and would be discovered as a wrong appointment.
 */
export const ZONE_CHOICES: readonly string[] = [
  ...new Set(Object.values(STATE_ZONES)),
].sort()

export function zoneForState(
  state: string | null | undefined,
  fallback: string,
): string {
  if (!state) return fallback
  return STATE_ZONES[state.trim().toUpperCase()] ?? fallback
}

/**
 * The zone for a state that has exactly one, or null.
 *
 * What may be STORED as fact, as opposed to what may be shown as a marked
 * approximation. A split state returns null so that the column stays empty
 * and the interface keeps saying it is guessing — a guess written into the
 * database stops looking like a guess the moment somebody reads it back.
 */
export function unambiguousZone(
  state: string | null | undefined,
): string | null {
  if (!state) return null
  const code = state.trim().toUpperCase()
  if (SPLIT_STATES.has(code)) return null
  return STATE_ZONES[code] ?? null
}

/**
 * The zone to render a stop in, and whether it is known or derived.
 *
 * Precedence, and it only goes one way: an explicitly recorded zone always
 * wins, because somebody who knows the dock typed it.
 */
export function resolveZone(
  explicit: string | null | undefined,
  state: string | null | undefined,
  fallback: string,
): { zone: string; approximate: boolean } {
  if (explicit) return { zone: explicit, approximate: false }
  return {
    zone: zoneForState(state, fallback),
    approximate: state ? SPLIT_STATES.has(state.trim().toUpperCase()) : true,
  }
}

/**
 * Midnight on `isoDate` **in `zone`**, as an instant.
 *
 * The create form captures a date and no time. Storing that at UTC midnight
 * and then rendering it in the stop's zone walks the day backwards — a pickup
 * typed as September 15th displayed as "Sep 14, 19:00 CDT", which is rule 3's
 * failure mode committed by the very code meant to honour it. Found in a
 * screenshot of the Step 5 detail screen.
 *
 * So a date-only appointment is stored as midnight where the stop is. The day
 * then survives the round trip, and `renderStopTime` shows it without a time
 * because midnight-local is how "no time was given" is spelled.
 *
 * Computed by asking Intl what the offset is at that moment rather than by
 * arithmetic on a table: it has to be right across the DST boundary, and
 * "how many hours is Chicago behind UTC" has two answers.
 */
export function zoneMidnight(isoDate: string, zone: string): Date {
  return zoneWallClock(isoDate, 0, 0, zone)
}

/**
 * A wall-clock reading **in `zone`**, as an instant.
 *
 * `zoneMidnight` is this with the hands at twelve, and was this function until
 * Phase 6 §3a needed the general case: an Amazon Relay export prints
 * `08/11/2026 23:30` at a facility and means 23:30 THERE. Turning that into an
 * instant is the same problem as midnight and has the same two-pass answer.
 *
 * DST-AWARE BY CONSTRUCTION, and that is the whole reason it exists rather
 * than the caller adding hours to `zoneMidnight`. Adding 23.5 hours to a
 * midnight is wrong on the two days a year a zone changes offset — the day is
 * 23 or 25 hours long and the arithmetic does not know. It is also wrong
 * whenever a stored offset disagrees with the real one, which is exactly the
 * case flag 14 turned out to be.
 *
 * Ambiguous and non-existent local times (the hour that repeats in autumn, the
 * hour that does not exist in spring) resolve to whatever the second pass
 * settles on. Freight is not booked into those hours often enough to invent a
 * policy for them, and inventing one silently would be worse than landing an
 * hour out on a stop nobody scheduled.
 */
export function zoneWallClock(
  isoDate: string,
  hour: number,
  minute: number,
  zone: string,
): Date {
  const [year, month, day] = isoDate.split('-').map(Number) as [
    number,
    number,
    number,
  ]
  const wallClock = Date.UTC(year, month - 1, day, hour, minute)

  // Twice, because the offset depends on the instant and the instant depends
  // on the offset. One pass is right except within an hour of a DST change;
  // the second settles it.
  let instant = wallClock
  for (let pass = 0; pass < 2; pass++) {
    instant = wallClock + offsetMs(new Date(instant), zone)
  }
  return new Date(instant)
}

/**
 * How far `zone` is from UTC at this instant, in whole hours. `-5` for Chicago
 * in August, `-6` in January.
 *
 * The cross-check half of flag 14: an export that ships a static offset can be
 * compared against what the resolved zone actually was at that moment, and a
 * disagreement bigger than the hour DST explains means the zone is wrong.
 */
export function zoneOffsetHours(at: Date, zone: string): number {
  return -offsetMs(at, zone) / 3_600_000
}

/**
 * How far `zone` is behind UTC at this instant, in milliseconds.
 *
 * Via `formatToParts` rather than by parsing a localised string: parsing
 * `toLocaleString` output re-interprets it in the RUNNING machine's zone,
 * which is a second conversion nobody asked for. The first version of
 * `zoneMidnight` did exactly that and produced "Sep 14, 20:00 CDT" for
 * September the 15th — the same off-by-a-day it was written to fix.
 */
function offsetMs(at: Date, zone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>

  const asUtc = Date.UTC(
    Number(parts['year']),
    Number(parts['month']) - 1,
    Number(parts['day']),
    Number(parts['hour']) % 24,
    Number(parts['minute']),
    Number(parts['second']),
  )
  return at.getTime() - asUtc
}

export interface RenderedStopTime {
  /** `Jul 28, 14:30 CDT` — §8's format, verbatim. */
  text: string
  /** The IANA zone actually used, for the title attribute. */
  zone: string
  /** True where the state spans zones and this is a best guess. */
  approximate: boolean
}

/**
 * Render an appointment time in the stop's zone, with the abbreviation.
 *
 * `Intl` supplies the abbreviation, which means it is correct across the DST
 * boundary without a table: the same instant in Chicago is CST in January and
 * CDT in July, and hard-coding either would be wrong for half the year.
 */
export function renderStopTime(
  at: Date | null | undefined,
  state: string | null | undefined,
  options: {
    fallbackZone: string
    locale?: string
    /** The facility's recorded zone. Wins over the state when present. */
    zone?: string | null
  },
): RenderedStopTime | null {
  if (!at) return null

  const resolved = resolveZone(options.zone, state, options.fallbackZone)
  const zone = resolved.zone
  const locale = options.locale ?? 'en-US'

  // Midnight in the stop's own zone means no time was given, only a day. §8:
  // a date-only field takes no timezone, so showing "00:00 CDT" would be
  // inventing a 12am appointment nobody made.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at)
  const dateOnly = parts === '00:00' || parts === '24:00'

  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    month: 'short',
    day: 'numeric',
    ...(dateOnly
      ? {}
      : {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZoneName: 'short',
        }),
  })

  return {
    text: formatter.format(at),
    zone,
    approximate: resolved.approximate,
  }
}

/** `Jul 28, 2026` — a date-only field takes no timezone at all (§8). */
export function renderDateOnly(
  at: Date | null | undefined,
  locale = 'en-US',
): string | null {
  if (!at) return null
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(at)
}
