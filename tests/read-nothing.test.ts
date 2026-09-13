import { describe, expect, it } from 'vitest'
import {
  SUBSTANTIAL_BASE64_BYTES,
  hasAnyValue,
  readNothing,
} from '@/lib/extraction/read-nothing'

// ---------------------------------------------------------------------------
// THE ANSWER THAT PASSED EVERY DEFENCE THIS SYSTEM HAD.
//
// On 2026-09-13 the 13-document rate-confirmation corpus was read by
// `deepseek-v4-flash-vision-exp`: 0.0% on all 179 invoice-making fields, and
// not one refusal, parse error or timeout. Valid JSON, conformant to the
// schema, every value null, `stops: []`. The accuracy runner recorded "13 of
// 13 read" and `extractDocument` returned `ok: true` for every one.
//
// A complete empty answer is well-formed, so nothing downstream could object.
// ---------------------------------------------------------------------------

const big = 'A'.repeat(SUBSTANTIAL_BASE64_BYTES + 1)
const small = 'A'.repeat(100)

/** The shape the corpus actually came back in. */
const ALL_NULL = {
  brokerName: { value: null, confidence: 'low' },
  money: { totalCents: { value: null, confidence: 'low' } },
  stops: [],
}

describe('an answer with nothing in it', () => {
  it('is caught when the document plainly had content', () => {
    expect(readNothing({ base64: big, fields: ALL_NULL })).toBe(true)
  })

  it('is not claimed when a single value came back', () => {
    expect(
      readNothing({
        base64: big,
        fields: {
          ...ALL_NULL,
          brokerName: { value: 'WERNER', confidence: 'high' },
        },
      }),
    ).toBe(false)
  })

  // A GENUINELY BLANK PAGE SHOULD RETURN NULLS, and refusing that would be this
  // system calling a correct answer a failure. The document's size is what
  // separates the two.
  it('leaves a tiny document alone, however empty the answer', () => {
    expect(readNothing({ base64: small, fields: ALL_NULL })).toBe(false)
  })

  it('counts a value inside an array of envelopes', () => {
    expect(
      hasAnyValue({
        stops: [{ city: { value: 'DAYTON', confidence: 'high' } }],
      }),
    ).toBe(true)
    expect(
      hasAnyValue({ stops: [{ city: { value: null, confidence: 'low' } }] }),
    ).toBe(false)
  })

  it('does not count an empty string as a reading', () => {
    // A model that answers "" has told you as little as one that answers null,
    // and the corpus shows both shapes arrive.
    expect(hasAnyValue({ name: { value: '   ', confidence: 'high' } })).toBe(
      false,
    )
  })

  it('does not count an empty list as a reading', () => {
    // `stops: []` is the empty answer's signature.
    expect(hasAnyValue({ stops: [] })).toBe(false)
    expect(hasAnyValue({ codes: { value: [], confidence: 'high' } })).toBe(
      false,
    )
  })

  it('counts a boolean or a number, which are answers', () => {
    expect(
      hasAnyValue({ isHazmat: { value: false, confidence: 'high' } }),
    ).toBe(true)
    expect(hasAnyValue({ weightLbs: { value: 0, confidence: 'high' } })).toBe(
      true,
    )
  })
})
