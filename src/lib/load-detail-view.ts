// ---------------------------------------------------------------------------
// WHAT THE LOAD DETAIL SHOWS, DECIDED ONCE.
//
// Six of the eight redesign items are a branch on one fact: does this freight
// settle directly. They lived as six separate `isAmazon ? … : …` reads inside a
// server component, which is flag 85's shape exactly — a path with a screen
// instead of a guard. Nothing could assert that removing the Documents panel
// and merging the notes agreed about which loads they applied to, and a screen
// that quietly shows a panel to the wrong freight looks like a screen.
//
// SO THE DECISIONS ARE DATA. One function, one input, one frozen answer, and a
// test file that reads the two answers side by side. The page renders it.
//
// `directSettled` IS THE INPUT, NOT "IS AMAZON". It is copied from
// `Customer.settlesDirectly` when the load is booked and never re-read, so
// freight keeps the screen it was booked under even if the broker's terms
// change next year — a live join to the customer would rewrite the past. Today
// Relay is the only such customer, so the two sets coincide; a second
// direct-settling customer would get this screen too, which is correct, because
// everything the screen removes is removed BECAUSE nobody invoices this freight
// and the broker holds the paperwork.
// ---------------------------------------------------------------------------

export interface LoadDetailView {
  /**
   * Item 2 — truck and driver, assignable from the detail.
   *
   * BROKER FREIGHT HAS THE SAME GAP and deliberately does not get the panel:
   * the redesign was scoped to direct-settled loads. Lifting it is changing
   * this one line, which is the point of the decision living here.
   */
  showAssignment: boolean
  /** Item 1 — identifiers a dispatcher retypes into the broker's system. */
  copyableIdentifiers: boolean
  /** Item 3 — the per-stop IANA zone picker. */
  showStopTimezone: boolean
  /** Item 3 — the stop's own address, editable on this load alone. */
  editStopAddress: boolean
  /** Item 4 — the second money box beside Linehaul. */
  showFuelSurcharge: boolean
  /** Item 4 — Miles, editable in the summary under `load:update`. */
  editMiles: boolean
  /** Item 6 — Rate con / POD / BOL prompts. */
  showDocuments: boolean
  /** Item 8 — notes as timeline entries rather than a panel of their own. */
  notesInTimeline: boolean
}

/**
 * The screen for one load.
 *
 * EVERY FIELD IS DERIVED FROM `directSettled` AND NOTHING ELSE. Permission is
 * not consulted here and must not be: `load:update` and `load.financials` still
 * gate the writes at the call site, and folding them in would make this the
 * second place permission is decided — which the standing rule reserves for
 * `permissions.ts`. This answers "what does this KIND of freight show", never
 * "may this person see it".
 */
export function loadDetailView(load: {
  directSettled: boolean
}): LoadDetailView {
  const direct = load.directSettled
  return Object.freeze({
    showAssignment: direct,
    copyableIdentifiers: direct,
    showStopTimezone: !direct,
    editStopAddress: direct,
    showFuelSurcharge: !direct,
    editMiles: direct,
    showDocuments: !direct,
    notesInTimeline: direct,
  })
}

/**
 * The accessorials this load may be given.
 *
 * TONU ONLY on direct-settled freight: it is the one Relay pays, and a list of
 * twelve is how somebody bills Amazon for a lumper it will never reimburse.
 *
 * FILTERED FROM THE CALLER'S LIST rather than returning a literal, so a type
 * added to `ACCESSORIAL_TYPES` reaches both screens or neither. A hardcoded
 * `['TONU']` here would drift the moment the shared list grew, and drift
 * silently — the screen would simply keep offering last year's vocabulary.
 */
export function accessorialChoicesFor<T extends string>(
  all: readonly T[],
  load: { directSettled: boolean },
): readonly T[] {
  if (!load.directSettled) return all
  return all.filter((type) => type === 'TONU')
}

/**
 * Every accessorial a load can carry.
 *
 * IT LIVES HERE RATHER THAN IN THE PAGE because two things now need it: the
 * screen that offers them, and `accessorialChoicesFor` — which filters this
 * list rather than restating part of it, so the filter cannot go stale against
 * a list it can no longer see.
 */
export const ACCESSORIAL_TYPES = [
  'DETENTION',
  'LAYOVER',
  'TONU',
  'LUMPER',
  'EXTRA_STOP',
  'DRIVER_ASSIST',
  'REDELIVERY',
  'STORAGE',
  'FUEL_ADVANCE_FEE',
  'OTHER',
] as const
