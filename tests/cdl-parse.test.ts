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
  addressLine1: { value: '394 AMBROSE CREEK DR', confidence: 'high' },
  addressCity: { value: 'SUGARHILL', confidence: 'high' },
  addressPostalCode: { value: '30518-7869', confidence: 'high' },
  addressStateCode: { value: 'FL', confidence: 'high' },
  restrictions: [],
  endorsements: [{ value: 'N', confidence: 'medium' }],
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
    expect(card.endorsements).toEqual([{ value: 'N', confidence: 'medium' }])
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
      addressLine1: '394 AMBROSE CREEK DR',
      addressCity: 'SUGARHILL',
      addressState: 'FL',
      addressPostalCode: '30518-7869',
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

  it('no longer refuses a class at the parser — it is a free string now', () => {
    // THE ENUM IS GONE ON PURPOSE. It used to be ['A','B','C'] here and in the
    // schema the model is handed, and a Georgia card printing AM came back as
    // A at high confidence — the model made the answer one of three because it
    // was told there were three. `bad_enum` could not fire because the value
    // that would trip it never survived. The judgement moved to CLASS_MAP,
    // where it acts on what the card actually said.
    expect(
      refusalOf(withField('class', { value: 'AM', confidence: 'high' })),
    ).toBe(null)
    expect(
      parseCdlResponse(withField('class', { value: 'AM', confidence: 'high' }))
        .class?.value,
    ).toBe('AM')
  })

  it('still refuses a class that is not a string at all', () => {
    // Dropping the enum must not drop the TYPE check with it.
    expect(
      refusalOf(withField('class', { value: 3, confidence: 'high' })),
    ).toBe('bad_value_type')
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

describe('the address, which is read now and was not before', () => {
  // IT IS HERE BECAUSE SOMETHING READS IT, not because it is printed. The
  // exclusion list is unchanged for DOB, sex, height, weight and eye colour —
  // still nothing consumes those, so they are still absent from the contract.

  it('transcribes the three printed parts without reformatting them', () => {
    const card = parseCdlResponse(GOOD)
    expect(card.addressLine1?.value).toBe('394 AMBROSE CREEK DR')
    expect(card.addressCity?.value).toBe('SUGARHILL')
    // A ZIP+4 STAYS A ZIP+4. Trimming it to five would be the parser deciding
    // the card is more precise than it needs to be.
    expect(card.addressPostalCode?.value).toBe('30518-7869')
  })

  it('keeps the stored state and the cross-check state as separate readings', () => {
    // THEY AGREE ON ALMOST EVERY CARD, which is exactly why this is asserted.
    // `addressStateCode` exists to be compared against the header and is then
    // discarded; `addressState` is what gets written to the driver. A future
    // edit that collapsed them would make the cross-check read a value a
    // dispatcher can edit on the confirm form.
    const card = parseCdlResponse(GOOD)
    expect(card.addressStateCode?.value).toBe('FL')
    expect(cdlPrefill(card).addressState).toBe('FL')
    // The shape has no `addressState`; the stored one is derived at prefill.
    expect('addressState' in card).toBe(false)
  })

  it('still refuses a card whose two state readings disagree', () => {
    // The address being stored must not have weakened the check that made it
    // trustworthy in the first place.
    expect(
      refuseCdl(
        parseCdlResponse(
          withField('addressStateCode', { value: 'GA', confidence: 'high' }),
        ),
      ),
    ).toBe('state_disagrees')
  })

  it('leaves the address out of the prefill when the card did not yield it', () => {
    const card = parseCdlResponse(withField('addressLine1', null))
    expect(refuseCdl(card)).toBeNull()
    expect(cdlPrefill(card).addressLine1).toBeUndefined()
    // A missing street is not a missing licence: the spine is unaffected.
    expect(cdlPrefill(card).cdlNumber).toBe('N520-400-84-123-0')
  })
})

describe('the printed class, and what it means operationally', () => {
  // THE FAILURE THIS REPLACED, IN ONE SENTENCE: a Georgia card printing
  // `CLASS AM` was returned by the model as `"A"`, confidence high, because
  // the schema and the prompt both told it the answer was one of A, B or C.
  // Nothing refused. The class is transcribed now and judged here.

  it('maps the qualifier classes the table names', () => {
    for (const [printed, operational] of [
      ['A', 'A'],
      ['B', 'B'],
      ['C', 'C'],
      ['AM', 'A'],
      ['BM', 'B'],
      ['CM', 'C'],
    ] as const) {
      const card = parseCdlResponse(
        withField('class', { value: printed, confidence: 'high' }),
      )
      expect(refuseCdl(card), printed).toBeNull()
      expect(cdlPrefill(card).cdlClass, printed).toBe(operational)
      // AND THE CARD'S OWN TEXT SURVIVES BESIDE THE MAPPED VALUE.
      expect(cdlNotes(card).classPrinted, printed).toBe(printed)
    }
  })

  it('refuses a printed class the table does not know, rather than reducing it', () => {
    // The refusal that was unreachable while the enum stood. `AX` is not in
    // CLASS_MAP; a prefix rule would happily call it A, which is the same
    // silent conformance moved from the model into our code.
    for (const printed of ['AX', 'D', 'A1', 'MA', 'CLASS A']) {
      const card = parseCdlResponse(
        withField('class', { value: printed, confidence: 'high' }),
      )
      expect(refuseCdl(card), printed).toBe('unknown_class')
    }
  })

  it('tolerates transcription noise but never changes the letters', () => {
    // Case and space are how a character was typed, not what it is.
    const noisy = parseCdlResponse(
      withField('class', { value: ' am ', confidence: 'high' }),
    )
    expect(refuseCdl(noisy)).toBeNull()
    expect(cdlPrefill(noisy).cdlClass).toBe('A')
    expect(cdlNotes(noisy).classPrinted).toBe('am')
  })

  it('lets a card with no class through, because the class is not the spine', () => {
    // The spine is the licence number and the expiry. A missing class is a
    // blank on the confirm form; an UNREADABLE one is a refusal. Different.
    const card = parseCdlResponse(withField('class', null))
    expect(refuseCdl(card)).toBeNull()
    expect(cdlPrefill(card).cdlClass).toBeUndefined()
    expect(cdlNotes(card).classPrinted).toBeNull()
  })
})

describe('NONE, which is not a code', () => {
  const code = (value: string | null, confidence = 'high') => ({
    value,
    confidence,
  })

  it('reads NONE as no endorsements at all', () => {
    const card = parseCdlResponse(withField('endorsements', [code('NONE')]))
    // It PARSES — NONE is a legitimate string on the card — and becomes an
    // empty list where the form is told about it. Carried through it would
    // read, on a compliance screen, as a driver holding something.
    expect(card.endorsements).toEqual([{ value: 'NONE', confidence: 'high' }])
    expect(cdlNotes(card).endorsements).toEqual([])
  })

  it('keeps real codes beside it', () => {
    const card = parseCdlResponse(
      withField('endorsements', [code('H'), code('NONE'), code('n')]),
    )
    expect(cdlNotes(card).endorsements).toEqual([
      { code: 'H', confidence: 'high', recognised: true },
      { code: 'N', confidence: 'high', recognised: true },
    ])
  })
})

describe('a code list that is not a list of envelopes', () => {
  const codes = (value: unknown) => withField('endorsements', value)

  it('refuses a bare string where an envelope belongs', () => {
    // THE OLD SHAPE, REFUSED RATHER THAN PROMOTED. Wrapping `"H"` into
    // `{value:"H", confidence:"high"}` would invent a certainty nobody stated,
    // which is the exact failure per-element confidence exists to end.
    expect(refusalOf(codes(['H']))).toBe('bad_field_shape')
  })

  it('refuses an envelope with no confidence', () => {
    expect(refusalOf(codes([{ value: 'H' }]))).toBe('bad_field_shape')
  })

  it('refuses a confidence outside the three buckets', () => {
    expect(refusalOf(codes([{ value: 'H', confidence: 0.9 }]))).toBe(
      'bad_confidence',
    )
  })

  it('refuses a string where the whole list belongs', () => {
    expect(refusalOf(codes('H, N'))).toBe('bad_value_type')
  })

  it('accepts null as the whole list, meaning the field was not read', () => {
    const card = parseCdlResponse(codes(null))
    expect(card.endorsements).toBeNull()
    expect(cdlNotes(card).endorsements).toEqual([])
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
