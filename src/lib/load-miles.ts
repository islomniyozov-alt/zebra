// ---------------------------------------------------------------------------
// LOADED, EMPTY, TOTAL — FROM THE COLUMNS, NEVER FROM THE STOPS.
//
// `Load.dispatchedMiles` and `Load.emptyMiles` are accumulated per LEG, once,
// when a trip is imported. The per-stop `legMiles` is the same money broken
// out, and the two are asserted to agree across the sweep — but the columns are
// the authority and this reads them. Summing rows to produce a figure that is
// already stored is how a screen comes to contradict itself.
//
// NULL IS NOT ZERO, and that distinction is the whole reason this is a function
// rather than a subtraction at the call site. Broker freight has never had
// `emptyMiles` written: nothing on that path classifies legs, because a typed-in
// load has no `Shipper Account` to classify. Showing "0 empty" there would be
// the screen inventing a fact about freight nobody measured.
//
// PROVISIONAL IS ITS OWN STATE. A trip can carry legs whose account matched no
// rule; those miles land in the LOADED figure by default, and the load says so.
// See flag 91 — the default was defended as "visibly" wrong, which was a claim
// about somebody looking, and nothing displayed the number until now.
// ---------------------------------------------------------------------------

export interface MilesSummary {
  /** Every mile, loaded or not. Null when the load has no distance at all. */
  totalMiles: number | null
  /**
   * The split, or null when this freight was never classified.
   *
   * Null means "we do not know", NOT "none". A screen showing zero empty miles
   * on a load nobody classified is asserting something it was never told.
   */
  loadedMiles: number | null
  emptyMiles: number | null
  /** Some of `loadedMiles` is there because no rule matched, not because it is freight. */
  provisional: boolean
}

export interface MilesInput {
  dispatchedMiles: number | null
  emptyMiles: number | null
  /** `legEmpty` per stop: null where nobody classified that leg. */
  stops: readonly { legMiles: number | null; legEmpty: boolean | null }[]
}

export function milesSummary(load: MilesInput): MilesSummary {
  const totalMiles = load.dispatchedMiles

  // A LEG WITH MILES AND NO CLASSIFICATION is what makes the split provisional.
  // A stop with no `legMiles` carries no leg at all — the first stop of a trip,
  // or an intermediate one — and says nothing about classification.
  const provisional = load.stops.some(
    (stop) => stop.legMiles !== null && stop.legEmpty === null,
  )

  if (totalMiles === null || load.emptyMiles === null) {
    return { totalMiles, loadedMiles: null, emptyMiles: null, provisional }
  }

  // Clamped, because a total smaller than its empty share is not a number
  // anybody should be shown. It cannot happen from the importer — both sides
  // come from one accumulation — and a negative "loaded miles" on a screen
  // would be read as a bug in the freight rather than in the arithmetic.
  const emptyMiles = Math.min(load.emptyMiles, totalMiles)

  return {
    totalMiles,
    loadedMiles: totalMiles - emptyMiles,
    emptyMiles,
    provisional,
  }
}
