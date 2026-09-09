import { asString, readField, type Json } from './envelope-parse'
import { ExtractionParseError, parseResponseText } from './parse'
import type { ExtractedCoi } from './coi-shape'

// ---------------------------------------------------------------------------
// PARSING WHAT THE MODEL SAID ABOUT A CERTIFICATE OF INSURANCE.
//
// THE ENVELOPE READERS ARE THE CDL'S, from `envelope-parse.ts`. Nothing about
// reading `{value, confidence}` is document-specific, and a second copy would
// be a second set of rules about when a value counts as measured.
//
// EVERY FIELD IS A PLAIN STRING, INCLUDING THE DATES AND THE LIMITS. The dates
// arrive as the certificate prints them and `us-dates.ts` converts under a
// stated rule. The limits arrive as printed too — `money.ts` converts, and it
// refuses what it cannot read rather than guessing, which is the whole reason
// this contract does not ask the model for a number.
// ---------------------------------------------------------------------------

export function parseCoiResponse(text: string): ExtractedCoi {
  const root = parseResponseText(text) as Json

  if (typeof root !== 'object' || root === null || Array.isArray(root)) {
    throw new ExtractionParseError('not_an_object', '$')
  }

  return {
    policyNumber: readField(root, 'policyNumber', asString),
    insurer: readField(root, 'insurer', asString),
    effectiveAt: readField(root, 'effectiveAt', asString),
    expiresAt: readField(root, 'expiresAt', asString),
    liabilityLimit: readField(root, 'liabilityLimit', asString),
    cargoLimit: readField(root, 'cargoLimit', asString),
    insuredName: readField(root, 'insuredName', asString),
    insuredMc: readField(root, 'insuredMc', asString),
    insuredDot: readField(root, 'insuredDot', asString),
  }
}
