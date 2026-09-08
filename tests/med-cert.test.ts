import { describe, expect, it } from 'vitest'
import { parseMedicalCertResponse } from '@/lib/extraction/med-parse'
import { ExtractionParseError } from '@/lib/extraction/parse'
import {
  checkDriverName,
  refuseMedicalCert,
} from '@/lib/extraction/med-refusal'
import { parseMedDate } from '@/lib/extraction/med-dates'
import { matchDriverByName, medicalCertProposal } from '@/lib/med-cert'
import {
  MEDICAL_CERT_FIELDS,
  MEDICAL_CERT_FORBIDDEN_FIELDS,
  MEDICAL_CERT_SCHEMA,
  type ExtractedMedicalCert,
} from '@/lib/extraction/med-shape'
import { MEDICAL_CERT_SYSTEM } from '@/lib/extraction/med-prompt'

// ---------------------------------------------------------------------------
// THE DOT MEDICAL EXAMINER'S CERTIFICATE CONTRACT.
//
// WRITTEN BEFORE ANY CARD HAS BEEN READ, which is the same ordering the CDL
// parser used and for the same reason: a model rarely produces its own error
// cases on demand, so a parser exercised only by live responses has never run
// the code that exists for bad ones.
// ---------------------------------------------------------------------------

const GOOD = JSON.stringify({
  expiresAt: { value: '03/04/2027', confidence: 'high' },
  issuedAt: { value: '03/04/2025', confidence: 'high' },
  examinerName: { value: 'DANA R OKONKWO, DO', confidence: 'high' },
  examinerRegistryNumber: { value: '1234567890', confidence: 'high' },
  driverName: { value: 'ADNAN GASHI', confidence: 'high' },
})

const withField = (key: string, replacement: unknown) => {
  const parsed = JSON.parse(GOOD) as Record<string, unknown>
  if (replacement === undefined) delete parsed[key]
  else parsed[key] = replacement
  return JSON.stringify(parsed)
}

const refusalOf = (text: string): string | null => {
  try {
    parseMedicalCertResponse(text)
    return null
  } catch (error) {
    if (error instanceof ExtractionParseError) return error.reason
    throw error
  }
}

describe('a well-formed certificate', () => {
  it('parses the four stored fields and the compared one', () => {
    const card = parseMedicalCertResponse(GOOD)
    expect(card.expiresAt?.value).toBe('03/04/2027')
    expect(card.issuedAt?.value).toBe('03/04/2025')
    expect(card.examinerName?.value).toBe('DANA R OKONKWO, DO')
    expect(card.examinerRegistryNumber?.value).toBe('1234567890')
    expect(card.driverName?.value).toBe('ADNAN GASHI')
    expect(refuseMedicalCert(card)).toBeNull()
  })

  it('keeps the dates exactly as printed, unconverted', () => {
    // THE DEPARTURE FROM THE CDL. Asking a model for ISO makes it resolve an
    // ambiguous date and throws the card's own text away; here the printed
    // string survives into the contract and `parseMedDate` states the rule.
    expect(parseMedicalCertResponse(GOOD).expiresAt?.value).not.toContain('-')
  })
})

