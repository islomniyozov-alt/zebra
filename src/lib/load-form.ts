import type { LoadStop } from '@/generated/prisma/client'
import { optionalText } from './reference'
import { normalizeTypedDate, normalizeTypedTime } from './typed-date'
import { localDateIn, resolveZone, zoneMidnight } from './stop-time'
import type { StopInput } from './loads'

// ---------------------------------------------------------------------------
// WHAT THE LOAD FORM POSTS, READ ONCE FOR ADD LOAD AND EDIT LOAD.
//
// These lived in the create action's `'use server'` file, where no test could
// reach them and no second caller could share them. Edit load (TMS §7.14 part
// 7, v11.60) is Add load's own form, so it reads stops, dates and money the
// same way, through the same functions: one behaviour, one home.
// ---------------------------------------------------------------------------

/**
 * When a stop is due, as an instant **in the stop's own zone**.
 *
 * NOT UTC. A pickup typed as September 15th, stored at UTC midnight and then
 * rendered in the stop's zone per design rule 3, displays as "Sep 14, 19:00
 * CDT" — the rule's own failure mode, committed by the code meant to honour
 * it. Caught in a screenshot of the Step 5 detail screen.
 *
 * Parsed here as well as in the browser, and not because the browser is
 * untrusted about dates — because the form works without JavaScript, and the
 * blur handler that normalises "810" into "2026-08-10" is JavaScript.
 *
 * THE CLOCK BELONGS TO THE APPOINTMENT, and until 2026-08-17 it had nowhere to
 * go. This returned midnight and nothing else, so a document printing "Pickup
 * 08/14 03:45" produced a load whose stop time was 00:00 — the appointment
 * discarded on the way through a form that had no field for it. It survived
 * being flagged once because the visible symptom was two empty clock boxes,
 * and a fix that filled them in would have entrenched the real fault.
 *
 * ONE TIME MEANS AN APPOINTMENT; TWO MEAN A WINDOW. A dispatcher typing a
 * single clock is saying when the stop is due, and that is `scheduledAt`. When
 * they type both ends, `windowStart`/`windowEnd` carry the window and this
 * still records the start as the moment the stop is due — the same instant a
 * board sorts by, rather than a midnight that sorts before every load booked
 * that day.
 *
 * MIDNIGHT REMAINS THE ANSWER FOR A DATE WITH NO CLOCK, which is the ordinary
 * typed load: a date alone is a date alone, and inventing 09:00 for it would
 * be a number about freight that nobody wrote down.
 */
export function stopDate(
  value: unknown,
  place: { state: string | null; timezone: string | null },
  clock?: unknown,
): Date | null {
  const text = optionalText(value)
  if (text === null) return null
  const iso = normalizeTypedDate(text)
  if (iso === null) return null
  // The facility's recorded zone wins over the state's — that is the whole
  // point of Location.timezone.
  const { zone } = resolveZone(
    place.timezone,
    place.state,
    COMPANY_FALLBACK_ZONE,
  )

  const typed = optionalText(clock)
  if (typed !== null) {
    const moment = stopMoment(iso, typed, place)
    if (moment !== null) return moment
  }

  return zoneMidnight(iso, zone)
}

/**
 * Where a stop with no state is assumed to be.
 *
 * The company's own zone would be better and is one query away; it is not read
 * here because this is the create path and the stop's state is almost always
 * present. Flagged in the Step 5 report.
 */
export const COMPANY_FALLBACK_ZONE = 'America/Chicago'

/**
 * A date and a clock time, as an instant in the STOP's own zone.
 *
 * The same rule `stopDate` follows and for the same reason: design rule 3 says
 * the stop's zone decides, and a window built at UTC midnight-plus-eight shows
 * a Florida dock opening at three in the morning. Null unless BOTH halves are
 * there — a time with no date is not a moment, and `createLoad` refuses a
 * window that ends before it starts, so half a window is worse than none.
 */
export function stopMoment(
  date: string,
  time: string,
  place: { state: string | null; timezone: string | null },
): Date | null {
  const day = normalizeTypedDate(date.trim())
  const clock = normalizeTypedTime(time)
  if (day === null || clock === null) return null

  const { zone } = resolveZone(
    place.timezone,
    place.state,
    COMPANY_FALLBACK_ZONE,
  )
  const midnight = zoneMidnight(day, zone)
  const [hour, minute] = clock.split(':').map(Number)
  return new Date(
    midnight.getTime() + (hour ?? 0) * 3_600_000 + (minute ?? 0) * 60_000,
  )
}

