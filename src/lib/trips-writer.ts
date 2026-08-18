import type { TxClient } from './tenancy'
import type { PlannedTrip } from './trips-import'

// ---------------------------------------------------------------------------
// A PLANNED TRIP, WRITTEN — OR ADDED TO A LOAD THE EMAIL ALREADY MADE.
//
// RULE 1 IS A JOIN, NOT A CHOICE. `Load.referenceNumber = Trip ID`, so a trip
// whose reference already exists is the SAME FREIGHT arriving by a second
// route: the booking email created the load, and the trips export knows where
// the truck actually went. That load is enriched. Anything else would book
// Amazon's freight twice and put two of it on the dispatch board.
//
// EXACT MATCH ONLY, as ruled. "T-115M68R2H" and "115M68R2H" are different
// references here; the near-miss warning in `trips-import.ts` is what tells a
// human they might not be, and a human decides. Nothing in this file
// normalises an id.
//
// WHAT ENRICHMENT WILL NOT TOUCH:
//
//   * MONEY. Never. The rate came from the email or it is absent, and
//     `Estimated Cost` was never parsed in the first place (rule 6).
//   * A stop chain somebody has already edited. If the load has stops, the
//     trip's stops are not written over them — a dispatcher who fixed an
//     address should not find it replaced by an import an hour later.
//   * driver or truck. Rule 7: the CSV's names are informational until
//     name-matching is its own ruled feature.
//
// SO ENRICHMENT ADDS WHAT WAS MISSING and leaves what exists. That is the only
// posture under which running an import twice is safe, and running it twice is
// what will happen.
// ---------------------------------------------------------------------------

export interface TripWriteInput {
  trip: PlannedTrip
  companyId: string
  customerId: string
}

export type TripWriteOutcome =
  | { kind: 'created'; loadId: string; tripId: string; stops: number }
  | { kind: 'enriched'; loadId: string; tripId: string; added: string[] }
  | { kind: 'unchanged'; loadId: string; tripId: string; reason: string }

/** The facility codes a trip names, in the order it visits them. */
export function tripFacilityCodes(trip: PlannedTrip): string[] {
  return [...new Set(trip.stops.map((stop) => stop.facilityCode))]
}

/**
 * Where each code lives, for the codes the seed knows.
 *
 * A code with no location is not an error and not a guess: the stop is written
 * with the code as its name and no address, which is exactly what "we have
 * never seen this dock" looks like. The alternative — inventing a location —
 * is how a facility book fills with half-known addresses.
 */
export async function resolveFacilities(
  tx: TxClient,
  codes: readonly string[],
): Promise<
  Map<string, { id: string; city: string | null; state: string | null }>
> {
  if (codes.length === 0) return new Map()

  const found = await tx.location.findMany({
    where: { facilityCode: { in: [...codes] }, deletedAt: null },
    select: { id: true, facilityCode: true, city: true, state: true },
  })

  const map = new Map<
    string,
    { id: string; city: string | null; state: string | null }
  >()
  for (const row of found) {
    if (row.facilityCode) {
      map.set(row.facilityCode, {
        id: row.id,
        city: row.city,
        state: row.state,
      })
    }
  }
  return map
}

/** The stop rows a trip writes, resolved against the facility book. */
export function stopRowsForTrip(
  trip: PlannedTrip,
  facilities: ReadonlyMap<string, { id: string }>,
): {
  sequence: number
  type: 'PICKUP' | 'DELIVERY'
  locationId: string | null
  name: string
  referenceNumber: string | null
  legMiles: number | null
  legEmpty: boolean | null
}[] {
  return trip.stops.map((stop, index) => ({
    sequence: index + 1,
    // POSITION IS THE ONLY EVIDENCE THIS EXPORT OFFERS. It names facilities
    // and clocks, never "pickup" or "delivery" — so the first stop is where
    // the freight was collected and the rest are where it went. A trip that
    // is really pick-pick-drop-drop will be wrong here and a dispatcher can
    // see it, which is better than a guess dressed as a reading.
    type: index === 0 ? ('PICKUP' as const) : ('DELIVERY' as const),
    locationId: facilities.get(stop.facilityCode)?.id ?? null,
    name: stop.facilityCode,
    referenceNumber: stop.referenceNumber,
    legMiles: stop.legMiles,
    legEmpty: stop.legEmpty,
  }))
}

/**
 * What writing this trip would do, decided before anything is written.
 *
 * Separated so the preview and the write agree by construction: the sentence a
 * dispatcher confirms is produced by the same function that later acts.
 */
export async function planTripWrite(
  tx: TxClient,
  trip: PlannedTrip,
): Promise<
  | { action: 'create' }
  | { action: 'enrich'; loadId: string; hasStops: boolean; hasMiles: boolean }
> {
  const existing = await tx.load.findFirst({
    // EXACT. No prefix stripping, no case folding, no trimming beyond what the
    // parser already did.
    where: { referenceNumber: trip.tripId, deletedAt: null },
    select: {
      id: true,
      dispatchedMiles: true,
      _count: { select: { stops: true } },
    },
  })

  if (!existing) return { action: 'create' }

  return {
    action: 'enrich',
    loadId: existing.id,
    hasStops: existing._count.stops > 0,
    hasMiles: existing.dispatchedMiles !== null,
  }
}

/**
 * Add to a load the email already created.
 *
 * ADDS WHAT IS MISSING, REPLACES NOTHING. A load that already has stops keeps
 * them; a load that already has mileage keeps it. What comes back names what
 * changed, so a preview can say "adds stops and miles" rather than "enriches",
 * which is a word that hides whether anything happened.
 */
export async function enrichLoad(
  tx: TxClient,
  organizationId: string,
  loadId: string,
  trip: PlannedTrip,
  facilities: ReadonlyMap<string, { id: string }>,
  existing: { hasStops: boolean; hasMiles: boolean },
): Promise<TripWriteOutcome> {
  const added: string[] = []

  if (!existing.hasStops && trip.stops.length > 0) {
    const rows = stopRowsForTrip(trip, facilities)
    await tx.loadStop.createMany({
      data: rows.map((row) => ({ ...row, loadId, organizationId })),
    })
    added.push(`${rows.length} stops`)
  }

  if (!existing.hasMiles && trip.totalMiles !== null) {
    await tx.load.update({
      where: { id: loadId },
      data: {
        dispatchedMiles: trip.totalMiles,
        // Only alongside the miles it is a share of. An empty figure with no
        // total to sit inside is a number without a denominator.
        ...(trip.emptyMiles === null ? {} : { emptyMiles: trip.emptyMiles }),
      },
    })
    added.push(`${trip.totalMiles} miles`)
  }

  if (added.length === 0) {
    return {
      kind: 'unchanged',
      loadId,
      tripId: trip.tripId,
      reason: 'the load already has its stops and mileage',
    }
  }

  return { kind: 'enriched', loadId, tripId: trip.tripId, added }
}