// ---------------------------------------------------------------------------
// THE EXCLUSIONS, ASSERTED AGAINST THE CONTRACT AND NOT ONLY THE PROMPT.
//
// The prompt refuses medical information in words, and a prompt is an
// instruction to something that may not follow it. A schema with no such key,
// and a type with no such field, is a shape that cannot carry the value even
// if a model volunteers one — the treatment date of birth got on the CDL.
// ---------------------------------------------------------------------------
describe('medical information is absent from the contract, not just the prompt', () => {
  it('has exactly five fields and no others', () => {
    expect([...MEDICAL_CERT_FIELDS].sort()).toEqual([
      'driverName',
      'examinerName',
      'examinerRegistryNumber',
      'expiresAt',
      'issuedAt',
    ])
  })

  it('names no forbidden field in the schema', () => {
    const keys = Object.keys(MEDICAL_CERT_SCHEMA.properties).map((k) =>
      k.toLowerCase(),
    )
    for (const forbidden of MEDICAL_CERT_FORBIDDEN_FIELDS) {
      expect(keys, forbidden).not.toContain(forbidden.toLowerCase())
    }
  })

  it('names no forbidden field in the TypeScript shape either', () => {
    // The type and the schema are written out separately on purpose, so both
    // have to be checked — a field could be added to one alone.
    const shape: Record<keyof ExtractedMedicalCert, true> = {
      expiresAt: true,
      issuedAt: true,
      examinerName: true,
      examinerRegistryNumber: true,
      driverName: true,
    }
    const keys = Object.keys(shape)
    const lowered = keys.map((k) => k.toLowerCase())
    for (const forbidden of MEDICAL_CERT_FORBIDDEN_FIELDS) {
      expect(lowered, forbidden).not.toContain(forbidden.toLowerCase())
    }
    // AND THE TYPE MATCHES THE SCHEMA. The two are written out separately, so
    // this is what stops one growing a field the other never heard of.
    expect(keys.sort()).toEqual([...MEDICAL_CERT_FIELDS].sort())
  })

  it('refuses the volunteered extra field rather than carrying it', () => {
    // `additionalProperties: false` is the schema half; this is the parser
    // half. A model that returns a blood pressure gets it dropped on the
    // floor, not stored in a field nobody declared.
    const card = parseMedicalCertResponse(
      withField('bloodPressure', { value: '120/80', confidence: 'high' }),
    )
    expect(Object.keys(card).sort()).toEqual([...MEDICAL_CERT_FIELDS].sort())
    expect(JSON.stringify(card)).not.toContain('120/80')
  })

  it('tells the model no, by name, for every category', () => {
    const prompt = MEDICAL_CERT_SYSTEM.toLowerCase()
    for (const phrase of [
      'determination',
      'restrictions',
      'qualifiers',
      'exemption',
      'skill performance',
      'blood pressure',
      'date of birth',
      'corrective lenses',
      'hearing aid',
    ]) {
      expect(prompt, phrase).toContain(phrase)
    }
  })

  it('says the schema forbids extra keys', () => {
    expect(MEDICAL_CERT_SCHEMA.additionalProperties).toBe(false)
  })
})

describe('dates, converted here rather than by the model', () => {
  it('reads the federal form as month-first', () => {
    // STATED, NOT INFERRED. `03/04/2027` gives no clue on its own; the
    // assumption is about the DOCUMENT — a US federal form — which is what
    // makes it safe to write down.
    expect(parseMedDate('03/04/2027')).toEqual({ ok: true, iso: '2027-03-04' })
    expect(parseMedDate('12/31/2026')).toEqual({ ok: true, iso: '2026-12-31' })
  })

  it('accepts the other two shapes the form is printed in', () => {
    expect(parseMedDate('2027-03-04')).toEqual({ ok: true, iso: '2027-03-04' })
    expect(parseMedDate('Mar 4, 2027')).toEqual({ ok: true, iso: '2027-03-04' })
    expect(parseMedDate('March 04, 2027')).toEqual({
      ok: true,
      iso: '2027-03-04',
    })
  })

  it('refuses a date that does not exist', () => {
    expect(parseMedDate('02/30/2027').ok).toBe(false)
    expect(parseMedDate('13/01/2027').ok).toBe(false)
    expect(parseMedDate('Feb 29, 2027').ok).toBe(false)
    // And accepts the leap day that does.
    expect(parseMedDate('Feb 29, 2028')).toEqual({
      ok: true,
      iso: '2028-02-29',
    })
  })

  it('refuses a shape nobody stated rather than guessing at it', () => {
    for (const raw of ['', '04-03-2027', '3/4/27', 'next March', '20270304']) {
      expect(parseMedDate(raw).ok, raw).toBe(false)
    }
  })

  it('gives the same day whatever the machine thinks the time zone is', () => {
    // `new Date('03/04/2027')` is midnight LOCAL, so its ISO slice is the 3rd
    // anywhere west of Greenwich. This is text and arithmetic.
    const parsed = parseMedDate('03/04/2027')
    expect(parsed).toEqual({ ok: true, iso: '2027-03-04' })
  })
})