/** "$2,450.00" → 245000. Money is an integer of cents the moment it is read. */
export function cents(value: unknown): number {
  const text = optionalText(value)
  if (text === null) return 0
  const amount = Number(text.replace(/[,$\s]/g, ''))
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0
}

export interface FormStop {
  /** The stored stop this row edits (Edit load's hidden field); absent on Add load. */
  id?: string
  place: string
  type: 'PICKUP' | 'DELIVERY' | 'INTERMEDIATE'
  date: string
  /** `HH:MM`, the window's ends. Empty on most stops. */
  from: string
  to: string
}

/**
 * The stops the form sent, in order.
 *
 * Read until the indices run out rather than to a fixed count: the form owns
 * how many there are, and a load with four stops posts four. A row with no
 * place at all still counts, so the required check can name which one is
 * empty instead of silently dropping it.
 */
export function readStops(formData: FormData): FormStop[] {
  const stops: FormStop[] = []
  for (let index = 0; ; index++) {
    const place = formData.get(`stops[${index}].place`)
    if (place === null) break
    const type = String(formData.get(`stops[${index}].type`) ?? '')
    const id = optionalText(formData.get(`stops[${index}].id`))
    stops.push({
      ...(id === null ? {} : { id }),
      place: String(place).trim(),
      // Defaulted by POSITION only when the form did not say — a form that
      // always sends the field never reaches this, and a caller that does not
      // is choosing the ordinary shape rather than having one assumed of it.
      type:
        type === 'PICKUP' || type === 'DELIVERY' || type === 'INTERMEDIATE'
          ? type
          : index === 0
            ? 'PICKUP'
            : 'DELIVERY',
      date: String(formData.get(`stops[${index}].date`) ?? ''),
      from: String(formData.get(`stops[${index}].from`) ?? ''),
      to: String(formData.get(`stops[${index}].to`) ?? ''),
    })
  }
  return stops
}
// ---------------------------------------------------------------------------
// EDIT LOAD — THE STORED STOP, AS THE FORM SHOWS IT, AND BACK (§7.14 part 7).
// ---------------------------------------------------------------------------

/** The stored stop fields the edit form is built from and compared against. */
export type StoredStop = Pick<
  LoadStop,
  | 'id'
  | 'type'
  | 'locationId'
  | 'name'
  | 'addressLine1'
  | 'addressLine2'
  | 'city'
  | 'state'
  | 'postalCode'
  | 'appointmentType'
  | 'scheduledAt'
  | 'windowStart'
  | 'windowEnd'
  | 'arrivedAt'
  | 'departedAt'
  | 'legMiles'
  | 'legEmpty'
  | 'referenceNumber'
  | 'contactName'
  | 'contactPhone'
  | 'instructions'
> & { location: { timezone: string | null; state: string | null } | null }

/** The zone a stored stop's clocks are read and written in — `stopDate`'s. */
function zoneOf(stop: StoredStop): string {
  return resolveZone(
    stop.location?.timezone ?? null,
    stop.state ?? stop.location?.state ?? null,
    COMPANY_FALLBACK_ZONE,
  ).zone
}

/** `HH:MM` on a 24-hour clock, in `zone`. */
function clockIn(at: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)
  const part = (type: string) =>
    parts.find((piece) => piece.type === type)?.value ?? '00'
  return `${part('hour')}:${part('minute')}`
}

/**
 * A stored stop as the form's row shows it: place, type, date and clocks.
 *
 * THE INVERSE OF THE CREATE PATH, deliberately: one typed clock is the
 * appointment (`scheduledAt`), two are the window; a date with no clock was
 * stored at midnight in the stop's zone, so midnight reads back as no clock.
 * The edit page fills the form from this, and the save compares what came
 * back against it — so "unchanged" is decided by the same function both
 * times, never by two ideas of how a stop renders.
 */
