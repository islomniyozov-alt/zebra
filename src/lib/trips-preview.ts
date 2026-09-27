import { formatCents } from './money'
import { stageSeatsCrew, type CrewRefusal, type CrewSeat } from './trips-crew'
import type { PlannedTrip } from './trips-import'

/** The two readings of the file's money, in words. */
export interface TripRateBasisLabels {
  rateFromRow: string
  rateFromLegs: string
}

// ---------------------------------------------------------------------------
// THE ROW A DISPATCHER CONFIRMS, INCLUDING THE MONEY — OR NOT INCLUDING IT.
//
// §1.3's rule is that a field a role cannot see is ABSENT FROM THE PAYLOAD,
// never hidden in CSS. So this returns an object with no `rate` key at all for
// a role without `load.financials`, rather than a null one — the difference
// between "there is nothing to show you" and "there is something and it was
// sent to your browser anyway".
//
// IT LIVES HERE RATHER THAN IN THE ACTION for the reason this session has now
// found twice: a 'use server' file is one no test can call, and the two bugs
// that reached production through this importer both hid in exactly that spot.
// The money wall is worth more than a source-grep.
//
// WHAT "RATE" MEANS HERE IS WHAT WILL LAND, not what the file says. A trip
// whose load already carries money shows nothing, because enrichment adds and
// never replaces; a multi-leg trip shows nothing, because `planTrips` refused
// to call its per-leg allocation a price. Showing the file's number beside a
// write that will not happen is the preview lying politely.
// ---------------------------------------------------------------------------

export interface TripRowLabels {
  create: string
  unchanged: string
  cancelled: string
  closedHistory: string
  addsStops: string
  addsMiles: string
  addsActuals: string
  marksDelivered: string
  seatsCrew: string
}

/** The words a crew refusal is reported in. */
export interface CrewRefusalLabels {
  driver: string
  truck: string
  matchesNobody: string
  matchesTwo: string
  fileDisagrees: string
}

/**
 * A refusal, in one line a dispatcher can act on.
 *
 * ── NAMED, BECAUSE A COUNT IS NOT ACTIONABLE ──────────────────────────────
 *
 * The ruling asks for "refusals by name". "4 refused" tells a dispatcher there
 * is a problem and not which name to fix; the three reasons need three
 * different fixes — add the driver to the roster, resolve the duplicate unit
 * number, or look at a file that names two drivers for one trip.
 *
 * THE VALUE IS QUOTED EXACTLY AS THE FILE WROTE IT, trailing spaces and odd
 * casing included, because that is the string somebody has to search the export
 * for. `nameKey` normalises for MATCHING; it must not normalise for REPORTING.
 */
export function crewRefusalLine(
  refusal: CrewRefusal,
  labels: CrewRefusalLabels,
): string {
  const column = refusal.column === 'driver' ? labels.driver : labels.truck
  const why =
    refusal.why === 'matches_nobody'
      ? labels.matchesNobody
      : refusal.why === 'matches_two'
        ? labels.matchesTwo
        : labels.fileDisagrees
  return `${column} “${refusal.value}”: ${why}`
}

export type TripWriteView =
  | { action: 'create' }
  | {
      action: 'enrich'
      hasStops: boolean
      hasMiles: boolean
      hasRate: boolean
      hasActuals: boolean
      isDelivered: boolean
      isCancelled: boolean
      isClosedHistory: boolean
      hasDriver: boolean
      hasTruck: boolean
    }

export interface TripRowMoney {
  /** `load.financials`. False means the key below is never emitted. */
  maySeeMoney: boolean
  locale: string
}

export interface TripRowView {
  tripId: string
  lane: string
  stops: number
  miles: string
  action: 'create' | 'enrich' | 'unchanged' | 'cancelled' | 'closed'
  actionDetail: string
  skippedLegs: number
  unresolved: string[]
  driver: string
  equipment: string
  /**
   * Whether this import would put the file's crew into the load's seats.
   *
   * FALSE IS THREE DIFFERENT FACTS and the row says which through
   * `crewRefusals` plus `actionDetail`: the file named nobody, the trip has not
   * finished so the seats are a dispatcher's to fill, or the names were refused.
   */
  seatsCrew: boolean
  /** One line per refused column, naming exactly what the file said. */
  crewRefusals: string[]
  /** ABSENT — not null — when the role may not see money. */
  rate?: string
  /**
   * How that figure was read: the row's own cost, or the legs added up.
   *
   * ABSENT ALONGSIDE `rate`, by the same §1.3 rule — it is a statement about a
   * money figure, and a role that may not see the figure may not see how it was
   * made either. Absent too when no rate would land, because there is then no
   * reading to describe.
   */
  rateBasis?: string
}

