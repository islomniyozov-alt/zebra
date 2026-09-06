import { describe, expect, it } from 'vitest'
import { parseCdlResponse } from '@/lib/extraction/cdl-parse'
import { ExtractionParseError } from '@/lib/extraction/parse'
import { refuseCdl } from '@/lib/extraction/cdl-refusal'
import { cdlNotes, cdlPrefill } from '@/lib/cdl'

// ---------------------------------------------------------------------------
// THE PARSER AND THE REFUSAL RULES, DRIVEN BY HAND-WRITTEN RESPONSES.
//
// WRITTEN BEFORE THE FIRST LIVE CALL, and that ordering is the point. A model
// rarely produces its own error cases on demand — ask for malformed JSON and
// you get well-formed JSON about malformed JSON — so a parser exercised only
// by live responses has never run the code that exists for bad ones. These
// cost nothing, are deterministic, and cover the paths a recording cannot.
//
// Every fixture is a shape a language model actually produces: a fenced block,
// prose around the JSON, a numeric confidence, a bare value where the envelope
// belongs, one code where an array belongs.
// ---------------------------------------------------------------------------

const GOOD = JSON.stringify({
  licenceNumber: { value: 'N520-400-84-123-0', confidence: 'high' },
  expiresAt: { value: '2029-04-14', confidence: 'high' },
  issuedAt: { value: '2025-04-14', confidence: 'high' },
  class: { value: 'A', confidence: 'high' },
  familyName: { value: 'NIYOZOV', confidence: 'high' },
  givenName: { value: 'ISLOM', confidence: 'high' },
  state: { value: 'FL', confidence: 'high' },
  addressStateCode: { value: 'FL', confidence: 'high' },
  restrictions: { value: [], confidence: 'high' },
  endorsements: { value: ['N'], confidence: 'medium' },
  isTemporary: { value: false, confidence: 'high' },
})

/** The good response with one field replaced, or removed when undefined. */
const withField = (key: string, replacement: unknown) => {
  const parsed = JSON.parse(GOOD) as Record<string, unknown>
  if (replacement === undefined) delete parsed[key]
  else parsed[key] = replacement
  return JSON.stringify(parsed)
}

/** What the parser refused, or null when it did not refuse. */
const refusalOf = (text: string): string | null => {
  try {
    parseCdlResponse(text)
    return null
  } catch (error) {
    if (error instanceof ExtractionParseError) return error.reason
    throw error
  }
}

const FENCE = '```'

describe('a well-formed licence response', () => {
  it('parses every field', () => {
    const card = parseCdlResponse(GOOD)
    expect(card.licenceNumber).toEqual({
      value: 'N520-400-84-123-0',
      confidence: 'high',
    })
    expect(card.class?.value).toBe('A')
    expect(card.isTemporary?.value).toBe(false)
    expect(card.endorsements?.value).toEqual(['N'])
  })

  it('passes the refusal rules and prefills the form', () => {
    const card = parseCdlResponse(GOOD)
    expect(refuseCdl(card)).toBeNull()
    expect(cdlPrefill(card)).toEqual({
      lastName: 'NIYOZOV',
      firstName: 'ISLOM',
      cdlNumber: 'N520-400-84-123-0',
      cdlState: 'FL',
      cdlClass: 'A',
      cdlExpiresAt: '2029-04-14',
    })
  })

  it('survives a fenced block and surrounding prose', () => {
    const text = [
      'Here is the licence:',
      FENCE + 'json',
      GOOD,
      FENCE,
      'Anything else?',
    ].join('\n')
    expect(parseCdlResponse(text).licenceNumber?.value).toBe(
      'N520-400-84-123-0',
    )
  })
})

