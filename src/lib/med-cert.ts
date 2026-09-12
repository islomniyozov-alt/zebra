import { readCostOf, type AskResult, type ReadCost } from './claude'
import type { Confidence } from './extraction/envelope'
import { askModel } from './model-engine'
import { parseMedicalCertResponse } from './extraction/med-parse'
import { MEDICAL_CERT_SYSTEM_WITH_SCHEMA } from './extraction/med-prompt'
import { parseMedDate } from './extraction/med-dates'
import {
  checkDriverName,
  refuseMedicalCert,
  type MedicalCertRefusal,
  type NameCheck,
} from './extraction/med-refusal'
import type { ExtractedMedicalCert } from './extraction/med-shape'

// ---------------------------------------------------------------------------
// READING A DOT MEDICAL EXAMINER'S CERTIFICATE.
//
// ── THE SAME ENGINE POSTURE AS THE CDL, AND ONE DIFFERENCE THAT MATTERS ────
//
// It goes through `askModel` and chooses no engine of its own, exactly as
// `cdl.ts` does. What differs is where it lands: a licence is read BEFORE a
// driver exists and prefills the form that creates one. A medical certificate
// is read ON an existing driver's page, so the driver is not in question and
// nothing here identifies anybody.
//
// SO THE OUTPUT IS A PROPOSAL, NOT A WRITE. This module reads and refuses; it
// creates no ComplianceItem. A medical card decides whether a person may
// legally drive, and a compliance row that appeared because a model read a
// photograph — with nobody having looked at the date — is a compliance record
// this system cannot vouch for. `medicalCertProposal` is what a human confirms.
// ---------------------------------------------------------------------------

export type MedicalCertReadOutcome =
  | { ok: true; fields: ExtractedMedicalCert; cost: ReadCost }
  | {
      ok: false
      reason:
        | 'unsupported_type'
        | 'call_failed'
        | 'unparsable'
        | MedicalCertRefusal
      /**
       * What the attempt cost, or null when no engine was ever reached.
       *
       * The medical card refuses more often than the CDL by design — an
       * unreadable expiry is a refusal rather than a guess — so counting only
       * successful reads here would understate the true cost by more than it
       * does anywhere else in this system.
       */
      cost: ReadCost | null
    }

/** Nothing read, in the shape a read returns. */
export const NOTHING_READ: ExtractedMedicalCert = {
  expiresAt: null,
  issuedAt: null,
  examinerName: null,
  examinerRegistryNumber: null,
  driverName: null,
}

