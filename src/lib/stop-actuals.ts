// ---------------------------------------------------------------------------
// ON A FINISHED TRIP, THE ACTUAL IS THE TRUTH AND THE PLAN IS THE REFERENCE.
//
// Relay's own trip view shows both, hours apart, and treats the actual as what
// happened. Real trip T-115GY4TBD: MEM4 scheduled 04:41, checked in 07:17;
// HME9 scheduled 06:32, checked in 08:08; WE_PAY_WMBAF scheduled 07:32–08:02,
// checked in 09:20 — which Relay labels "1hr 18m late". A load that shows the
// plan on a delivered trip is showing what somebody INTENDED three days ago
// and calling it a record.
//
// THREE RULES, AND THE THIRD IS THE ONE THAT KEEPS THE OTHER TWO HONEST:
//
//   1. A delivered load shows the actual, with the plan beneath it.
//   2. A booked load shows the plan, because no actual exists yet.
//   3. A STOP WITH NO ACTUAL SHOWS THE PLAN AND SAYS SO — always, including on
//      a delivered load, where its neighbours are showing actuals. A plan
//      presented as an actual is worse than a plan presented as a plan, and on
//      a delivered load it is the easiest possible mistake to make: everything
//      around it is real.
//
// LATENESS IS DERIVED AND NEVER STORED. It is a subtraction between two
// columns that are both already here; storing it would create a third number
// that can disagree with the two it came from.
// ---------------------------------------------------------------------------

export interface StopTimes {
  scheduledAt: Date | null
  arrivedAt: Date | null
  departedAt: Date | null
}

export interface ShownStopTime {
  /** The instant to display, or null when the stop has no time at all. */
  at: Date | null
  /**
   * Whether `at` is something that HAPPENED.
   *
   * The caller renders differently on this rather than inferring from the
   * load's status — a delivered load can hold a stop nobody checked into.
   */
  isActual: boolean
  /** The plan, when it exists AND is not already what `at` shows. */
  scheduledAt: Date | null
  /** The departure that happened, for a stop that has one. */
  departedAt: Date | null
  /**
   * `actual − planned` in whole minutes, or null.
   *
   * Positive is late, negative is early. Null when either side is missing —
   * there is no such thing as being late for an appointment nobody made.
   */
  latenessMinutes: number | null
}

/**
 * What a stop should show, and whether it is a record or an intention.
 *
 * `delivered` is passed rather than read off a status enum so the rule can be
 * tested without a load, and so the caller's definition of "finished" stays
 * the caller's business.
 */
export function shownStopTime(
  stop: StopTimes,
  { delivered }: { delivered: boolean },
): ShownStopTime {
  const actual = delivered ? stop.arrivedAt : null

  if (actual) {
    return {
      at: actual,
      isActual: true,
      // Only when it says something the actual does not.
      scheduledAt:
        stop.scheduledAt && stop.scheduledAt.getTime() !== actual.getTime()
          ? stop.scheduledAt
          : null,
      departedAt: delivered ? stop.departedAt : null,
      latenessMinutes: stop.scheduledAt
        ? Math.round((actual.getTime() - stop.scheduledAt.getTime()) / 60_000)
        : null,
    }
  }

  return {
    at: stop.scheduledAt,
    isActual: false,
    scheduledAt: null,
    departedAt: null,
    latenessMinutes: null,
  }
}

/** "1hr 18m late", "12m early", or null. Relay's own phrasing. */
export function latenessLabel(
  minutes: number | null,
  labels: { late: string; early: string },
): string | null {
  if (minutes === null || minutes === 0) return null
  const magnitude = Math.abs(minutes)
  const hours = Math.floor(magnitude / 60)
  const rest = magnitude % 60
  const span = hours > 0 ? `${hours}hr ${rest}m` : `${rest}m`
  return `${span} ${minutes > 0 ? labels.late : labels.early}`
}

// ---------------------------------------------------------------------------
// THE DRIVER'S SHEET DATES.
//
// PU is the check-in at the first PICKUP; DEL the check-in at the last
// DELIVERY. Both come through `shownStopTime`, so the settlement document and
// the load screen cannot reach different conclusions about the same stop —
// which is the entire reason that function exists rather than each caller
// deciding for itself.
//
// `isActual` TRAVELS WITH EACH DATE, separately. A load can easily have a real
// check-in at the shipper and none at the consignee, and a money document that
// marked the line rather than the figure would be telling the driver that one
// of these two numbers is a guess without saying which.
// ---------------------------------------------------------------------------

export interface SheetStop extends StopTimes {
  type: 'PICKUP' | 'DELIVERY' | 'INTERMEDIATE'
  sequence: number
}

export interface SheetDates {
  puAt: Date | null
  puActual: boolean
  delAt: Date | null
  delActual: boolean
}

export function sheetDates(stops: readonly SheetStop[]): SheetDates {
  const ordered = [...stops].sort((a, b) => a.sequence - b.sequence)
  const pickup = ordered.find((stop) => stop.type === 'PICKUP')
  const delivery = [...ordered]
    .reverse()
    .find((stop) => stop.type === 'DELIVERY')

  // `delivered: true` because a settled load has run: this is asking what
  // HAPPENED, and the fallback to the plan is `shownStopTime`'s own rule with
  // `isActual` false to mark it.
  const pu = pickup ? shownStopTime(pickup, { delivered: true }) : null
  const del = delivery ? shownStopTime(delivery, { delivered: true }) : null

  return {
    puAt: pu?.at ?? null,
    puActual: pu?.isActual ?? false,
    delAt: del?.at ?? null,
    delActual: del?.isActual ?? false,
  }
}

/**
 * How long the truck sat at this stop.
 *
 * DWELL, NOT DETENTION, and the difference is money. This is the gap between
 * the two ACTUAL clocks the Relay export gives us — descriptive, needing no
 * appointment, and unable to disagree with anything. Detention measures against
 * `scheduledAt` and is billable; `DETENTION` is already an accessorial type,
 * and a column that quietly meant that would be a number somebody charges for
 * sitting beside numbers nobody does.
 *
 * NULL WHEN EITHER CLOCK IS MISSING. Half a window is not a duration, and a
 * stop that has arrived but not left has not finished waiting — showing the
 * time so far would tick upward on a page that does not refresh.
 *
 * NEGATIVE IS ALSO NULL. A departure before its arrival is bad data, not a
 * negative wait; printing "-2h" invites somebody to explain it rather than
 * correct it.
 */
export function dwellMinutes(stop: {
  arrivedAt: Date | null
  departedAt: Date | null
}): number | null {
  if (stop.arrivedAt === null || stop.departedAt === null) return null
  const minutes = Math.round(
    (stop.departedAt.getTime() - stop.arrivedAt.getTime()) / 60_000,
  )
  return minutes < 0 ? null : minutes
}

/**
 * A duration as a dispatcher says it: "3h 12m", "45m", "2d 4h".
 *
 * NOT LOCALISED, deliberately: these are units on a dense table, and `h`/`m`
 * survive translation better than a sentence would. §12 reserves translation
 * for prose, and this is closer to a unit symbol than to language.
 */
export function dwellLabel(minutes: number | null): string {
  if (minutes === null) return '—'
  if (minutes < 60) return `${minutes}m`

  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours < 24) return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`

  const days = Math.floor(hours / 24)
  const spare = hours % 24
  return spare === 0 ? `${days}d` : `${days}d ${spare}h`
}
