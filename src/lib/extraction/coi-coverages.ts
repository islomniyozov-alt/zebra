import type { ComplianceType } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// WHAT A PRINTED COVERAGE ROW MIGHT BE — A PROPOSAL, NEVER A DECISION.
//
// ── THE SAME RULE AS `cdl-codes.ts`, FOR THE SAME REASON ─────────────────
//
// The model is never told which coverages exist. It transcribes the TYPE OF
// INSURANCE cell and this file reads the transcription afterwards. Telling it
// the list is exactly how a Georgia `CLASS AM` came back as `A` at high
// confidence, and the failure mode here is worse: a certificate for bobtail
// coverage, told the permitted answers, comes back as auto liability.
//
// NOTHING HERE CHANGES A READING. The printed text is carried through
// unchanged onto the confirm step. This adds a suggestion beside it.
//
// ── AND THE SUGGESTION IS SOMETIMES "I WILL NOT SAY" ─────────────────────
//
// `type: null` is a legitimate answer and the important one. An unrecognised
// coverage is a coverage this table does not know, which is worth showing
// somebody and is not evidence the certificate is wrong. The person picks the
// obligation on the confirm step; an unrecognised row simply starts unset.
//
// ── NON-TRUCKING LIABILITY IS THE REASON THIS FILE IS CAREFUL ────────────
//
// `corpus/coi/acord25-01.pdf` evidences non-trucking liability, and the naive
// substring rule — it contains "liability" — would file it as
// `INSURANCE_LIABILITY`. That is not a spelling difference. Non-trucking
// (bobtail) liability covers a tractor when it is NOT under dispatch; it is
// the opposite of the primary auto liability a DOT filing requires. Filing one
// as the other would make an owner-operator look covered for exactly the miles
// they are not covered for, and the safety queue would show green.
//
// So the table is ORDERED and the narrow patterns are tested first.
//
// ── AND A QUALIFIER IS NOT ALWAYS IN THE TYPE CELL ───────────────────────
//
// THE MEASURED CASE, from the first read of that certificate on 2026-09-09.
// The model returned:
//
//   type:  "AUTOMOBILE LIABILITY"          <- the form's PRE-PRINTED heading
//   limit: "Non-Trucking Liability $ 750,000"   <- the agency's write-in
//
// which is a defensible reading of the layout — ACORD prints the AUTOMOBILE
// LIABILITY section and the agency writes its descriptor into the LIMITS
// column beside the amount. It is also, read cell by cell, the exact failure
// above: `AUTOMOBILE LIABILITY` proposes `INSURANCE_LIABILITY` with nothing to
// warn anybody, and two tractors get filed as covered on dispatch.
//
// So the CAUTION PATTERNS ARE TESTED AGAINST THE WHOLE ROW and the affirmative
// ones against the type cell alone. The asymmetry is deliberate:
//
//   A QUALIFIER THAT CHANGES WHAT A COVERAGE IS can be written in any cell of
//   the row, and the cost of missing one is a false green on a compliance
//   screen. So it is looked for everywhere.
//
//   A COVERAGE NAME found in the wrong cell would be a misclassification —
//   "cargo excluded" in a limits box is not cargo cover — and the cost of
//   missing one is only that somebody picks from a list. So those are read
//   where they belong.
//
// This is still not a correction. The transcription is untouched; the type
// cell goes on screen exactly as printed, next to the sentence explaining what
// the rest of the row says about it.
// ---------------------------------------------------------------------------

export interface CoverageProposal {
  /** The obligation this row probably is, or null for "this table does not know". */
  type: ComplianceType | null
  /** A sentence to show beside the row. Null when there is nothing to say. */
  caution: string | null
}

/**
 * The table, in order. FIRST MATCH WINS, and the order is load-bearing:
 * "Non-Trucking Liability" must be tested before anything matching
 * "liability", and "Motor Truck Cargo" before anything matching "truck".
 *
 * `wholeRow` marks the patterns that are looked for in every cell rather than
 * only in the type — the qualifiers. See the header for the read that forced
 * the distinction.
 */
const PATTERNS: {
  match: RegExp
  type: ComplianceType | null
  caution: string | null
  wholeRow?: true
}[] = [
  {
    // Bobtail / deadhead / non-trucking. NOT primary liability — see above.
    match: /non[-\s]?truck|bobtail|deadhead|not\s+in\s+use/i,
    type: 'OTHER',
    caution:
      'Non-trucking (bobtail) liability covers the tractor when it is not under dispatch. It is not the primary auto liability a DOT filing requires.',
    wholeRow: true,
  },
  {
    match: /cargo/i,
    type: 'INSURANCE_CARGO',
    caution: null,
  },
  {
    match: /phys(ical)?\.?\s*dam|comp(rehensive)?\s*(&|and|\/)\s*coll/i,
    type: 'INSURANCE_PHYSICAL_DAMAGE',
    caution: null,
  },
  {
    // General liability is a real coverage and not an auto one. It has no
    // obligation of its own here, so it files as OTHER and says why.
    match: /general\s+liab/i,
    type: 'OTHER',
    caution:
      'Commercial general liability is not automobile liability; it does not satisfy an auto filing.',
  },
  {
    match: /work(ers|men)'?s?\s*comp|employers'?\s+liab/i,
    type: 'OTHER',
    caution: 'Workers compensation is not a vehicle or cargo obligation.',
  },
  {
    match: /umbrella|excess\s+liab/i,
    type: 'OTHER',
    caution:
      'Umbrella or excess liability sits above an underlying policy rather than replacing it.',
  },
  {
    // Only what is left, and only then, reads as primary auto liability.
    match:
      /auto(mobile)?\s*liab|trucking\s+liab|primary\s+liab|combined\s+single|^liability$/i,
    type: 'INSURANCE_LIABILITY',
    caution: null,
  },
]

/**
 * What a printed coverage row might be.
 *
 * TAKES THE ROW, NOT THE TYPE CELL. That is the change of 2026-09-09 and the
 * header says why: on the first real certificate the words that decide what
 * the coverage IS were printed in the limits column.
 *
 * Called on the transcription, after the read, and its answer is a default on
 * a control a person can change — never a value written anywhere on its own.
 */
export function proposeCoverage(
  printedType: string | null | undefined,
  printedLimit?: string | null,
): CoverageProposal {
  const type = printedType?.trim() ?? ''
  const wholeRow = [type, printedLimit?.trim() ?? ''].join(' ').trim()
  if (wholeRow === '') return { type: null, caution: null }

  for (const row of PATTERNS) {
    const against = row.wholeRow ? wholeRow : type
    if (against !== '' && row.match.test(against)) {
      return { type: row.type, caution: row.caution }
    }
  }

  return { type: null, caution: null }
}