describe('when a certificate was not read', () => {
  it('refuses without an expiry — the only field that feeds an alarm', () => {
    expect(
      refuseMedicalCert(parseMedicalCertResponse(withField('expiresAt', null))),
    ).toBe('no_expiry')
  })

  it('refuses a low-confidence expiry even though the value is there', () => {
    expect(
      refuseMedicalCert(
        parseMedicalCertResponse(
          withField('expiresAt', { value: '03/04/2027', confidence: 'low' }),
        ),
      ),
    ).toBe('low_confidence_expiry')
  })

  it('refuses an expiry it cannot convert', () => {
    expect(
      refuseMedicalCert(
        parseMedicalCertResponse(
          withField('expiresAt', { value: 'next spring', confidence: 'high' }),
        ),
      ),
    ).toBe('unreadable_expiry')
  })

  it('refuses an unreadable issue date rather than dropping it', () => {
    // It is the only thing bounding the expiry, so losing it quietly would
    // remove the two checks below without anybody deciding to.
    expect(
      refuseMedicalCert(
        parseMedicalCertResponse(
          withField('issuedAt', { value: 'last year', confidence: 'high' }),
        ),
      ),
    ).toBe('unreadable_issue')
  })

  it('refuses an expiry before its examination', () => {
    expect(
      refuseMedicalCert(
        parseMedicalCertResponse(
          withField('issuedAt', { value: '03/04/2029', confidence: 'high' }),
        ),
      ),
    ).toBe('expiry_before_issue')
  })

  it('refuses a validity period no certificate can have', () => {
    // 49 CFR 391.43(f) caps it at two years, so a ten-year span is a misread
    // digit — most likely the year.
    expect(
      refuseMedicalCert(
        parseMedicalCertResponse(
          withField('expiresAt', { value: '03/04/2035', confidence: 'high' }),
        ),
      ),
    ).toBe('implausible_validity')
  })

  it('accepts the ordinary two-year certificate, and a shortened one', () => {
    // THE GENEROUS SIDE OF THE BOUND. A rule that refused valid documents to
    // be strict about invalid ones would cost more than it saves — and a
    // SHORT certificate must pass without this system asking why, because why
    // is medical.
    for (const expiry of ['03/04/2027', '06/04/2025', '03/03/2027']) {
      expect(
        refuseMedicalCert(
          parseMedicalCertResponse(
            withField('expiresAt', { value: expiry, confidence: 'high' }),
          ),
        ),
        expiry,
      ).toBeNull()
    }
  })

  it('does not consult the driver name at all', () => {
    // A disagreement WARNS; it never refuses. The card may be right and the
    // page wrong, and deciding which is a person's job.
    expect(
      refuseMedicalCert(
        parseMedicalCertResponse(
          withField('driverName', {
            value: 'SOMEBODY ELSE',
            confidence: 'high',
          }),
        ),
      ),
    ).toBeNull()
    expect(
      refuseMedicalCert(
        parseMedicalCertResponse(withField('driverName', null)),
      ),
    ).toBeNull()
  })
})

