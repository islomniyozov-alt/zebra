import { CONFIDENCES, type Confidence, type Maybe } from './envelope'
import { ExtractionParseError } from './parse'

// ---------------------------------------------------------------------------
// READING A `{value, confidence}` ENVELOPE OFF A MODEL'S REPLY.
//
// SHARED, FOR THE SAME REASON `envelope.ts` IS. The envelope is the shape
// every document type uses, so the code that reads one belongs beside the type
// rather than inside whichever document happened to need it first. These lived
// in `cdl-parse.ts` until the medical certificate arrived and would otherwise
// have been copied — and two copies of a parser are one parser and one bug
// waiting, on the layer that decides whether a value was measured or invented.
//
// EVERY FUNCTION HERE REFUSES RATHER THAN COERCES. That posture is the whole
// point of the envelope: a bare value promoted into `{value, confidence:
// 'high'}` is an invented certainty, and an invented one is indistinguishable
// from a measured one by the time the refusal rules weigh it.
// ---------------------------------------------------------------------------

export type Json = Record<string, unknown>

/** A confidence, or a refusal. Never a default. */
export const asConfidence = (value: unknown, at: string): Confidence => {
  if (typeof value !== 'string' || !CONFIDENCES.includes(value as Confidence)) {
    throw new ExtractionParseError('bad_confidence', at)
  }
  return value as Confidence
}

/** Non-empty text, or a refusal. */
export const asString = (value: unknown, at: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ExtractionParseError('bad_value_type', at)
  }
  return value.trim()
}

/**
 * `{value, confidence}` or null. Anything else refuses.
 *
 * A MISSING KEY IS NOT A NULL VALUE. `null` is the model saying the document
 * did not carry the field; an absent key is the model not answering the
 * question asked, and only the first is a legitimate reading.
 */
export function readField<T>(
  parent: Json,
  key: string,
  check: (value: unknown, at: string) => T,
): Maybe<T> {
  if (!Object.hasOwn(parent, key)) {
    throw new ExtractionParseError('missing_field', `$.${key}`)
  }

  const raw = parent[key]
  if (raw === null || raw === undefined) return null

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    // A bare `"WDL9911234"` where the envelope belongs. Accepting it means
    // inventing a confidence, and an invented confidence is indistinguishable
    // from a measured one — which the refusal rules then weigh.
    throw new ExtractionParseError('bad_field_shape', `$.${key}`)
  }

  const object = raw as Json
  const confidence = asConfidence(object['confidence'], `$.${key}`)
  const value = check(object['value'], `$.${key}`)
  const note = object['note']

  return {
    value,
    confidence,
    ...(typeof note === 'string' && note !== '' ? { note } : {}),
  }
}
