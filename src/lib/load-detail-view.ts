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
  /** Item 6 — Rate con / POD / BOL prompts. */
  showDocuments: boolean
  /**
   * Item 6 — the stops as a TABLE, which subsumes item 1's numbering.
   *
   * A Relay trip runs six to eight stops. Read as a stack of cards it is a
   * scroll; read as a table it is a route. Position carries the ordinal and the
   * type together — "1 · PICKUP" — so the number appears once and cannot
   * disagree with itself, which is why the label numbering added in the round
   * before came back out.
   *
   * Broker freight keeps the cards: two stops, where the labels ARE the order,
   * and eight columns of mostly empty cells would be worse than the list.
   */
  stopsAsTable: boolean
  /**
   * Item 2 (round 2) — a stop with no address says so, loudly.
   *
   * MEM4-DRAY on load 1013 has a facility row and no street, and the screen
   * showed blank space: a driver being sent to a code nobody has an address
   * for, with nothing saying so. Relay freight is imported by CODE, so this is
   * a condition it produces constantly and broker freight barely can — a
   * typed-in load has an address because somebody typed one.
   */
  flagMissingAddress: boolean
  /** Item 8 — notes as timeline entries rather than a panel of their own. */
  notesInTimeline: boolean
  /**
   * MONEY §7 — the File with factor button.
   *
   * SAME REASON AS `showDocuments`. Direct-settled freight is never invoiced
   * and never sold to a factor, so a Factoring panel on it is a button that
   * could only ever refuse. It is hidden rather than disabled: a disabled
   * control says "not yet", and this one would mean "not ever".
   *
   * The action still refuses it, and must — this decides what a screen shows,
   * never what a write allows.
   */
  showFactoring: boolean
  /**
   * §7.12 — the arrangement is a FACT on direct-settled freight: "Direct",
   * shown and not chosen. Broker freight keeps the select.
   */
  paymentTypeDerived: boolean
  /**
   * §7.12 — the tracker's fourth word. "Invoiced" on freight that is
   * invoiced; "On statement" on freight that settles by statement, where the
   * literal word read as a demand for an invoice nobody should raise. The
   * pipeline rule does not move; only the word does.
   */
  settledWord: 'invoiced' | 'onStatement'
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
    showDocuments: !direct,
    stopsAsTable: direct,
    flagMissingAddress: direct,
    notesInTimeline: direct,
    showFactoring: !direct,
    paymentTypeDerived: direct,
    settledWord: direct ? 'onStatement' : 'invoiced',
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
