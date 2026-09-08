import type { AskResult } from './claude'
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
  | { ok: true; fields: ExtractedMedicalCert }
  | {
      ok: false
      reason:
        | 'unsupported_type'
        | 'call_failed'
        | 'unparsable'
        | MedicalCertRefusal
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
}): Promise<MedicalCertReadOutcome> {
  let answer: AskResult
  try {
    answer = await askModel({
      base64: input.base64,
      mimeType: input.mimeType,
      system: MEDICAL_CERT_SYSTEM_WITH_SCHEMA,
      prompt:
        'Read this medical examiner’s certificate and return the JSON described.',
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
    return { ok: false, reason }
  }

  let fields: ExtractedMedicalCert
  try {
    fields = parseMedicalCertResponse(answer.text)
  } catch {
    return { ok: false, reason: 'unparsable' }
  }

  const refusal = refuseMedicalCert(fields)
  if (refusal) return { ok: false, reason: refusal }

  return { ok: true, fields }
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
  }
}

export { refuseMedicalCert, checkDriverName }
export type { ExtractedMedicalCert, MedicalCertRefusal }
