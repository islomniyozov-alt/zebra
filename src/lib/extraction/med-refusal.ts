import type { Confidence } from './envelope'
import type { ExtractedMedicalCert } from './med-shape'
import { parseMedDate } from './med-dates'

// ---------------------------------------------------------------------------
// WHEN A MEDICAL CERTIFICATE WAS NOT READ.
//
// Same posture as `cdl-refusal.ts`, and mostly the same rules, because the
// argument does not change with the document: a half-filled form invites
// somebody to trust the half they did not check, and a refusal sends them to
// manual entry knowing they are typing.
//
// THE SPINE HERE IS THE EXPIRY, AND ONLY THE EXPIRY. The CDL's spine is its
// number and its expiry — the number identifies the driver to every roadside
// inspection. A medical certificate identifies nobody: whose it is comes from
// the page it was uploaded on. What it does is say when the driver stops being
// legal to drive, so a certificate yielding no expiry has not been read,
// whatever else came back.
// ---------------------------------------------------------------------------

export type MedicalCertRefusal =
  | 'no_expiry'
  | 'low_confidence_expiry'
  | 'unreadable_expiry'
  | 'unreadable_issue'
  | 'expiry_before_issue'
  | 'implausible_validity'

/** The bar the spine must clear. Anything below is treated as not read. */
const SPINE_CONFIDENCE: readonly Confidence[] = ['high', 'medium']

/**
 * The longest a medical certificate can run, plus room to be wrong about it.
 *
 * 49 CFR 391.43(f) caps a certificate at TWO YEARS. A span longer than that is
 * a misread digit somewhere — most likely a year — rather than a certificate
 * somebody issued.
 *
 * DELIBERATELY GENEROUS AT 26 MONTHS. The point is to catch `2027` read as
 * `2037`, not to adjudicate the edge of the regulation: a certificate issued a
 * few days before its stated start, or a form filled in loosely, must not be
 * refused by this system's arithmetic. A rule that refuses valid documents to
 * be strict about invalid ones costs more than it saves.
 */
const MAX_VALIDITY_DAYS = 26 * 31

/** Two ISO days apart, compared without a timezone anywhere in it. */
function daysBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split('-').map(Number) as [
    number,
    number,
    number,
  ]
  const [ty, tm, td] = toIso.split('-').map(Number) as [number, number, number]
  return (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000
}

export function refuseMedicalCert(
  fields: ExtractedMedicalCert,
): MedicalCertRefusal | null {
  const expiry = fields.expiresAt
  if (!expiry?.value?.trim()) return 'no_expiry'

  // A GUESS ABOUT THE SPINE IS NOT A SPINE. Everything else on this card can
  // arrive uncertain and be corrected on a form; this one date decides whether
  // a driver is legal, and a low-confidence reading of it is worse than none.
  if (!SPINE_CONFIDENCE.includes(expiry.confidence)) {
    return 'low_confidence_expiry'
  }

  // THE DATE IS CONVERTED HERE, NOT UPSTREAM. `parseMedDate` states the rule
  // and refuses a format nobody planned for, rather than a model resolving an
  // ambiguous date silently and discarding what was printed.
  const expires = parseMedDate(expiry.value)
  if (!expires.ok) return 'unreadable_expiry'

  const issue = fields.issuedAt
  if (issue?.value?.trim()) {
    const issued = parseMedDate(issue.value)
    // AN UNREADABLE ISSUE DATE REFUSES RATHER THAN BEING DROPPED. It is the
    // only thing bounding the expiry, so losing it quietly would remove the
    // check below without anybody deciding to.
    if (!issued.ok) return 'unreadable_issue'

    // A CARD CANNOT EXPIRE BEFORE IT WAS EXAMINED. When both dates are present
    // in that order, one was misread — most likely the two swapped, which is
    // what a reader keyed on position rather than on the label does.
    if (expires.iso <= issued.iso) return 'expiry_before_issue'

    if (daysBetween(issued.iso, expires.iso) > MAX_VALIDITY_DAYS) {
      return 'implausible_validity'
    }
  }

  return null
}

export type NameCheck =
  | { agrees: true }
  | { agrees: false; printed: string; expected: string }
  | { agrees: 'unknown'; why: 'no_printed_name' }

/**
 * Does the name on the card match the driver whose page received it?
 *
 * ── IT WARNS. IT NEVER CHOOSES. ───────────────────────────────────────────
 *
 * The driver is stated by WHERE THE UPLOAD HAPPENED. This comparison exists so
 * a certificate filed against the wrong person is visible, and it must not be
 * allowed to become a matcher: a reader that picked a driver from a name could
 * attach a medical card to somebody else, and it would look like a successful
 * upload rather than a mistake.
 *
 * SO A DISAGREEMENT IS NOT A REFUSAL EITHER. The card may be right and the
 * page wrong, or the reading may simply be poor; deciding which is a person's
 * job. `refuseMedicalCert` never consults this.
 *
 * COMPARED LOOSELY ON PURPOSE. Case, punctuation, ordering and middle names
 * all differ legitimately between a printed card and a typed record — "SMITH,
 * JOHN A" and "John Smith" are the same person — so this compares the set of
 * name words and reports a disagreement only when they genuinely diverge. A
 * strict comparison would cry wolf on nearly every card, which is the fastest
 * way to teach somebody to ignore the warning that matters.
 */
export function checkDriverName(
  fields: ExtractedMedicalCert,
  expected: string,
): NameCheck {
  const printed = fields.driverName?.value?.trim()
  if (!printed) return { agrees: 'unknown', why: 'no_printed_name' }

  const words = (text: string) =>
    new Set(
      text
        .toLowerCase()
        .replace(/[.,]/g, ' ')
        .split(/\s+/)
        .filter((word) => word.length > 1),
    )

  const onCard = words(printed)
  const onRecord = words(expected)
  if (onCard.size === 0 || onRecord.size === 0) {
    return { agrees: 'unknown', why: 'no_printed_name' }
  }

  // EVERY WORD OF THE SHORTER NAME APPEARS IN THE LONGER. A card printing a
  // middle name the record lacks is agreement; a card printing a different
  // surname is not.
  const [shorter, longer] =
    onCard.size <= onRecord.size ? [onCard, onRecord] : [onRecord, onCard]
  for (const word of shorter) {
    if (!longer.has(word)) return { agrees: false, printed, expected }
  }
  return { agrees: true }
}
