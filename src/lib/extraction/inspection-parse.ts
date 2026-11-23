import { asString, readField, type Json } from './envelope-parse'
import { ExtractionParseError, parseResponseText } from './parse'
import type { ExtractedAnnualInspection } from './inspection-shape'

// Parsing what the model said about an annual inspection. The envelope readers
// are the CDL's and the medical card's (`envelope-parse.ts`): nothing about
// reading `{value, confidence}` is document-specific. Every field is a plain
// string, dates included — `inspection-fields.ts` converts and checks.

export function parseAnnualInspectionResponse(
  text: string,
): ExtractedAnnualInspection {
  const root = parseResponseText(text) as Json
  if (typeof root !== 'object' || root === null || Array.isArray(root)) {
    throw new ExtractionParseError('not_an_object', '$')
  }
  return {
    reportNumber: readField(root, 'reportNumber', asString),
    inspectionDate: readField(root, 'inspectionDate', asString),
    fleetUnit: readField(root, 'fleetUnit', asString),
    vin: readField(root, 'vin', asString),
    inspectorName: readField(root, 'inspectorName', asString),
    agency: readField(root, 'agency', asString),
    result: readField(root, 'result', asString),
  }
}
