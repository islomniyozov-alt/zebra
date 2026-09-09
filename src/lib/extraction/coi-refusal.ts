import type { Confidence } from './envelope'
import type { CoverageReading, ExtractedCoi } from './coi-shape'
import { parseUsDate } from './us-dates'

// ---------------------------------------------------------------------------
// WHEN A CERTIFICATE OF INSURANCE WAS NOT READ.
//
// Same posture as `med-refusal.ts` and `cdl-refusal.ts`, and mostly the same
// rules, because the argument does not change with the document: a half-filled
// form invites somebody to trust the half they did not check, and a refusal
// sends them to manual entry knowing they are typing.
//
// ── THE SPINE IS AN EXPIRY, AND IT IS NOW PER ROW ────────────────────────
//
// A certificate becomes `ComplianceItem` rows whose `expiresAt` is NOT NULL
// and is the only field that feeds an alarm. So a row yielding no usable
// expiry cannot become a compliance record, whatever else it carried.
//
// WHAT CHANGED ON 2026-09-09 IS THE UNIT. The first version read one expiry
// for the whole certificate and refused the document when it was missing. That
// only worked while a certificate was assumed to be one policy — and
// `acord25-01.pdf` is two named coverages against one date pair, which is the
// gentle version of the problem. A certificate placing liability with one
// insurer to March and physical damage with another to September is ordinary,
// and reading one date for both would file an alarm nine months late.
//
// So each row is judged on its own and a bad row is DROPPED AND NAMED rather
// than taking the certificate down with it. The document is refused only when
// no row survives — which is the same rule as before, applied to a list.
//
// THE POLICY NUMBER IS NOT THE SPINE, and that is worth writing down because
// it is the obvious candidate. It identifies the policy but it triggers
// nothing; a row with a number and no date is a row the safety queue cannot
// place, and a row with a date and no number is a usable alarm somebody can
// annotate later.
// ---------------------------------------------------------------------------

export type CoiRefusal =
  | 'not_a_certificate'
  | 'no_coverage_rows'
  | 'no_usable_coverage'

/** Why one row cannot become a compliance record. Shown beside the row. */
export type RowRefusal =
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

/** One row's dates, converted — or the reason it cannot become a record. */
export type RowDates =
  | { ok: true; expiresIso: string; effectiveIso: string | null }
  | { ok: false; reason: RowRefusal }

export function judgeCoverageRow(row: CoverageReading): RowDates {
  const expiry = row.expiresAt
  if (!expiry?.value?.trim()) return { ok: false, reason: 'no_expiry' }

  // A GUESS ABOUT THE SPINE IS NOT A SPINE. Everything else on this row can
  // arrive uncertain and be corrected on a form; this one date decides when
  // coverage lapses, and a low-confidence reading of it is worse than none.
  //
  // AND IT IS NOW A LIVE RULE RATHER THAN A THEORETICAL ONE. The prompt tells
  // the model to answer `low` when it is guessing which row a value belongs
  // to — exactly the case a certificate with one date pair and two coverage
  // rows creates — so this is the clause that stops an inherited date becoming
  // an alarm nobody checked.
  if (!SPINE_CONFIDENCE.includes(expiry.confidence)) {
    return { ok: false, reason: 'low_confidence_expiry' }
  }

  // CONVERTED HERE, NOT UPSTREAM. `us-dates.ts` states the rule and refuses a
  // format nobody planned for, rather than handing it to a parser that always
  // returns something.
  const expires = parseUsDate(expiry.value)
  if (!expires.ok) return { ok: false, reason: 'unreadable_expiry' }

  const effective = row.effectiveAt
  if (!effective?.value?.trim()) {
    return { ok: true, expiresIso: expires.iso, effectiveIso: null }
  }

  const from = parseUsDate(effective.value)
  // AN EFFECTIVE DATE THAT WILL NOT READ IS A REFUSAL, not a shrug. Both dates
  // come off the same row of the same table in the same hand; if one of them
  // is unreadable, the reading of the other is not to be trusted either.
  if (!from.ok) return { ok: false, reason: 'unreadable_effective' }

  // COMPARED AS TEXT. Two ISO strings sort correctly and no timezone can get
  // between them — the same reason `cdl-refusal.ts` compares them this way.
  if (expires.iso < from.iso) {
    return { ok: false, reason: 'expiry_before_effective' }
  }
  if (daysBetween(from.iso, expires.iso) > MAX_TERM_DAYS) {
    return { ok: false, reason: 'implausible_term' }
  }

  return { ok: true, expiresIso: expires.iso, effectiveIso: from.iso }
}

/**
 * Whether the certificate as a whole was read.
 *
 * THREE REFUSALS, AND THEY SAY DIFFERENT THINGS TO A PERSON:
 *
 *   `not_a_certificate` — nothing came back at all. Probably not an ACORD
 *   form, or a photograph of one nobody could read.
 *   `no_coverage_rows` — it read as a certificate and the coverages table came
 *   back empty. Worth a second look at the document rather than a second
 *   photograph.
 *   `no_usable_coverage` — rows were read and not one of them yields an
 *   expiry. A better photograph might fix this.
 */
export function refuseCoi(fields: ExtractedCoi): CoiRefusal | null {
  const rows = fields.coverages
  if (rows === null) {
    // NOTHING AT ALL, which the prompt reserves for "not an ACORD
    // certificate". An insured name without coverages is still a certificate
    // that was reached, so the two are told apart rather than merged.
    return fields.insuredName === null
      ? 'not_a_certificate'
      : 'no_coverage_rows'
  }
  if (rows.length === 0) return 'no_coverage_rows'

  const usable = rows.some((row) => judgeCoverageRow(row).ok)
  return usable ? null : 'no_usable_coverage'
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
export const fold = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Digits only. `MC-1234567` and `1234567` are the same number. */
export const digits = (text: string) => text.replace(/\D/g, '')

/**
 * Whether a printed insured name and one of our carriers are the same entity,
 * as far as a string comparison can tell.
 *
 * CONTAINMENT EITHER WAY, because `RAM HAULAGE LLC` contains `RAM Haulage` and
 * a legal suffix is not a disagreement. Extracted from `checkCarrier` because
 * `decideCoiSubject` asks the same question of every authority — and a second
 * copy of a matching rule is two rules that drift.
 */
export function namesAgree(printed: string, ours: string): boolean {
  const a = fold(printed)
  const b = fold(ours)
  if (a === '' || b === '') return false
  return a.includes(b) || b.includes(a)
}

export function checkCarrier(
  fields: ExtractedCoi,
  against: { name: string; mcNumber: string | null; dotNumber: string | null },
): CarrierCheck {
  const notes: string[] = []
  let agrees = true

  const printed = fields.insuredName?.value?.trim()
  if (printed && !namesAgree(printed, against.name)) {
    agrees = false
    notes.push(
      `The certificate names ${JSON.stringify(printed)}; you are filing it against ${JSON.stringify(against.name)}.`,
    )
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
