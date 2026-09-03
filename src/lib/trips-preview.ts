import { formatCents } from './money'
import type { PlannedTrip } from './trips-import'

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
  addsStops: string
  addsMiles: string
  addsActuals: string
  marksDelivered: string
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
  action: 'create' | 'enrich' | 'unchanged' | 'cancelled'
  actionDetail: string
  skippedLegs: number
  unresolved: string[]
  driver: string
  equipment: string
  /** ABSENT — not null — when the role may not see money. */
  rate?: string
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
  labels: TripRowLabels,
  money: TripRowMoney,
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
  const willDeliver = Boolean(
    enriching && trip.stage === 'finished' && !enriching.isDelivered,
  )

  // A CANCELLED LOAD IS ITS OWN VERDICT, and it is counted separately rather
  // than folded into "already complete". Somebody said this freight is not
  // happening; the import skips it, and the preview says which loads it
  // skipped for that reason instead of announcing a write that cannot occur.
  const cancelled = enriching?.isCancelled === true

  const unchanged =
    enriching !== null &&
    enriching.hasStops &&
    enriching.hasMiles &&
    !willAddActuals &&
    !willDeliver

  const row: TripRowView = {
    tripId: trip.tripId,
    lane: trip.stops.map((stop) => stop.facilityCode).join(' → '),
    stops: trip.stops.length,
    miles: trip.totalMiles === null ? '—' : String(trip.totalMiles),
    action:
      write.action === 'create'
        ? 'create'
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
        ? trip.stage === 'finished'
          ? [labels.create, labels.marksDelivered].join(', ')
          : labels.create
        : cancelled
          ? labels.cancelled
          : unchanged
            ? labels.unchanged
            : [
                enriching!.hasStops ? null : labels.addsStops,
                enriching!.hasMiles ? null : labels.addsMiles,
                willAddActuals ? labels.addsActuals : null,
                willDeliver ? labels.marksDelivered : null,
              ]
                .filter(Boolean)
                .join(', '),
    skippedLegs: trip.cancelledLegs,
    unresolved,
    driver: trip.driverNames.join(', ') || '—',
    equipment: [...trip.trailerIds, ...trip.tractorIds].join(' / ') || '—',
  }

  // THE KEY IS ADDED, NEVER EMPTIED. A role without the permission gets an
  // object that has never held the number.
  if (money.maySeeMoney) {
    const cents = rateThatWouldLand(trip, write)
    row.rate = cents === null ? '—' : formatCents(cents, money.locale)
  }

  return row
}