export function stopFormValues(stop: StoredStop): FormStop & { id: string } {
  const zone = zoneOf(stop)
  const anchor = stop.windowStart ?? stop.scheduledAt
  const appointment =
    stop.windowStart === null && stop.scheduledAt !== null
      ? clockIn(stop.scheduledAt, zone)
      : null
  return {
    id: stop.id,
    place: stop.name ?? [stop.city, stop.state].filter(Boolean).join(', '),
    type: stop.type,
    date: anchor ? localDateIn(anchor, zone) : '',
    from: stop.windowStart
      ? clockIn(stop.windowStart, zone)
      : appointment !== null && appointment !== '00:00'
        ? appointment
        : '',
    to: stop.windowEnd ? clockIn(stop.windowEnd, zone) : '',
  }
}

/** A posted stop that keeps its stored place, and what that place resolves to. */
export type EditedStop =
  | { kind: 'kept'; input: StopInput }
  | { kind: 'moved'; index: number; posted: FormStop }

/**
 * The stops an edit saves, from what the form posted and what is stored.
 *
 * Three cases, per posted row, matched by the stop's own id (a hidden field),
 * never by position:
 *
 *   * SAME PLACE, SAME DATE AND CLOCKS — the stored stop exactly, type
 *     aside: address, contact, check-in times, leg miles and a window that
 *     spans days, which the form's one date cannot express. Rebuilding it
 *     from the form would shorten that window to one day without anybody
 *     touching it.
 *   * SAME PLACE, NEW DATE OR CLOCK — the stored place, the new times read in
 *     the stop's own zone by `stopDate` / `stopMoment`, as Add load reads them.
 *   * A NEW PLACE, OR A NEW ROW — `moved`: the caller resolves the place as
 *     Add load does. The old dock's address and actual times do not follow
 *     the stop to a different dock.
 */
export function editedStops(
  posted: readonly FormStop[],
  stored: readonly StoredStop[],
): EditedStop[] {
  const byId = new Map(stored.map((stop) => [stop.id, stop]))
  return posted.map((row, index) => {
    const existing = row.id ? byId.get(row.id) : undefined
    if (!existing) return { kind: 'moved', index, posted: row }
    const shown = stopFormValues(existing)
    if (row.place.trim() !== shown.place.trim()) {
      return { kind: 'moved', index, posted: row }
    }

    const sameTimes =
      row.date.trim() === shown.date &&
      row.from.trim() === shown.from &&
      row.to.trim() === shown.to
    const place = {
      timezone: existing.location?.timezone ?? null,
      state: existing.state ?? existing.location?.state ?? null,
    }
    return {
      kind: 'kept',
      input: {
        type: row.type,
        locationId: existing.locationId,
        name: existing.name,
        addressLine1: existing.addressLine1,
        city: existing.city,
        state: existing.state,
        postalCode: existing.postalCode,
        appointmentType: existing.appointmentType,
        scheduledAt: sameTimes
          ? existing.scheduledAt
          : stopDate(row.date, place, row.from),
        windowStart: sameTimes
          ? existing.windowStart
          : stopMoment(row.date, row.from, place),
        windowEnd: sameTimes
          ? existing.windowEnd
          : stopMoment(row.date, row.to, place),
        referenceNumber: existing.referenceNumber,
        contactName: existing.contactName,
        contactPhone: existing.contactPhone,
        instructions: existing.instructions,
        arrivedAt: existing.arrivedAt,
        departedAt: existing.departedAt,
        legMiles: existing.legMiles,
        legEmpty: existing.legEmpty,
      },
    }
  })
}

// ---------------------------------------------------------------------------
// DUPLICATE LOAD — WHAT A COPY CARRIES (§7.14 part 7).
// ---------------------------------------------------------------------------

/**
 * A stop as a duplicate books it: the plan, never what happened.
 *
 * Place, appointment and window, the stop's own reference, contact and
 * instructions. No arrival, no departure, no leg miles — those are facts
 * about the trip that ran, and the copy has not run.
 */
export function plannedStop(stop: StoredStop): StopInput {
  return {
    type: stop.type,
    locationId: stop.locationId,
    name: stop.name,
    addressLine1: stop.addressLine1,
    city: stop.city,
    state: stop.state,
    postalCode: stop.postalCode,
    appointmentType: stop.appointmentType,
    scheduledAt: stop.scheduledAt,
    windowStart: stop.windowStart,
    windowEnd: stop.windowEnd,
    referenceNumber: stop.referenceNumber,
    contactName: stop.contactName,
    contactPhone: stop.contactPhone,
    instructions: stop.instructions,
  }
}
