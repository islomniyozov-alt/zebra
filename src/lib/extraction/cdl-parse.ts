import { CONFIDENCES, type Confidence, type Maybe } from './envelope'
import type { CodeReading, ExtractedCdl } from './cdl-shape'
import { ExtractionParseError, parseResponseText } from './parse'

// ---------------------------------------------------------------------------
// PARSING WHAT THE MODEL SAID ABOUT A LICENCE.
//
// `parse.ts`'s posture, applied to the other document: a response that does not
// parse is a FAILED READ, never a half-filled form. Every refusal below is a
// real shape a language model produces on a bad day — prose around the JSON, a
// bare string where `{value, confidence}` belongs, `"confidence": 0.9`, a class
// the enum does not have, a string where an array belongs.
//
// IT SHARES `ExtractionParseError` AND `parseResponseText` rather than
// declaring its own. The fence-stripping and the not_json/not_an_object
// refusals are facts about language models, not about rate confirmations, and
// two copies of them would be two things to keep in step.
//
// ── WRITTEN AND TESTED BEFORE THE FIRST LIVE CALL, DELIBERATELY ────────────
//
// Fixtures, not recordings. A model rarely produces its own error cases on
// demand: ask it for malformed JSON and it returns well-formed JSON about
// malformed JSON. If the parser is only ever exercised by live responses, its
// failure paths are the code nobody has seen run — and they are the entire
// reason it exists, because the success path is the one a bad response is
// least likely to take.
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>

/** A confidence, or a refusal. Shared by `readField` and `readCodeList`. */
const asConfidence = (value: unknown, at: string): Confidence => {
  if (typeof value !== 'string' || !CONFIDENCES.includes(value as Confidence)) {
    throw new ExtractionParseError('bad_confidence', at)
  }
  return value as Confidence
}

/** `{value, confidence}` or null. Anything else refuses rather than coerces. */
function readField<T>(
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
  const confidence = object['confidence']
  if (
    typeof confidence !== 'string' ||
    !CONFIDENCES.includes(confidence as Confidence)
  ) {
    throw new ExtractionParseError('bad_confidence', `$.${key}`)
  }

  const value = check(object['value'], `$.${key}`)
  const note = object['note']

  return {
    value,
    confidence: confidence as Confidence,
    ...(typeof note === 'string' && note !== '' ? { note } : {}),
  }
}

const asString = (value: unknown, at: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ExtractionParseError('bad_value_type', at)
  }
  return value.trim()
}

const asBoolean = (value: unknown, at: string): boolean => {
  // A BOOLEAN, not "true". `isTemporary` decides whether a paper credential is
  // filed as a four-year licence, and a truthy string would make every
  // response temporary — including `"false"`.
  if (typeof value !== 'boolean') {
    throw new ExtractionParseError('bad_value_type', at)
  }
  return value
}

/**
 * A list of code envelopes, read straight off the response.
 *
 * NOT `readField`, BECAUSE THE ARRAY IS NOT WRAPPED. The confidence lives on
 * each element rather than around the list — see `cdl-shape.ts` for the ten
 * runs that forced it — so this is an array of `{value, confidence}` and not a
 * `Field<string[]>`.
 *
 * AN ARRAY, EVEN FOR ONE CODE. A model that returns `"H"` where `[...]`
 * belongs has decided the shape for us, and the next response with two
 * endorsements would arrive as `"H, N"` — a string this system would then have
 * to guess how to split.
 */
const readCodeList = (parent: Json, key: string): CodeReading[] | null => {
  const at = `$.${key}`
  if (!(key in parent)) throw new ExtractionParseError('missing_field', at)
  const raw = parent[key]
  if (raw === null) return null
  if (!Array.isArray(raw)) throw new ExtractionParseError('bad_value_type', at)

  return raw.map((entry, index) => {
    const where = `${at}[${index}]`
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      // A BARE STRING IS THE OLD SHAPE. Refused rather than promoted into an
      // envelope with a confidence nobody stated: inventing `high` here is the
      // exact failure the per-element change exists to end.
      throw new ExtractionParseError('bad_field_shape', where)
    }
    const record = entry as Json
    if (!('value' in record) || !('confidence' in record)) {
      throw new ExtractionParseError('bad_field_shape', where)
    }
    // `value: null` IS LEGITIMATE AND LOAD-BEARING: a code is printed here and
    // could not be read. Anything other than a string or null is a shape error.
    const value =
      record['value'] === null ? null : asString(record['value'], where)
    return { value, confidence: asConfidence(record['confidence'], where) }
  })
}

/**
 * A licence, from the model's reply.
 *
 * Every field is REQUIRED to be present, and `null` is how the model says a
 * field was not on the card. A missing key is a response that did not answer
 * the question asked, which is different from a card that did not carry the
 * field — and only the second is a legitimate reading.
 */
export function parseCdlResponse(text: string): ExtractedCdl {
  const root = parseResponseText(text) as Json

  return {
    licenceNumber: readField(root, 'licenceNumber', asString),
    expiresAt: readField(root, 'expiresAt', asString),
    issuedAt: readField(root, 'issuedAt', asString),
    // A PLAIN STRING. `asClass` used to live here and check the value against
    // ['A','B','C'] — the THIRD copy of that list, after the JSON Schema and
    // the prompt. All three said the same thing, which is why a Georgia card
    // printing AM never reached any of them: the model resolved the conflict
    // upstream by returning A at high confidence.
    //
    // The class is transcribed here and interpreted by CLASS_MAP in
    // cdl-class.ts, where an unrecognised one refuses by name and says what it
    // read. `bad_enum` remains in the error vocabulary — nothing else uses it
    // today, and it is the right refusal the day a genuinely closed list
    // arrives from a standard rather than from our own convenience.
    class: readField(root, 'class', asString),
    familyName: readField(root, 'familyName', asString),
    givenName: readField(root, 'givenName', asString),
    state: readField(root, 'state', asString),
    addressLine1: readField(root, 'addressLine1', asString),
    addressCity: readField(root, 'addressCity', asString),
    addressPostalCode: readField(root, 'addressPostalCode', asString),
    addressStateCode: readField(root, 'addressStateCode', asString),
    restrictions: readCodeList(root, 'restrictions'),
    endorsements: readCodeList(root, 'endorsements'),
    isTemporary: readField(root, 'isTemporary', asBoolean),
  }
}