describe('responses that are not a reading', () => {
  it('refuses malformed JSON', () => {
    expect(refusalOf('{ "licenceNumber": ')).toBe('not_json')
    expect(refusalOf('nope')).toBe('not_json')
  })

  it('refuses an array or a bare string where the object belongs', () => {
    expect(refusalOf('[]')).toBe('not_an_object')
    expect(refusalOf('"a licence"')).toBe('not_an_object')
  })

  it('refuses a response missing a key entirely', () => {
    // Absent is not null. `null` says the card did not carry the field; a
    // missing key says the model did not answer the question asked.
    expect(refusalOf(withField('expiresAt', undefined))).toBe('missing_field')
  })

  it('refuses a bare value where the envelope belongs', () => {
    expect(refusalOf(withField('licenceNumber', 'N520-400-84-123-0'))).toBe(
      'bad_field_shape',
    )
  })

  it('refuses a numeric confidence', () => {
    expect(
      refusalOf(withField('licenceNumber', { value: 'X', confidence: 0.82 })),
    ).toBe('bad_confidence')
  })

  it('refuses a class the card cannot grant', () => {
    expect(
      refusalOf(withField('class', { value: 'D', confidence: 'high' })),
    ).toBe('bad_enum')
  })

  it('refuses one code where an array belongs', () => {
    // "H" today is "H, N" tomorrow — a string this system would then have to
    // guess how to split.
    expect(
      refusalOf(withField('endorsements', { value: 'H', confidence: 'high' })),
    ).toBe('bad_value_type')
  })

  it('refuses a string where isTemporary must be a boolean', () => {
    // "false" is truthy. Every response would be a temporary credential.
    expect(
      refusalOf(
        withField('isTemporary', { value: 'false', confidence: 'high' }),
      ),
    ).toBe('bad_value_type')
  })
})

describe('responses that parse but are not a licence read', () => {
  it('refuses when the spine is missing', () => {
    expect(refuseCdl(parseCdlResponse(withField('licenceNumber', null)))).toBe(
      'no_licence_number',
    )
  })

  it('refuses a low-confidence spine even though the value is there', () => {
    expect(
      refuseCdl(
        parseCdlResponse(
          withField('expiresAt', { value: '2029-04-14', confidence: 'low' }),
        ),
      ),
    ).toBe('low_confidence_spine')
  })

  it('refuses a header state that disagrees with the address', () => {
    // Two named fields, compared. The old check searched a free-text note for
    // two capitals and the first real card returned a note of exactly "FL" —
    // so it passed by finding the value it was meant to test against.
    expect(
      refuseCdl(
        parseCdlResponse(
          withField('addressStateCode', { value: 'GA', confidence: 'high' }),
        ),
      ),
    ).toBe('state_disagrees')
  })

  it('refuses when the address carries no state to check against', () => {
    // NO SECOND READING IS NOT AGREEMENT. Without it the state is a single
    // unverified claim, and it is named apart from a disagreement because the
    // two tell a dispatcher different things.
    expect(
      refuseCdl(parseCdlResponse(withField('addressStateCode', null))),
    ).toBe('no_address_state')
  })

  it('refuses an expiry before its issue date', () => {
    expect(
      refuseCdl(
        parseCdlResponse(
          withField('issuedAt', { value: '2030-01-01', confidence: 'high' }),
        ),
      ),
    ).toBe('expiry_before_issue')
  })
})

describe('NONE, which is not a code', () => {
  it('reads NONE as no endorsements at all', () => {
    const card = parseCdlResponse(
      withField('endorsements', { value: ['NONE'], confidence: 'high' }),
    )
    // It PARSES — NONE is a legitimate string on the card — and becomes an
    // empty list where the form is told about it. Carried through it would
    // read, on a compliance screen, as a driver holding something.
    expect(card.endorsements?.value).toEqual(['NONE'])
    expect(cdlNotes(card).endorsements).toEqual([])
  })

  it('keeps real codes beside it', () => {
    const card = parseCdlResponse(
      withField('endorsements', {
        value: ['H', 'NONE', 'n'],
        confidence: 'high',
      }),
    )
    expect(cdlNotes(card).endorsements).toEqual(['H', 'N'])
  })
})

describe('a temporary credential', () => {
  it('is surfaced rather than filed as a full licence', () => {
    const card = parseCdlResponse(
      withField('isTemporary', { value: true, confidence: 'high' }),
    )
    expect(refuseCdl(card)).toBeNull()
    expect(cdlNotes(card).isTemporary).toBe(true)
  })
})
