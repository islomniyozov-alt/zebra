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
    pattern: /EmptyContainer/i,
    purpose: 'EMPTY',
    note: 'Ruled as part of the default mapping. NOT OBSERVED in the sweep — zero legs.',
  },
  {
    pattern: /EmptyCarts$/i,
    purpose: 'EMPTY',
    note: 'Returning empty carts. 82 legs.',
  },
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
