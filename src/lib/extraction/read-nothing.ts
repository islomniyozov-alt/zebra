// ---------------------------------------------------------------------------
// A COMPLETE ANSWER THAT SAYS NOTHING.
//
// ── THE MEASUREMENT THAT PUT THIS HERE ───────────────────────────────────
//
// On 2026-09-13 the 13-document rate-confirmation corpus was read by
// `deepseek-v4-flash-vision-exp`. It scored 0.0% on all 179 invoice-making
// fields — and it did not refuse, parse badly, truncate, or time out. It
// ANSWERED: valid JSON, conformant to the schema, every value null, `stops`
// empty. The accuracy runner recorded "13 of 13 read".
//
// Every defence this system has was satisfied. `parseResponseText` was happy,
// the envelope shape was right, the strict parser accepted it, and the
// per-reader refusal rules — which exist to catch a bad reading — saw nothing
// to object to, because there was nothing there to be wrong.
//
// ── WHY THE TOKENS ARE PART OF THE RULE AND THE FIELDS ARE NOT ENOUGH ────
//
// A genuinely blank page SHOULD return all nulls, and refusing that would be
// this system calling a correct answer a failure. What separates the two is
// the DOCUMENT: 491 input tokens per PDF against Gemini's 4,593 meant the file
// contributed nothing. We cannot see the provider's token accounting at the
// point of parsing, but we can see how big the thing we sent was — and a
// substantial document that yields not one readable value has not been read.
//
// SO THE RULE IS: nothing came back AND there was plainly something to read.
// ---------------------------------------------------------------------------

/**
 * The smallest base64 payload that is definitely a document with content.
 *
 * ~3KB of base64 is ~2.2KB of file. A one-page PDF of text is several times
 * that and a photograph is far more; a placeholder, an empty page or a stub is
 * below it. Deliberately generous — the cost of being wrong in this direction
 * is a refusal nobody wanted, and the cost in the other is one quiet empty
 * reading, which is what already happened.
 */
export const SUBSTANTIAL_BASE64_BYTES = 3_000

/**
 * Does this parsed reading contain a single value anybody could use?
 *
 * WALKS THE WHOLE SHAPE, because a reader's fields are envelopes
 * (`{ value, confidence }`), arrays of envelopes, or nested objects of them,
 * and every reader's shape differs. What they share is that a usable answer
 * has at least one `value` that is not null and not an empty string.
 *
 * ARRAYS COUNT ONLY WHEN THEY HOLD SOMETHING. `stops: []` is the empty answer's
 * signature, not a reading.
 */
export function hasAnyValue(fields: unknown): boolean {
  if (fields === null || fields === undefined) return false

  if (Array.isArray(fields)) {
    return fields.some((entry) => hasAnyValue(entry))
  }

  if (typeof fields === 'object') {
    const record = fields as Record<string, unknown>

    // An envelope: the leaf this whole walk is looking for.
    if ('value' in record) {
      const value = record.value
      if (value === null || value === undefined) return false
      if (typeof value === 'string') return value.trim() !== ''
      if (Array.isArray(value)) return value.length > 0
      return true
    }

    return Object.values(record).some((entry) => hasAnyValue(entry))
  }

  // A bare scalar, which some shapes use for booleans and counts.
  if (typeof fields === 'string') return fields.trim() !== ''
  return true
}

/**
 * Did the engine read nothing at all from a document that plainly had content?
 *
 * TRUE IS A REFUSAL, not a hint. The caller turns it into its own
 * `read_nothing` outcome so a person is told the document was not read —
 * rather than being handed an empty form and left to conclude the card was
 * blank.
 */
export function readNothing(input: {
  base64: string
  fields: unknown
}): boolean {
  if (input.base64.length < SUBSTANTIAL_BASE64_BYTES) return false
  return !hasAnyValue(input.fields)
}
