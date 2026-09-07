import type { Confidence } from './envelope'
import type { ExtractedCdl } from './cdl-shape'
import { operationalClass } from './cdl-class'

// ---------------------------------------------------------------------------
// WHEN A CARD WAS NOT READ — WHICH IS DIFFERENT FROM READ AND EMPTY.
//
// `extraction.ts` refuses a rate confirmation with no stops, because a lane is
// the one thing every freight document has and a read without it did not
// happen. A licence's equivalent is its NUMBER and its EXPIRY: the number is
// what identifies the driver to every roadside inspection and MVR, and the
// expiry is the only field that feeds an alarm. A card yielding neither was
// not read, whatever else came back.
//
// NO HALF-DRIVER PREFILL. The alternative — fill what came back and leave the
// rest blank — puts a form in front of a dispatcher that is part document and
// part guess, with nothing marking which is which. A refusal sends them to
// manual entry knowing they are typing; a half-filled form invites them to
// trust the half they did not check.
// ---------------------------------------------------------------------------

export type CdlRefusal =
  | 'no_licence_number'
  | 'no_expiry'
  | 'low_confidence_spine'
  | 'state_disagrees'
  | 'no_address_state'
  | 'expiry_before_issue'
  | 'unknown_class'

/** The bar the spine must clear. Anything below is treated as not read. */
const SPINE_CONFIDENCE: readonly Confidence[] = ['high', 'medium']

/**
 * A date as the card prints it, compared as text.
 *
 * ISO-SLICED, NEVER `new Date()`. Rule 9-money's date half: constructing a
 * Date to compare two ISO strings introduces a timezone the card never had,
 * and `2027-06-30` becomes the 29th for everyone west of Greenwich. Two ISO
 * dates compare correctly as strings and need no zone at all.
 */
const isoDay = (value: string): string | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim())
  return match ? match[0]! : null
}

export function refuseCdl(fields: ExtractedCdl): CdlRefusal | null {
  const licence = fields.licenceNumber
  const expiry = fields.expiresAt

  if (!licence?.value?.trim()) return 'no_licence_number'
  if (!expiry?.value?.trim()) return 'no_expiry'

  // A GUESS ABOUT THE SPINE IS NOT A SPINE. Every other field on this card can
  // arrive uncertain and be corrected on the confirm form; these two decide
  // whether the driver is filed under the right number and warned before the
  // right date, and a low-confidence reading of either is worse than none.
  if (
    !SPINE_CONFIDENCE.includes(licence.confidence) ||
    !SPINE_CONFIDENCE.includes(expiry.confidence)
  ) {
    return 'low_confidence_spine'
  }

  // ── THE STATE'S TWO READINGS MUST AGREE ─────────────────────────────────
  //
  // The header word and the ST field of the printed address are independent
  // readings of the same fact. A disagreement means two documents got mixed or
  // the header was misread, and picking a winner would be the system deciding
  // which of its own mistakes to keep.
  //
  // TWO NAMED FIELDS, COMPARED — NOT A REGEX OVER A NOTE. This asked for the
  // cross-check inside `state.note` as free text and searched it for two
  // capitals. The first real card came back with a note of exactly `"FL"`, so
  // the check passed by locating the very value it was meant to test against.
  // It would have passed on any note containing the claimed code, and on notes
  // containing nothing useful at all. A check that cannot discriminate is not
  // a check — flag 101's shape, one layer along.
  if (fields.state?.value) {
    const claimed = fields.state.value.trim().toUpperCase()
    const printed = fields.addressStateCode?.value?.trim().toUpperCase()

    // NO SECOND READING IS NOT AGREEMENT. Without the address code the state
    // is a single unverified claim, and this contract's posture throughout is
    // that an unverified value refuses rather than proceeds. Named separately
    // from a disagreement because they mean different things to whoever reads
    // the refusal: one is a card that could not be fully read, the other is a
    // card contradicting itself.
    if (!printed) return 'no_address_state'
    if (printed !== claimed) return 'state_disagrees'
  }

  // ── A PRINTED CLASS THE TABLE DOES NOT KNOW ─────────────────────────────
  //
  // NOW REACHABLE, WHICH IS THE WHOLE POINT OF THE CHANGE ABOVE IT. While the
  // schema declared `enum: ['A','B','C']` the model simply never returned
  // anything else — a Georgia `AM` arrived as `A`, high confidence, and the
  // parser's `bad_enum` sat there unreachable. The class is a free string now,
  // so an unrecognised one gets this far and stops here.
  //
  // REFUSED RATHER THAN NULLED. A driver whose class this system cannot
  // interpret is not a driver with no class — it is a card somebody has to
  // look at. Nulling the field would file them as unclassified and let the
  // rest of the read through, which is the half-driver prefill this file
  // exists to prevent.
  if (fields.class?.value?.trim() && !operationalClass(fields.class.value)) {
    return 'unknown_class'
  }

  // A CARD CANNOT EXPIRE BEFORE IT WAS ISSUED. When both dates are present and
  // in that order, one of them was misread — most likely 4a and 4b swapped,
  // which is exactly the mistake a reader keyed on position rather than on the
  // AAMVA number makes.
  const issued = fields.issuedAt?.value ? isoDay(fields.issuedAt.value) : null
  const expires = isoDay(expiry.value)
  if (issued && expires && expires <= issued) return 'expiry_before_issue'

  return null
}

/**
 * "NONE" is an empty list, never a code.
 *
 * The card prints the word where a driver has no endorsements or no
 * restrictions. Carried through as a string it becomes an endorsement called
 * NONE — which reads, on a compliance screen, as a driver holding something.
 */
export function codeList(raw: readonly string[] | null | undefined): string[] {
  if (!raw) return []
  return raw
    .map((code) => code.trim().toUpperCase())
    .filter((code) => code !== '' && code !== 'NONE' && code !== 'N/A')
}
