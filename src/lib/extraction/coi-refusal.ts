import type { Confidence } from './envelope'
import type { ExtractedCoi } from './coi-shape'
import { parseUsDate } from './us-dates'

// ---------------------------------------------------------------------------
// WHEN A CERTIFICATE OF INSURANCE WAS NOT READ.
//
// Same posture as `med-refusal.ts` and `cdl-refusal.ts`, and mostly the same
// rules, because the argument does not change with the document: a half-filled
// form invites somebody to trust the half they did not check, and a refusal
// sends them to manual entry knowing they are typing.
//
// ── THE SPINE IS THE EXPIRY, AND ONLY THE EXPIRY ──────────────────────────
//
// A certificate becomes one thing here: a `ComplianceItem` on the carrier,
// whose `expiresAt` is NOT NULL and is the only field that feeds an alarm. So
// a certificate yielding no expiry has not been read, whatever else came back
// — the policy number and the limits are useful and none of them can be the
// spine, because none of them decides when somebody has to act.
//
// THE POLICY NUMBER IS NOT THE SPINE, and that is worth writing down because
// it is the obvious candidate. It identifies the policy but it triggers
// nothing; a row with a number and no date is a row the safety queue cannot
// place, and a row with a date and no number is a usable alarm somebody can
// annotate later.
// ---------------------------------------------------------------------------

export type CoiRefusal =
  | 'no_expiry'
  | 'low_confidence_expiry'
  | 'unreadable_expiry'
  | 'unreadable_effective'
  | 'expiry_before_effective'
  | 'implausible_term'

/** The bar the spine must clear. Anything below is treated as not read. */
const SPINE_CONFIDENCE: readonly Confidence[] = ['high', 'medium']

/**
 * The longest a policy term can run, plus room to be wrong about it.
 *
 * Commercial auto policies are annual almost without exception; multi-year
 * terms exist and are rare. A span beyond this is a misread digit — most
 * likely a year, `2027` read as `2037` — rather than a policy somebody wrote.
 *
 * DELIBERATELY GENEROUS AT THREE YEARS AND A MONTH. The point is to catch a
 * transposed decade, not to adjudicate what an underwriter may sell. A rule
 * that refuses valid documents in order to be strict about invalid ones costs
 * more than it saves — the same reasoning `MAX_VALIDITY_DAYS` records for the
 * medical card's two-year cap.
 */
const MAX_TERM_DAYS = 37 * 31

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

export function refuseCoi(fields: ExtractedCoi): CoiRefusal | null {
  const expiry = fields.expiresAt
  if (!expiry?.value?.trim()) return 'no_expiry'

  // A GUESS ABOUT THE SPINE IS NOT A SPINE. Everything else on this
  // certificate can arrive uncertain and be corrected on a form; this one date
  // decides when a carrier's coverage lapses, and a low-confidence reading of
  // it is worse than none.
  if (!SPINE_CONFIDENCE.includes(expiry.confidence)) {
    return 'low_confidence_expiry'
  }

  // CONVERTED HERE, NOT UPSTREAM. `us-dates.ts` states the rule and refuses a
  // format nobody planned for, rather than handing it to a parser that always
  // returns something.
  const expires = parseUsDate(expiry.value)
  if (!expires.ok) return 'unreadable_expiry'

  const effective = fields.effectiveAt
  if (effective?.value?.trim()) {
    const from = parseUsDate(effective.value)
    // AN EFFECTIVE DATE THAT WILL NOT READ IS A REFUSAL, not a shrug. Both
    // dates come off the same row of the same table in the same hand; if one
    // of them is unreadable, the reading of the other is not to be trusted
    // either.
    if (!from.ok) return 'unreadable_effective'

    // COMPARED AS TEXT. Two ISO strings sort correctly and no timezone can get
    // between them — the same reason `cdl-refusal.ts` compares them this way.
    if (expires.iso < from.iso) return 'expiry_before_effective'

    if (daysBetween(from.iso, expires.iso) > MAX_TERM_DAYS) {
      return 'implausible_term'
    }
  }

  return null
}

/**
 * Does this certificate name the carrier it is being filed against?
 *
 * ── A COMPARISON SHOWN, NEVER A MATCH PERFORMED ───────────────────────────
 *
 * Brokers send certificates constantly — their own, their other carriers',
 * last year's — so "this names somebody else" is a real and common case rather
 * than a paranoid one. But the answer is a WARNING, not a refusal: an insurer
 * writes the legal entity (`RAM HAULAGE LLC`) where this system holds the
 * trading name (`RAM Haulage`), and refusing on that difference would reject
 * correct certificates constantly.
 *
 * SO IT IS DELIBERATELY LOOSE, AND ITS OUTPUT IS DISPLAYED RATHER THAN ACTED
 * ON. A person reads "this certificate names X, you are filing it against Y"
 * and decides. The same posture `checkDriverName` takes on the medical card,
 * and for the same reason: the cost of a wrong refusal is a document nobody
 * can file, and the cost of a wrong acceptance is caught by the person looking
 * at the sentence.
 *
 * MC AND USDOT ARE THE STRONGER SIGNAL WHERE THEY EXIST. A name can be spelled
 * several ways; a USDOT number cannot. When the certificate prints one and it
 * disagrees with the company's, that is worth saying more loudly than a name
 * mismatch — and it is still a sentence rather than a wall.
 */
export interface CarrierCheck {
  /** True when nothing contradicts the carrier this is filed against. */
  agrees: boolean
  /** What to show, in words. Empty when there is nothing to say. */
  notes: string[]
}

/** Letters and digits only, folded — for comparing names nobody typed twice. */
const fold = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Digits only. `MC-1234567` and `1234567` are the same number. */
const digits = (text: string) => text.replace(/\D/g, '')

export function checkCarrier(
  fields: ExtractedCoi,
  against: { name: string; mcNumber: string | null; dotNumber: string | null },
): CarrierCheck {
  const notes: string[] = []
  let agrees = true

  const printed = fields.insuredName?.value?.trim()
  if (printed) {
    const a = fold(printed)
    const b = fold(against.name)
    // CONTAINMENT EITHER WAY, because `RAM HAULAGE LLC` contains `RAM Haulage`
    // and a legal suffix is not a disagreement.
    if (a !== '' && b !== '' && !a.includes(b) && !b.includes(a)) {
      agrees = false
      notes.push(
        `The certificate names ${JSON.stringify(printed)}; you are filing it against ${JSON.stringify(against.name)}.`,
      )
    }
  }

  // THE NUMBERS, WHERE BOTH SIDES HAVE ONE. Absence is never a disagreement:
  // most certificates print neither, and a company row may hold neither.
  const pairs: [string, string | null | undefined, string | null][] = [
    ['USDOT', fields.insuredDot?.value, against.dotNumber],
    ['MC', fields.insuredMc?.value, against.mcNumber],
  ]
  for (const [label, printedNumber, ours] of pairs) {
    const mine = digits(ours ?? '')
    const theirs = digits(printedNumber ?? '')
    if (mine === '' || theirs === '') continue
    if (mine !== theirs) {
      agrees = false
      notes.push(
        `The certificate's ${label} is ${theirs} and this carrier's is ${mine}.`,
      )
    }
  }

  return { agrees, notes }
}