describe('responses that are not a reading', () => {
  it('refuses malformed JSON and the wrong root shape', () => {
    expect(refusalOf('{ "expiresAt": ')).toBe('not_json')
    expect(refusalOf('[]')).toBe('not_an_object')
  })

  it('refuses a missing key, which is different from a null value', () => {
    expect(refusalOf(withField('examinerName', undefined))).toBe(
      'missing_field',
    )
  })

  it('refuses a bare value where the envelope belongs', () => {
    expect(refusalOf(withField('expiresAt', '03/04/2027'))).toBe(
      'bad_field_shape',
    )
  })

  it('refuses a numeric confidence', () => {
    expect(
      refusalOf(withField('expiresAt', { value: 'x', confidence: 0.9 })),
    ).toBe('bad_confidence')
  })
})

describe('the driver name, compared and never chosen', () => {
  const card = (printed: string | null) =>
    parseMedicalCertResponse(
      withField(
        'driverName',
        printed === null ? null : { value: printed, confidence: 'high' },
      ),
    )

  it('agrees across ordering, case, punctuation and a middle name', () => {
    // These all differ legitimately between a printed card and a typed
    // record. A strict comparison would cry wolf on nearly every card, which
    // teaches people to ignore the warning that matters.
    for (const printed of [
      'ADNAN GASHI',
      'Gashi, Adnan',
      'adnan  gashi',
      'ADNAN M. GASHI',
    ]) {
      expect(checkDriverName(card(printed), 'Adnan Gashi'), printed).toEqual({
        agrees: true,
      })
    }
  })

  it('disagrees when the names genuinely diverge, and reports both', () => {
    expect(checkDriverName(card('ROLAND DUPUY'), 'Adnan Gashi')).toEqual({
      agrees: false,
      printed: 'ROLAND DUPUY',
      expected: 'Adnan Gashi',
    })
  })

  it('says unknown when the card printed no name', () => {
    // Not agreement, and not a disagreement either — there is nothing to
    // compare, and a warning on a blank is noise.
    expect(checkDriverName(card(null), 'Adnan Gashi')).toEqual({
      agrees: 'unknown',
      why: 'no_printed_name',
    })
  })
})

describe('the proposal a person confirms', () => {
  it('carries the converted date AND the printed one', () => {
    // TWO DIFFERENT CLAIMS. What the card says, and what this system read it
    // as — the second is what gets stored, so the screen shows both.
    const p = medicalCertProposal(parseMedicalCertResponse(GOOD), 'Adnan Gashi')
    expect(p).not.toBeNull()
    expect(p!.expiresAt).toBe('2027-03-04')
    expect(p!.expiresAtPrinted).toBe('03/04/2027')
    expect(p!.issuedAt).toBe('2025-03-04')
    expect(p!.examinerName).toBe('DANA R OKONKWO, DO')
    expect(p!.examinerRegistryNumber).toBe('1234567890')
  })

  it('carries the expiry confidence, so a medium read is visible', () => {
    const p = medicalCertProposal(
      parseMedicalCertResponse(
        withField('expiresAt', { value: '03/04/2027', confidence: 'medium' }),
      ),
      'Adnan Gashi',
    )
    expect(p!.expiresAtConfidence).toBe('medium')
  })

  it('raises the name warning only when the names disagree', () => {
    const agreeing = medicalCertProposal(
      parseMedicalCertResponse(GOOD),
      'Adnan Gashi',
    )
    expect(agreeing!.nameDisagreement).toBeNull()

    const disagreeing = medicalCertProposal(
      parseMedicalCertResponse(GOOD),
      'Roland Dupuy',
    )
    expect(disagreeing!.nameDisagreement).toEqual({
      printed: 'ADNAN GASHI',
      expected: 'Roland Dupuy',
    })
  })

  it('does not warn when the card printed no name at all', () => {
    // `unknown` is not a disagreement — there is nothing to compare, and a
    // warning on a blank is noise that teaches people to dismiss warnings.
    const p = medicalCertProposal(
      parseMedicalCertResponse(withField('driverName', null)),
      'Adnan Gashi',
    )
    expect(p!.nameDisagreement).toBeNull()
  })

  it('proposes nothing when there is no expiry to file', () => {
    // A proposal with no expiry has nothing to write, and the type says so
    // rather than carrying an empty string somebody could file.
    expect(
      medicalCertProposal(
        parseMedicalCertResponse(withField('expiresAt', null)),
        'Adnan Gashi',
      ),
    ).toBeNull()
  })
})

