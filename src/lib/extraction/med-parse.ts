import { asString, readField, type Json } from './envelope-parse'
import { ExtractionParseError, parseResponseText } from './parse'
import type { ExtractedMedicalCert } from './med-shape'

// ---------------------------------------------------------------------------
// PARSING WHAT THE MODEL SAID ABOUT A MEDICAL CERTIFICATE.
//
// THE ENVELOPE READERS ARE THE CDL'S, from `envelope-parse.ts`. Nothing about
// reading `{value, confidence}` is document-specific, and a second copy would
// be a second set of rules about when a value counts as measured.
//
// EVERY FIELD IS A PLAIN STRING, INCLUDING THE DATES. They arrive as the card
// prints them and `med-dates.ts` converts under a stated rule — see the note
// there for why this contract does not ask the model for ISO the way the CDL's
// does.
// ---------------------------------------------------------------------------

export function parseMedicalCertResponse(text: string): ExtractedMedicalCert {
  const root = parseResponseText(text) as Json

  if (typeof root !== 'object' || root === null || Array.isArray(root)) {
    throw new ExtractionParseError('not_an_object', '$')
  }

  return {
    expiresAt: readField(root, 'expiresAt', asString),
    issuedAt: readField(root, 'issuedAt', asString),
    examinerName: readField(root, 'examinerName', asString),
    examinerRegistryNumber: readField(root, 'examinerRegistryNumber', asString),
    driverName: readField(root, 'driverName', asString),
  }
}
