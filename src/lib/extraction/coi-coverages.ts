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
// `corpus/coi/acord25-01.pdf` prints "Non-Trucking Liability", and the naive
// substring rule — it contains "liability" — would file it as
// `INSURANCE_LIABILITY`. That is not a spelling difference. Non-trucking
// (bobtail) liability covers a tractor when it is NOT under dispatch; it is
// the opposite of the primary auto liability a DOT filing requires. Filing one
// as the other would make an owner-operator look covered for exactly the miles
// they are not covered for, and the safety queue would show green.
//
// So the table is ORDERED, the narrow patterns are tested first, and the
// coverages this system does not file as an obligation of their own carry a
// `caution` sentence that goes on screen beside the row.
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
 */
const PATTERNS: {
  match: RegExp
  type: ComplianceType | null
  caution: string | null
}[] = [
  {
    // Bobtail / deadhead / non-trucking. NOT primary liability — see above.
    match: /non[-\s]?truck|bobtail|deadhead|not\s+in\s+use/i,
    type: 'OTHER',
    caution:
      'Non-trucking (bobtail) liability covers the tractor when it is not under dispatch. It is not the primary auto liability a DOT filing requires.',
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
 * What a printed coverage type might be.
 *
 * Called on the transcription, after the read, and its answer is a default on
 * a control a person can change — never a value written anywhere on its own.
 */
export function proposeCoverage(
  printed: string | null | undefined,
): CoverageProposal {
  const text = printed?.trim()
  if (!text) return { type: null, caution: null }

  for (const row of PATTERNS) {
    if (row.match.test(text)) return { type: row.type, caution: row.caution }
  }

  return { type: null, caution: null }
}