describe('proposing a driver from the printed name', () => {
  // The roster's real shape: near-duplicate names, and rows that are not
  // people at all. This is why nearest-match is refused.
  const roster = [
    { id: 'd1', firstName: 'ADNAN', lastName: 'GASHI' },
    { id: 'd2', firstName: 'HAIDAR', lastName: 'NIYOZOV' },
    { id: 'd3', firstName: 'ODILJON', lastName: 'NIYOZOV' },
    { id: 'd4', firstName: 'TJK', lastName: 'logistic' },
    { id: 'd5', firstName: '7', lastName: 'Star' },
    { id: 'd6', firstName: 'Said truck', lastName: '3609' },
  ]

  it('proposes the one driver whose name matches exactly', () => {
    expect(matchDriverByName('ADNAN GASHI', roster)).toEqual({
      kind: 'one',
      driver: roster[0],
    })
  })

  it('sees through the ways a card lays a name out', () => {
    // Ordering, case and punctuation are how the card is printed, not part of
    // the name. Nothing else is normalised.
    for (const printed of ['Gashi, Adnan', 'adnan  gashi', 'GASHI ADNAN']) {
      expect(matchDriverByName(printed, roster), printed).toEqual({
        kind: 'one',
        driver: roster[0],
      })
    }
  })

  it('ASKS rather than guessing when a word differs', () => {
    // THE STRICTNESS IS THE POINT, and it is stricter than `checkDriverName`
    // on purpose — that one warns, this one chooses. A middle initial the
    // record lacks is a question, not an answer.
    expect(matchDriverByName('ADNAN M GASHI', roster).kind).toBe('none')
    expect(matchDriverByName('ADNAN', roster).kind).toBe('none')
    expect(matchDriverByName('GASHI', roster).kind).toBe('none')
  })

  it('never reaches for the nearest name on a roster like this one', () => {
    // `NIYOZOV` alone is one word away from two different drivers. A nearest
    // match picks one of them; this asks.
    expect(matchDriverByName('NIYOZOV', roster).kind).toBe('none')
    // And these are not people. A fuzzy matcher files a medical certificate
    // against a company and it looks like it worked.
    expect(matchDriverByName('TJK', roster).kind).toBe('none')
    expect(matchDriverByName('Star', roster).kind).toBe('none')
    expect(matchDriverByName('Said truck 3610', roster).kind).toBe('none')
  })

  it('asks when two drivers share the name exactly', () => {
    // NOT A TIE TO BREAK. Picking the first, or the most recently hired, is
    // the machine resolving an ambiguity that belongs to whoever knows which
    // person handed over the card.
    const twins = [
      { id: 'a', firstName: 'JOHN', lastName: 'SMITH' },
      { id: 'b', firstName: 'John', lastName: 'Smith' },
    ]
    const found = matchDriverByName('SMITH, JOHN', twins)
    expect(found.kind).toBe('many')
    if (found.kind === 'many') expect(found.drivers).toHaveLength(2)
  })

  it('asks when the card printed no name at all', () => {
    for (const printed of [null, undefined, '', '   ']) {
      expect(matchDriverByName(printed, roster).kind).toBe('none')
    }
  })

  it('carries the printed name into the proposal, for the screen that asks', () => {
    // A person choosing from a list needs to see what they are matching
    // against rather than holding it in their head.
    const p = medicalCertProposal(parseMedicalCertResponse(GOOD), '')
    expect(p!.printedName).toBe('ADNAN GASHI')
    // And with nobody proposed there is nothing to disagree with, so the
    // warning is withheld rather than invented.
    expect(p!.nameDisagreement).toBeNull()
  })
})
