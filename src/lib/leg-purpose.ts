// ---------------------------------------------------------------------------
// WAS THE TRAILER LOADED, OR WAS THE TRUCK MOVING ITSELF?
//
// A Relay trip's legs are not all freight. A driver repositions an empty
// trailer, bobtails to the next yard, or drags empty carts back — those miles
// are real and cost fuel, and they are not miles under load. `Load.emptyMiles`
// has existed since Phase 1 to hold the difference; nothing has ever filled
// it because nothing knew which legs were which.
//
// THE ONLY EVIDENCE THE CSV OFFERS IS `Shipper Account`, a label Amazon uses
// for its own accounting: "OutboundAmazonManaged", "BobtailMovementAnnotation",
// "FleetManagementEquipmentRepositioning". It was not written to answer this
// question, which is why the answer is a TABLE rather than a rule — the shapes
// are Amazon's and they change when Amazon changes them.
//
// A DATA TABLE, NOT LOGIC, and deliberately so. The owner tunes this; a list
// tuned three times a month belongs in git where it can be diffed and blamed,
// not in a settings row nobody can review. It moves to an organization setting
// the day a non-developer tenant needs to tune it, and not before.
//
// ORDER MATTERS: first match wins, so a specific rule can precede a general
// one. Everything unmatched is LOADED, because freight is the ordinary case
// and a leg wrongly called empty would understate the loaded miles a rate is
// judged against.
// ---------------------------------------------------------------------------

export type LegPurpose = 'EMPTY' | 'LOADED'

export interface LegPurposeRule {
  /** Matched against `Shipper Account`, case-insensitively. */
  pattern: RegExp
  purpose: LegPurpose
  /** Why this rule is here, for whoever tunes it next. */
  note: string
}

/**
 * The mapping, as ruled on 2026-08-17.
 *
 * Counts are from the 1,600-file sweep and are here so a future edit can see
 * what it is moving. They are a snapshot, not a contract.
 */
export const LEG_PURPOSE_RULES: readonly LegPurposeRule[] = [
  {
    pattern: /^Bobtail/i,
    purpose: 'EMPTY',
    note: 'A tractor moving with no trailer at all. 237 legs in the sweep.',
  },
  {
    pattern: /EquipmentRepositioning/i,
    purpose: 'EMPTY',
    note: 'Moving equipment to where it is needed. 721 legs — the largest empty category.',
  },
  {
    pattern: /Empty/i,
    purpose: 'EMPTY',
    note:
      'Amazon writes "Empty" when the move carries no freight, so this matches ' +
      'the word rather than an enumeration of its neighbours. 156 legs: ' +
      'TransfersEmptyCarts 82, CustomerFacingEmptyTrailer 71, ' +
      'TransfersEmptyPod 3. It replaced two narrower rules — an EmptyCarts$ ' +
      'anchor and an EmptyContainer pattern that matched NOTHING in 2,987 ' +
      'rows, while CustomerFacingEmptyTrailer sat unclassified between them.',
  },
  // ── KNOWN LOADED, ENUMERATED 2026-09-04 ────────────────────────────────
  //
  // THE TABLE USED TO LIST ONLY EMPTY PATTERNS, and everything unmatched fell
  // through to LOADED. That default is still right — freight is the ordinary
  // case — but it made "no rule matched" and "classified as loaded"
  // indistinguishable, so `isUnclassifiedLeg` called ALL ordinary freight
  // unclassified and the provisional note would have appeared on every load.
  // The schema had three states; the table could only ever produce two.
  //
  // So the loaded families are listed too, and unmatched now means what it
  // says: NOBODY HAS DECIDED. Counts are from the 1,600-file sweep, read with
  // the real CSV parser rather than by splitting on commas — a shell census of
  // the same corpus reported 4,367 legs with no Shipper Account at all, none of
  // which exist; they were rows split inside quoted fields.
  //
  // FIRST MATCH WINS, and the EMPTY rules above run first on purpose:
  // `TransfersEmptyCarts` is matched by /Empty/i before anything here sees it.
  {
    pattern: /^Outbound/i,
    purpose: 'LOADED',
    note: 'Freight leaving a facility. 1,067 legs across twelve variants — OutboundAmazonManaged alone is 827.',
  },
  {
    pattern: /^OB(Dedicated|Web)/i,
    purpose: 'LOADED',
    note: 'External freight under an Amazon contract. 65 legs.',
  },
  {
    pattern: /^(Amazon)?Inbound/i,
    purpose: 'LOADED',
    note: 'Freight arriving: AmazonInboundVendor 28, InboundRedirects 7, InboundCustomerReturns 6, AmazonInboundFba 3, and three singletons.',
  },
  {
    pattern: /^ATSLTL/i,
    purpose: 'LOADED',
    note: 'Less-than-truckload under Amazon Transportation Services. 46 legs.',
  },
  {
    pattern: /^GlobalMileInbound/i,
    purpose: 'LOADED',
    note: 'Cross-border inbound. 1 leg.',
  },
  {
    pattern: /^SWAMFNPickup/i,
    purpose: 'LOADED',
    note: 'A pickup from a merchant-fulfilled seller. 3 legs.',
  },
  // ── AND WHAT IS DELIBERATELY ABSENT ────────────────────────────────────
  //
  // `Transfers*` — roughly 450 legs across 25 variants — is NOT listed, and
  // neither is `TrailerPool*` (114). The prefix settles nothing:
  // `TransfersSellableInventory` carries goods and `TransfersBrokenCarts` moves
  // equipment, and the two sit side by side under one word. Listing them as
  // loaded to make the note quieter would be inventing the classification the
  // note exists to admit is missing.
  //
  // So a trip containing those legs reads as provisional. That is a larger set
  // than `TrailerPoolAdjustment` alone, and it is the honest one.
  // TrailerPoolAdjustment (112 legs across three variants) is deliberately
  // NOT here. Whether repositioning a pool trailer is an empty move is a
  // question about this business rather than about this string, and it is
  // with the owner. Unmatched means LOADED, which overstates loaded miles
  // visibly rather than understating them quietly.
]

