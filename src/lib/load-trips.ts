// ---------------------------------------------------------------------------
// THE TRIPS ON A LOAD, AS DATATRUCK DRAWS THEM (§7.13).
//
// Zebra stores a Relay trip as ONE load with its stops; the legs are not rows of
// their own. The trips importer marks each leg by writing the leg's Load ID on
// its ARRIVAL stop (`trips-import.ts`), so a leg is read back as "from the stop
// where the last leg ended, to the next stop carrying a reference".
//
// A LOAD WITH NO LEG REFERENCE IS ONE TRIP, first stop to last, under the
// load's own reference — every broker load and every Datatruck import. Stops
// after the last referenced one are a final leg under the load's reference, so
// no stop falls out of the table.
// ---------------------------------------------------------------------------

export interface TripLeg<S> {
  /** The leg's Load ID, or the load's reference when the leg has none. */
  tripId: string | null
  pickup: S
  delivery: S
}

export function tripsFromStops<S extends { referenceNumber: string | null }>(
  stops: readonly S[],
  loadReference: string | null,
): TripLeg<S>[] {
  if (stops.length < 2) return []
  const legs: TripLeg<S>[] = []
  let from = 0
  for (let i = 1; i < stops.length; i++) {
    const reference = stops[i]!.referenceNumber
    if (reference === null || reference.trim() === '') continue
    legs.push({ tripId: reference, pickup: stops[from]!, delivery: stops[i]! })
    from = i
  }
  if (from < stops.length - 1) {
    legs.push({
      tripId: loadReference,
      pickup: stops[from]!,
      delivery: stops[stops.length - 1]!,
    })
  }
  return legs
}
