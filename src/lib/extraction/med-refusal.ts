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
  | 'signed_in_future'

/** The bar the spine must clear. Anything below is treated as not read. */
const SPINE_CONFIDENCE: readonly Confidence[] = ['high', 'medium']

/**
 * The longest a medical certificate can run.
 *
 * 49 CFR 391.43(f) caps a certificate at TWO YEARS, and this is now that cap
 * exactly: 24 months from the signed date, inclusive of the anniversary day.
 *
 * ── TIGHTENED FROM 26 MONTHS (owner's ruling, 2026-09-12) ────────────────
 *
 * This used to allow 26 months of slack, on the argument that the point was to
 * catch `2027` read as `2037` rather than to adjudicate the edge of the
 * regulation, and that refusing valid documents to be strict about invalid
 * ones costs more than it saves.
 *
 * What changed is evidence about how these get read WRONG. The provider
 * comparison of 2026-09-12 had an engine return an expiry of `04/18/2026`
 * against a signed date of `04/18/2025` — a two-year span it invented, both
 * dates wrong, both at HIGH confidence, and internally consistent enough that
 * every rule above this one passed it. The near misses are not wild: they are
 * plausible spans a month or two off the regulation, and 26 months of slack is
 * exactly the room they land in.
 *
 * MONTHS, NOT DAYS, so the rule says what the regulation says. The old
 * `26 * 31` was 806 days, which is neither 26 months nor anything a person
 * would recognise; a February-to-February certificate and an August-to-August
 * one are both 24 months and differ by two days.
 */
const MAX_VALIDITY_MONTHS = 24

/**
 * The last day a certificate signed on `issuedIso` may legally expire.
 *
 * CLAMPED TO THE MONTH'S LAST DAY, because 24 months after the 31st of a month
 * is not the 31st of every month. `Date.UTC(2026, 1, 31)` silently becomes
 * 3 March, which would hand two extra days of validity to exactly the cards
 * whose dates are most likely to have been misread.
 */
function latestExpiry(issuedIso: string): string {
  const [year, month, day] = issuedIso.split('-').map(Number) as [
    number,
    number,
    number,
  ]
  const targetMonth = month + MAX_VALIDITY_MONTHS
  const lastOfMonth = new Date(Date.UTC(year, targetMonth, 0)).getUTCDate()
  const at = new Date(
    Date.UTC(year, targetMonth - 1, Math.min(day, lastOfMonth)),
  )
  return at.toISOString().slice(0, 10)
}

/**
 * @param uploadedOnIso The day the card arrived, as an ISO day.
 *
 * PASSED IN, NEVER READ FROM THE CLOCK HERE. A refusal rule that calls
 * `new Date()` is a rule whose behaviour depends on when the test runs, and
 * this file is pure arithmetic over two dates precisely so that it can be
 * reasoned about. The caller owns the clock — `readMedicalCert` — and says so
 * at its own call site.
 */
export function refuseMedicalCert(
  fields: ExtractedMedicalCert,
  uploadedOnIso: string,
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

    // A CERTIFICATE SIGNED IN THE FUTURE WAS MISREAD (owner's ruling,
    // 2026-09-12).
    //
    // An examination happens before the paperwork describing it arrives, so a
    // signed date after the day the card was uploaded is a year read wrong —
    // and it is the SPECIFIC error the comparison run produced, where an
    // engine dated a 2026 card to 2025 and another to a year that was not on
    // the form at all.
    //
    // CHECKED AGAINST THE UPLOAD, NOT AGAINST TODAY. The same card re-read
    // next year must reach the same verdict; a rule keyed to the moment of
    // execution would quietly reclassify old documents as they age.
    if (issued.iso > uploadedOnIso) return 'signed_in_future'

    // AND NO LONGER THAN THE REGULATION ALLOWS — 24 months exactly, inclusive
    // of the anniversary. See `MAX_VALIDITY_MONTHS` for why the old 26-month
    // slack was removed rather than kept.
    if (expires.iso > latestExpiry(issued.iso)) {
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
 * THIS IS THE WARNING, NOT THE MATCHER. `matchDriverByName` in `med-cert.ts`
 * proposes a driver from the printed name and is STRICT — an equal set of name
 * words, with none and several both meaning ask. This one is deliberately
 * LOOSE, and the two must not be confused for each other: a loose warning that
 * fires rarely is useful, and a loose match is a wrong driver chosen quietly.
 *
 * It earns its place after a person has picked a driver by hand, where the
 * printed name is a second opinion on that choice.
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
