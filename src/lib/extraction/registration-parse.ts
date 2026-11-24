import { asString, readField, type Json } from './envelope-parse'
import { ExtractionParseError, parseResponseText } from './parse'
import type { ExtractedRegistration } from './registration-shape'

// Parsing what the model said about a registration. The envelope readers are
// the CDL's, the medical card's and the inspection's (`envelope-parse.ts`).
// Every field is a plain string — `registration-fields.ts` converts and checks.

export function parseRegistrationResponse(text: string): ExtractedRegistration {
  const root = parseResponseText(text) as Json
  if (typeof root !== 'object' || root === null || Array.isArray(root)) {
    throw new ExtractionParseError('not_an_object', '$')
  }
  return {
    vin: readField(root, 'vin', asString),
    plate: readField(root, 'plate', asString),
    plateState: readField(root, 'plateState', asString),
    expiresAt: readField(root, 'expiresAt', asString),
    year: readField(root, 'year', asString),
    make: readField(root, 'make', asString),
    model: readField(root, 'model', asString),
    ownerName: readField(root, 'ownerName', asString),
    gvwr: readField(root, 'gvwr', asString),
  }
}