/**
 * Which kind of leg this is.
 *
 * UNMATCHED IS LOADED, and that is the safe direction. Calling a loaded leg
 * empty would understate the miles a rate is measured against; calling an
 * empty leg loaded overstates them, which a dispatcher reading a trip can see
 * and correct. Neither is invented — both come from a label the document
 * printed.
 */
export function legPurpose(shipperAccount: unknown): LegPurpose {
  if (typeof shipperAccount !== 'string') return 'LOADED'
  const text = shipperAccount.trim()
  if (text === '') return 'LOADED'

  for (const rule of LEG_PURPOSE_RULES) {
    if (rule.pattern.test(text)) return rule.purpose
  }
  return 'LOADED'
}

/** True when this leg's miles belong in `Load.emptyMiles`. */
export function isEmptyLeg(shipperAccount: unknown): boolean {
  return legPurpose(shipperAccount) === 'EMPTY'
}

/**
 * True when NO rule matched and the leg fell through to the default.
 *
 * THE SCHEMA ALREADY ASKED FOR THIS AND NOTHING SUPPLIED IT. `LoadStop.legEmpty`
 * is documented as three-state — "null means nobody classified it; false means
 * classified as loaded" — and the writer stored `false` for both, because
 * `isEmptyLeg` collapses "matched a LOADED rule" and "matched nothing" into one
 * boolean. A leg Amazon labelled `TrailerPoolAdjustment`, which is the 112-leg
 * question still with the owner, was indistinguishable from freight somebody
 * had actually classified.
 *
 * IT MATTERS NOW BECAUSE THE NUMBER IS ON A SCREEN. While nothing displayed
 * empty miles, defaulting to LOADED "overstated loaded miles visibly rather
 * than understating them quietly" — the trade-off written beside the rules.
 * Visibly rested on something looking, and nothing was. A load whose split is
 * partly a default now says so.
 *
 * DERIVED FROM THE RULES, NOT FROM A PATTERN. The day a rule for
 * `TrailerPoolAdjustment` is added, legs carrying it classify and stop being
 * provisional — no edit here, no edit at the call site. See flag 91.
 */
export function isUnclassifiedLeg(shipperAccount: unknown): boolean {
  if (typeof shipperAccount !== 'string') return false
  const text = shipperAccount.trim()
  // An absent label is not an unclassified one: there is nothing to classify,
  // and flagging every blank would make the note meaningless on the freight
  // that carries no account at all.
  if (text === '') return false
  return !LEG_PURPOSE_RULES.some((rule) => rule.pattern.test(text))
}