/**
 * Would this import file the load as delivered?
 *
 * ── ONE READER, BECAUSE THE COUNT AND THE ROW MUST NOT DISAGREE ────────────
 *
 * The first version of the "delivered" count searched `actionDetail` for the
 * translated label. That is a second reader of the same fact, wearing a
 * disguise: it breaks when somebody translates the word, when a comma moves, or
 * when a locale writes the phrase as a substring of another label — and it
 * breaks into a WRONG NUMBER rather than an error.
 *
 * So the row and the count call this, and the label is printed from it.
 *
 * REFUSED CASES ARE NOT DELIVERIES. A cancelled load and closed history are
 * both left alone by `enrichLoad` before it reaches the landing, so counting
 * them would promise a status move that cannot happen.
 */
export function filesAsDelivered(
  trip: PlannedTrip,
  write: TripWriteView,
): boolean {
  if (trip.stage !== 'finished') return false
  if (write.action === 'create') return true
  if (write.isCancelled || write.isClosedHistory) return false
  return !write.isDelivered
}

/** Does the export carry a check-in for any stop on this trip? */
export function tripHasActuals(trip: PlannedTrip): boolean {
  return trip.stops.some(
    (stop) => stop.actualArrival !== null || stop.actualDeparture !== null,
  )
}

/** The cents this import would actually write, or null if it would write none. */
export function rateThatWouldLand(
  trip: PlannedTrip,
  write: TripWriteView,
): number | null {
  if (trip.rateCents === null) return null
  if (write.action === 'create') return trip.rateCents
  // Enrichment adds what is missing and replaces nothing.
  return write.hasRate ? null : trip.rateCents
}

export function tripRowView(
  trip: PlannedTrip,
  write: TripWriteView,
  unresolved: string[],
  labels: TripRowLabels & CrewRefusalLabels & TripRateBasisLabels,
  money: TripRowMoney,
  /** What the file's crew columns resolved to. Null when nothing resolved it. */
  crew: CrewSeat | null = null,
): TripRowView {
  // WHAT THIS ENRICH WOULD ACTUALLY DO, listed before it is summarised.
  //
  // "already complete" used to mean stops-and-mileage alone, which is how a
  // trip booked from an Upcoming export and re-imported after it ran came back
  // as "1 already complete" while its check-in times sat unread in the file.
  const enriching = write.action === 'enrich' ? write : null
  const willAddActuals = Boolean(
    enriching && !enriching.hasActuals && tripHasActuals(trip),
  )
  const willDeliver = enriching !== null && filesAsDelivered(trip, write)

  // A CANCELLED LOAD IS ITS OWN VERDICT, and it is counted separately rather
  // than folded into "already complete". Somebody said this freight is not
  // happening; the import skips it, and the preview says which loads it
  // skipped for that reason instead of announcing a write that cannot occur.
  const cancelled = enriching?.isCancelled === true

  // AND SO IS CLOSED HISTORY, for the same reason twice over: the write refuses
  // it whole, and a dispatcher reading "already complete" beside a load from
  // last February would have no way to tell that the import had declined to
  // touch settled freight rather than found nothing to do.
  const closed = enriching?.isClosedHistory === true

  // ── WHAT THE CREW COLUMNS WOULD DO ────────────────────────────────────────
  //
  // SEATED ONLY WHERE A SEAT IS ACTUALLY EMPTY. A trip whose driver resolves
  // cleanly onto a load that already has one writes nothing, and saying "seats
  // the crew" there would be the preview promising a write that will not
  // happen — the same defect as the rate column showing the file's figure for a
  // load that already carries money.
  const seatable = crew?.kind === 'seated' && stageSeatsCrew(trip.stage)
  const driverSeatFree = write.action === 'create' || !write.hasDriver
  const truckSeatFree = write.action === 'create' || !write.hasTruck
  const seatsCrew = Boolean(
    seatable &&
      !cancelled &&
      !closed &&
      ((crew.driverId !== null && driverSeatFree) ||
        (crew.truckId !== null && truckSeatFree)),
  )

  // REFUSALS ARE REPORTED WHATEVER THE STAGE. A live trip's names are not
  // written either way, but a name that matches nobody is a roster gap today
  // and a refused seat next week — telling a dispatcher now is free.
  const crewRefusals =
    crew?.kind === 'refused'
      ? crew.reasons.map((reason) => crewRefusalLine(reason, labels))
      : []

  const unchanged =
    enriching !== null &&
    enriching.hasStops &&
    enriching.hasMiles &&
    !willAddActuals &&
    !willDeliver &&
    !seatsCrew

  const row: TripRowView = {
    tripId: trip.tripId,
    lane: trip.stops.map((stop) => stop.facilityCode).join(' → '),
    stops: trip.stops.length,
    miles: trip.totalMiles === null ? '—' : String(trip.totalMiles),
    action:
      write.action === 'create'
        ? 'create'
        : closed
          ? 'closed'
          : cancelled
            ? 'cancelled'
            : unchanged
              ? 'unchanged'
              : 'enrich',
    actionDetail:
      // A CREATE FROM A COMPLETED EXPORT SAYS SO. The row used to read "to
      // book" for a trip that had already run, which was true of the write at
      // the time and stopped being true when `createTripLoad` learned to read
      // the stage. The preview and the write agree by construction or they do
      // not agree at all.
      write.action === 'create'
        ? [
            labels.create,
            trip.stage === 'finished' ? labels.marksDelivered : null,
            seatsCrew ? labels.seatsCrew : null,
          ]
            .filter(Boolean)
            .join(', ')
        : closed
          ? labels.closedHistory
          : cancelled
            ? labels.cancelled
            : unchanged
              ? labels.unchanged
              : [
                  enriching!.hasStops ? null : labels.addsStops,
                  enriching!.hasMiles ? null : labels.addsMiles,
                  willAddActuals ? labels.addsActuals : null,
                  willDeliver ? labels.marksDelivered : null,
                  seatsCrew ? labels.seatsCrew : null,
                ]
                  .filter(Boolean)
                  .join(', '),
    skippedLegs: trip.cancelledLegs,
    unresolved,
    driver: trip.driverNames.join(', ') || '—',
    equipment: [...trip.trailerIds, ...trip.tractorIds].join(' / ') || '—',
    seatsCrew,
    crewRefusals,
  }

  // THE KEY IS ADDED, NEVER EMPTIED. A role without the permission gets an
  // object that has never held the number.
  if (money.maySeeMoney) {
    const cents = rateThatWouldLand(trip, write)
    row.rate = cents === null ? '—' : formatCents(cents, money.locale)
    // AND HOW IT WAS READ, beside it and under the same permission. A sum of
    // legs has never been checked against the Relay portal; the label is how a
    // dispatcher knows to check one rather than trusting 32 of them.
    if (cents !== null && trip.rateBasis !== null) {
      row.rateBasis =
        trip.rateBasis === 'load_row' ? labels.rateFromRow : labels.rateFromLegs
    }
  }

  return row
}