export async function readMedicalCert(input: {
  base64: string
  mimeType: string
  /** Named by an accuracy run, absent everywhere else. */
  model?: string
  apiKey?: string
  /**
   * The day this card arrived. Defaults to today.
   *
   * THE CLOCK IS READ HERE AND NOWHERE DEEPER. `refuseMedicalCert` is pure
   * arithmetic over dates so that it can be reasoned about and tested without
   * a fixed clock; one of its rules needs to know when the card turned up, and
   * this is the one place allowed to answer that. Injectable because a test
   * that has to wait for a real day to pass is not a test.
   */
  uploadedOn?: Date
}): Promise<MedicalCertReadOutcome> {
  let answer: AskResult
  try {
    answer = await askModel({
      base64: input.base64,
      mimeType: input.mimeType,
      system: MEDICAL_CERT_SYSTEM_WITH_SCHEMA,
      prompt:
        'Read this medical examiner’s certificate and return the JSON described.',
      // WHAT THIS IS, so the provider can be chosen per document type
      // (owner's ruling, 2026-09-12). The reader still picks no engine.
      kind: 'medical',
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

  let fields: ExtractedMedicalCert
  try {
    fields = parseMedicalCertResponse(answer.text)
  } catch {
    return { ok: false, reason: 'unparsable', cost }
  }

  const refusal = refuseMedicalCert(
    fields,
    (input.uploadedOn ?? new Date()).toISOString().slice(0, 10),
  )
  if (refusal) return { ok: false, reason: refusal, cost }

  return { ok: true, fields, cost }
}

/**
 * What the confirm step shows, and what a click would file.
 *
 * ── EVERYTHING A PERSON NEEDS TO SAY YES TO, AND NOTHING ELSE ─────────────
 *
 * `expiresAt` is the only value that becomes a row. The examiner is shown
 * because a certificate signed by nobody identifiable is worth a second look
 * before it is filed, and the name check is shown ONLY when it disagrees —
 * a warning that fires on every card is one people learn to dismiss.
 *
 * THE CONVERTED DATE AND THE PRINTED ONE TRAVEL TOGETHER. The screen shows
 * what the card says and what this system read it as, because those are two
 * different claims and the second is the one that gets stored.
 */
export interface MedicalCertProposal {
  /** ISO, converted by `parseMedDate` from what was printed. */
  expiresAt: string
  /** Exactly as the card prints it, beside the converted value. */
  expiresAtPrinted: string
  expiresAtConfidence: Confidence
  issuedAt: string | null
  issuedAtPrinted: string | null
  examinerName: string | null
  examinerRegistryNumber: string | null
  /** Present only when the printed name disagrees with the driver's. */
  nameDisagreement: { printed: string; expected: string } | null
  /**
   * The name as the card prints it, shown when the screen has to ASK.
   *
   * NOT STORED, and not the same thing as `nameDisagreement`. That one fires
   * when a chosen driver contradicts the card; this is what the card said,
   * displayed so a person picking from a list can see what they are matching
   * against instead of holding it in their head.
   */
  printedName: string | null
}

/**
 * Turn a read into the thing a human confirms.
 *
 * RETURNS NULL IF THE EXPIRY WILL NOT CONVERT, which cannot happen after
 * `refuseMedicalCert` has passed — it checks the same conversion. Written
 * anyway rather than asserted, because a proposal with no expiry has nothing
 * to file and the type should say so instead of carrying an empty string.
 */
export function medicalCertProposal(
  fields: ExtractedMedicalCert,
  driverName: string,
): MedicalCertProposal | null {
  const printed = fields.expiresAt?.value?.trim()
  if (!printed || !fields.expiresAt) return null

  const expires = parseMedDate(printed)
  if (!expires.ok) return null

  const issuedPrinted = fields.issuedAt?.value?.trim() ?? null
  const issued = issuedPrinted ? parseMedDate(issuedPrinted) : null

  const check: NameCheck = checkDriverName(fields, driverName)

  return {
    expiresAt: expires.iso,
    expiresAtPrinted: printed,
    expiresAtConfidence: fields.expiresAt.confidence,
    issuedAt: issued?.ok ? issued.iso : null,
    issuedAtPrinted: issuedPrinted,
    examinerName: fields.examinerName?.value?.trim() ?? null,
    examinerRegistryNumber:
      fields.examinerRegistryNumber?.value?.trim() ?? null,
    // SHOWN ONLY WHEN IT DISAGREES. `unknown` — the card printed no name — is
    // not a disagreement and must not render as one; there is nothing to
    // compare, and a warning on a blank is noise.
    nameDisagreement:
      check.agrees === false
        ? { printed: check.printed, expected: check.expected }
        : null,
    printedName: fields.driverName?.value?.trim() ?? null,
  }
}

export { refuseMedicalCert, checkDriverName }
export type { ExtractedMedicalCert, MedicalCertRefusal }

// ---------------------------------------------------------------------------
// PROPOSING A DRIVER FROM THE NAME ON THE CARD.
//
// ── THIS OVERTURNS AN EARLIER POSTURE, DELIBERATELY ───────────────────────
//
// `driverName` was read ONLY to be compared, and this module said in as many
// words that the reader identifies nobody. That was correct while the upload
// lived on a driver's own page: the page stated the subject, so matching a
// name could only ever add a way to get it wrong.
//
// The upload is now the front door — "add cert, then it reads the cert" — and
// nothing states the subject any more. A property that held because of where
// the control lived does not survive the control moving, and pretending
// otherwise would leave the comments asserting an invariant the code no longer
// has. So the name becomes the matching key, under conditions.
//
// ── EXACT, THEN ASK. NEVER NEAREST. ───────────────────────────────────────
//
// The roster is exactly the wrong shape for fuzzy matching. It holds
// near-duplicate names, and rows that are not people at all — `TJK logistic`,
// `7 Star`, `Said truck 3609`. A nearest-match over that set will eventually
// file a medical certificate against a company, and it will look like it
// worked.
//
// So the comparison is an EQUAL SET of name words, not a subset. That is
// stricter than `checkDriverName`, which stays loose on purpose — the two do
// different jobs. A loose WARNING that fires rarely is useful; a loose MATCH
// is a wrong driver chosen quietly. `ADNAN M GASHI` against a record of
// `Adnan Gashi` is a question, not an answer.
//
// NOTHING IS EVER FILED FROM THIS. It proposes; a person confirms. No match
// and several matches both mean the same thing — ask — and the caller falls
// back to a picker with the read values already in hand, so nothing is
// uploaded twice.
// ---------------------------------------------------------------------------

/** Name words, normalised for transcription noise and nothing else. */
function nameKey(text: string): string {
  return (
    text
      .toLowerCase()
      // Punctuation is how a card lays a name out — `SMITH, JOHN` — not part of
      // the name. Ordering is handled by sorting, for the same reason.
      .replace(/[.,]/g, ' ')
      .split(/\s+/)
      .filter((word) => word !== '')
      .sort()
      .join(' ')
  )
}

export interface DriverCandidate {
  id: string
  firstName: string
  lastName: string
}

export type DriverMatch =
  | { kind: 'one'; driver: DriverCandidate }
  | { kind: 'none' }
  | { kind: 'many'; drivers: DriverCandidate[] }

/**
 * Every driver whose name is exactly the one printed, ignoring order and
 * punctuation.
 *
 * `many` IS NOT A TIE TO BREAK. Two drivers with the same name is precisely
 * when a system must stop and ask; picking the first, or the most recently
 * hired, would be the machine resolving an ambiguity that belongs to whoever
 * knows which person handed over the card.
 */
export function matchDriverByName(
  printed: string | null | undefined,
  roster: readonly DriverCandidate[],
): DriverMatch {
  const key = nameKey(printed ?? '')
  if (key === '') return { kind: 'none' }

  const hits = roster.filter(
    (driver) => nameKey(`${driver.firstName} ${driver.lastName}`) === key,
  )
  if (hits.length === 1) return { kind: 'one', driver: hits[0]! }
  if (hits.length === 0) return { kind: 'none' }
  return { kind: 'many', drivers: hits }
}
