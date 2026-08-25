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
  addsStops: string
  addsMiles: string
}

export type TripWriteView =
  | { action: 'create' }
  | { action: 'enrich'; hasStops: boolean; hasMiles: boolean; hasRate: boolean }

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
  action: 'create' | 'enrich' | 'unchanged'
  actionDetail: string
  skippedLegs: number
  unresolved: string[]
  driver: string
  equipment: string
  /** ABSENT — not null — when the role may not see money. */
  rate?: string
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
  const unchanged =
    write.action === 'enrich' && write.hasStops && write.hasMiles

  const row: TripRowView = {
    tripId: trip.tripId,
    lane: trip.stops.map((stop) => stop.facilityCode).join(' → '),
    stops: trip.stops.length,
    miles: trip.totalMiles === null ? '—' : String(trip.totalMiles),
    action:
      write.action === 'create' ? 'create' : unchanged ? 'unchanged' : 'enrich',
    actionDetail:
      write.action === 'create'
        ? labels.create
        : unchanged
          ? labels.unchanged
          : [
              write.hasStops ? null : labels.addsStops,
              write.hasMiles ? null : labels.addsMiles,
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