/** The three landings a file's trips can have, counted. */
export interface StageCounts {
  upcoming: number
  running: number
  finished: number
}

/**
 * "3 trips: 1 books, 1 in transit, 1 files as delivered" — the owner's own
 * sentence, which is the whole preview in one line.
 *
 * A FUNCTION RATHER THAN JSX, so the wording has a test. It was three
 * `.replace()` calls and a `.join()` inside the form, where the only way to
 * check it said the right thing was to read it — and flag 97 is about exactly
 * that: a rule somewhere no instrument can reach.
 *
 * IN THE FREIGHT'S ORDER, not the object's. Books, then in transit, then
 * delivered, because that is the order the freight moves in and the order a
 * dispatcher thinks in. A stage with no trips is omitted rather than printed
 * as a zero: "0 in transit" is a fact nobody asked for, and three of them
 * bury the one number that matters.
 *
 * THE WORDS NAME THE LANDING, NOT THE EXPORT'S VOCABULARY. Relay says
 * "In Progress"; this screen says "in transit", because that is what the load
 * will say on every other screen once the import runs. The old wording — "1
 * still running" — was a fourth synonym for a state the tracker, the badge and
 * the dispatcher already agreed on.
 */
export function stageSentence(
  tripCount: number,
  counts: StageCounts,
  labels: {
    /** "{n} trip:" — the singular exists because "1 trips:" is a typo. */
    previewTrip: string
    previewTrips: string
    stageUpcoming: string
    stageRunning: string
    stageFinished: string
  },
): string {
  const head = (
    tripCount === 1 ? labels.previewTrip : labels.previewTrips
  ).replace('{n}', String(tripCount))

  const parts = [
    counts.upcoming > 0
      ? labels.stageUpcoming.replace('{n}', String(counts.upcoming))
      : null,
    counts.running > 0
      ? labels.stageRunning.replace('{n}', String(counts.running))
      : null,
    counts.finished > 0
      ? labels.stageFinished.replace('{n}', String(counts.finished))
      : null,
  ].filter((part): part is string => part !== null)

  return parts.length === 0 ? head : `${head} ${parts.join(', ')}`
}
