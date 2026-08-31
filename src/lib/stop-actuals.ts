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
