import { readCostOf, type AskResult, type ReadCost } from './claude'
import { askModel } from './model-engine'
import { parseCoiResponse } from './extraction/coi-parse'
import { COI_EXTRACTION_SYSTEM_WITH_SCHEMA } from './extraction/coi-prompt'
import { parseUsDate } from './extraction/us-dates'
import {
  checkCarrier,
  refuseCoi,
  type CarrierCheck,
  type CoiRefusal,
} from './extraction/coi-refusal'
import type { ExtractedCoi } from './extraction/coi-shape'

// ---------------------------------------------------------------------------
// READING A CERTIFICATE OF INSURANCE, AND WHAT A CONFIRMED ONE BECOMES.
//
// ── THE SAME POSTURE AS THE MEDICAL CARD, AND ONE REAL DIFFERENCE ─────────
//
// It goes through `askModel`, chooses no engine of its own, transcribes rather
// than interprets, and refuses on a doubtful spine. All of that is
// `med-cert.ts`'s shape and the reasoning is written out there.
//
// WHAT DIFFERS IS THE SUBJECT. A medical certificate belongs to a PERSON and
// the reader has to work out which one. A certificate of insurance belongs to
// the CARRIER, and the carrier is stated — somebody filing it has already
// chosen an authority, or there is only one. So there is no matching to do
// here; there is CHECKING, which is a different thing and never decides
// anything (see `checkCarrier`).
//
// ── ONE CERTIFICATE, UP TO TWO COMPLIANCE ROWS ───────────────────────────
//
// An ACORD certificate usually evidences both auto liability and cargo, and
// they are separate obligations with separate limits that a carrier can hold
// one of and not the other. So a confirmed certificate becomes one row per
// coverage the document actually carries — never a row for a coverage it does
// not mention, because an absent cargo line means no cargo coverage rather
// than an unknown one.
//
// NOTHING IS PERSISTED BY READING. The certificate is read, checked and
// dropped. Filing it is a separate, confirmed action.
// ---------------------------------------------------------------------------

export type CoiReadOutcome =
  | { ok: true; fields: ExtractedCoi; cost: ReadCost }
  | {
      ok: false
      reason: 'unsupported_type' | 'call_failed' | 'unparsable' | CoiRefusal
      cost: ReadCost | null
    }

/** Nothing read, in the shape a read returns. */
export const NOTHING_READ: ExtractedCoi = {
  policyNumber: null,
  insurer: null,
  effectiveAt: null,
  expiresAt: null,
  liabilityLimit: null,
  cargoLimit: null,
  insuredName: null,
  insuredMc: null,
  insuredDot: null,
}

export async function readCoi(input: {
  base64: string
  mimeType: string
  /** Named by an accuracy run, absent everywhere else. */
  model?: string
  apiKey?: string
}): Promise<CoiReadOutcome> {
  let answer: AskResult
  try {
    answer = await askModel({
      base64: input.base64,
      mimeType: input.mimeType,
      system: COI_EXTRACTION_SYSTEM_WITH_SCHEMA,
      prompt:
        'Read this certificate of insurance and return the JSON described.',
      ...(input.model ? { model: input.model } : {}),
      ...(input.apiKey ? { apiKey: input.apiKey } : {}),
    })
  } catch (error) {
    const reason =
      error instanceof Error &&
      'reason' in error &&
      (error.reason === 'document_too_large' ||
        error.reason === 'unsupported_media_type' ||
        error.reason === 'truncated')
        ? ('unsupported_type' as const)
        : ('call_failed' as const)
    // Nothing was billed: the call never produced an answer.
    return { ok: false, reason, cost: null }
  }

  const cost = readCostOf(answer)

  let fields: ExtractedCoi
  try {
    fields = parseCoiResponse(answer.text)
  } catch {
    return { ok: false, reason: 'unparsable', cost }
  }

  const refusal = refuseCoi(fields)
  if (refusal) return { ok: false, reason: refusal, cost }

  return { ok: true, fields, cost }
}

/** One coverage the certificate evidences, ready to become a row. */
export interface CoiCoverage {
  type: 'INSURANCE_LIABILITY' | 'INSURANCE_CARGO'
  /** ISO day. The compliance row's `expiresAt`, which is NOT NULL. */
  expiresAt: string
  /** The policy number, as printed, or null. */
  identifier: string | null
  /** The insurer, as printed, or null. */
  issuer: string | null
  /** The limit exactly as printed, for the note. Never parsed to cents here. */
  limit: string | null
}

export interface CoiProposal {
  coverages: CoiCoverage[]
  /** ISO, converted by `parseUsDate` from what was printed. */
  expiresAt: string
  effectiveAt: string | null
  /** Shown beside the values on the confirm step. Never acted on. */
  carrier: CarrierCheck
}

/**
 * What the confirm step shows, and what a click would file.
 *
 * ── THE LIMIT GOES IN THE NOTE, NOT INTO A COLUMN ────────────────────────
 *
 * `ComplianceItem` has no money field, and adding one to hold a printed limit
 * would be a column that exists for one document type and is null on every
 * other row. The limit is evidence about the policy rather than something this
 * system computes with, so it is recorded as text where a person reads it —
 * exactly as printed, because `money.ts` refuses what it cannot parse and a
 * limit is not a figure this system needs as a number.
 */
export function coiProposal(
  fields: ExtractedCoi,
  against: { name: string; mcNumber: string | null; dotNumber: string | null },
): CoiProposal | null {
  const expiry = parseUsDate(fields.expiresAt?.value)
  // Unreachable after `refuseCoi` passes — it checks the same conversion — and
  // handled rather than asserted, because "cannot happen" has a history here.
  if (!expiry.ok) return null

  const effective = fields.effectiveAt?.value
    ? parseUsDate(fields.effectiveAt.value)
    : null

  const identifier = fields.policyNumber?.value?.trim() || null
  const issuer = fields.insurer?.value?.trim() || null

  const coverages: CoiCoverage[] = []
  // LIABILITY IS ASSUMED PRESENT WHEN THE CERTIFICATE READ AT ALL. The spine
  // is the auto-liability expiry — that is the row the prompt asks for — so a
  // certificate that yielded one evidences liability by construction.
  coverages.push({
    type: 'INSURANCE_LIABILITY',
    expiresAt: expiry.iso,
    identifier,
    issuer,
    limit: fields.liabilityLimit?.value?.trim() || null,
  })

  // CARGO ONLY WHEN THE DOCUMENT SAYS SO. An absent cargo line means the
  // carrier has no cargo coverage on this certificate, which is a fact — not a
  // row to create with an unknown limit.
  const cargo = fields.cargoLimit?.value?.trim()
  if (cargo) {
    coverages.push({
      type: 'INSURANCE_CARGO',
      // THE SAME EXPIRY, AND THAT IS AN ASSUMPTION WORTH NAMING. ACORD prints
      // one date row per coverage line and this contract reads only the
      // liability row's dates, so a cargo policy on a different term would be
      // filed against the liability expiry. It is the conservative direction —
      // an earlier cargo expiry would alarm late — and the confirm step shows
      // the date, so a person filing a split-term certificate can see it.
      expiresAt: expiry.iso,
      identifier,
      issuer,
      limit: cargo,
    })
  }

  return {
    coverages,
    expiresAt: expiry.iso,
    effectiveAt: effective?.ok ? effective.iso : null,
    carrier: checkCarrier(fields, against),
  }
}
