import { describe, expect, it } from 'vitest'
import { codeList, refuseCdl } from '@/lib/extraction/cdl-refusal'
import { CDL_FIELDS, CDL_SCHEMA } from '@/lib/extraction/cdl-shape'
import { CDL_EXTRACTION_SYSTEM } from '@/lib/extraction/cdl-prompt'
import { NOTHING_READ } from '@/lib/cdl'
import type { ExtractedCdl } from '@/lib/extraction/cdl-shape'

// ---------------------------------------------------------------------------
// THE RULES A LICENCE READ IS HELD TO, ASSERTED BEFORE ANY CARD EXISTS.
//
// Every one comes from the AAMVA card standard or the owner's ruling — printed
// facts about how licences are laid out — so they can be written and tested
// without a photograph. What CANNOT be done yet is the accuracy run: how well
// a model reads a real card is a question only a real card answers, and tuning
// the prompt before that is tuning against the model's own output.
// ---------------------------------------------------------------------------

const at = <T>(value: T, confidence: 'high' | 'medium' | 'low' = 'high') => ({
  value,
  confidence,
})

const card = (over: Partial<ExtractedCdl> = {}): ExtractedCdl => ({
  ...NOTHING_READ,
  licenceNumber: at('WDL9911234'),
  expiresAt: at('2029-04-14'),
  issuedAt: at('2025-04-14'),
  ...over,
})

describe('the spine: licence number and expiry', () => {
  it('accepts a card that has both', () => {
    expect(refuseCdl(card())).toBeNull()
  })

  it('refuses a card with no licence number', () => {
    expect(refuseCdl(card({ licenceNumber: null }))).toBe('no_licence_number')
  })

  it('refuses a card with no expiry', () => {
    expect(refuseCdl(card({ expiresAt: null }))).toBe('no_expiry')
  })

  // NO HALF-DRIVER PREFILL. A guess about the number files the driver under
  // something no inspection will match; a guess about the expiry sets an alarm
  // for the wrong month. Every other field can arrive uncertain and be fixed
  // on the form — these two cannot.
  it('refuses a low-confidence licence number even though it has one', () => {
    expect(refuseCdl(card({ licenceNumber: at('WDL9911234', 'low') }))).toBe(
      'low_confidence_spine',
    )
  })

  it('refuses a low-confidence expiry', () => {
    expect(refuseCdl(card({ expiresAt: at('2029-04-14', 'low') }))).toBe(
      'low_confidence_spine',
    )
  })
})

describe('the dates', () => {
  it('refuses a card that expires before it was issued', () => {
    // Most likely 4a and 4b read the wrong way round — the exact mistake a
    // reader keyed on position rather than on the AAMVA number makes.
    expect(
      refuseCdl(
        card({ issuedAt: at('2029-04-14'), expiresAt: at('2025-04-14') }),
      ),
    ).toBe('expiry_before_issue')
  })

  it('refuses a card that expires on its issue day', () => {
    expect(
      refuseCdl(
        card({ issuedAt: at('2027-01-01'), expiresAt: at('2027-01-01') }),
      ),
    ).toBe('expiry_before_issue')
  })

  it('compares ISO text and never constructs a Date', () => {
    // Rule 9-money's date half. A Date introduces a timezone the card never
    // had, and 2027-06-30 becomes the 29th west of Greenwich. A datetime
    // suffix must not change the answer.
    expect(
      refuseCdl(
        card({
          issuedAt: at('2025-04-14T00:00:00Z'),
          expiresAt: at('2029-04-14T00:00:00Z'),
        }),
      ),
    ).toBeNull()
  })

  it('accepts a card with no issue date at all', () => {
    // 4a is not the spine. Absent, there is nothing to contradict.
    expect(refuseCdl(card({ issuedAt: null }))).toBeNull()
  })
})

describe('the state, read twice', () => {
  it('accepts a header that agrees with the address', () => {
    expect(
      refuseCdl(card({ state: at('WA'), addressStateCode: at('WA') })),
    ).toBeNull()
  })

  it('refuses a header that disagrees with the address', () => {
    // Two independent readings; a disagreement means two documents got mixed
    // or the header was misread. Picking a winner would be the system deciding
    // which of its own mistakes to keep.
    expect(
      refuseCdl(card({ state: at('WA'), addressStateCode: at('OR') })),
    ).toBe('state_disagrees')
  })

  it('refuses when there is no address state to check against', () => {
    expect(refuseCdl(card({ state: at('WA'), addressStateCode: null }))).toBe(
      'no_address_state',
    )
  })

  // WHAT THE OLD CHECK COULD NOT DO. It searched `state.note` for two capitals,
  // so a note of exactly "FL" — which the first real card returned — passed by
  // matching the claim itself. Compared as named fields, the same shape is
  // either agreement or disagreement and never an accident.
  it('is not satisfied by a cross-check that merely repeats the claim', () => {
    expect(
      refuseCdl(card({ state: at('WA'), addressStateCode: at('OR') })),
    ).not.toBeNull()
  })
})

describe('endorsement and restriction codes', () => {
  // ONE ENVELOPE PER CODE. Ten runs of one Georgia card returned five
  // different first restrictions under a single `high` for the whole list —
  // the confidence now sits on each code, and so does recognition.
  const read = (
    value: string | null,
    confidence: 'high' | 'medium' | 'low' = 'high',
  ) => ({ value, confidence })

  it('turns NONE into an empty list rather than a code', () => {
    // Carried through, it becomes an endorsement called NONE — which reads on
    // a compliance screen as a driver holding something.
    expect(codeList('endorsement', [read('NONE')])).toEqual([])
    expect(codeList('endorsement', [read('N/A')])).toEqual([])
    expect(codeList('endorsement', [])).toEqual([])
    expect(codeList('endorsement', null)).toEqual([])
  })

  it('keeps real codes, uppercased and trimmed, each with its own confidence', () => {
    expect(
      codeList('endorsement', [read(' h '), read('n', 'medium'), read('T')]),
    ).toEqual([
      { code: 'H', confidence: 'high', recognised: true },
      { code: 'N', confidence: 'medium', recognised: true },
      { code: 'T', confidence: 'high', recognised: true },
    ])
  })

  it('drops NONE from a list that also has codes', () => {
    expect(codeList('endorsement', [read('H'), read('NONE')])).toEqual([
      { code: 'H', confidence: 'high', recognised: true },
    ])
  })

  it('keeps an unreadable code as unread rather than dropping or guessing it', () => {
    // A GUESSED CHARACTER ON A LEGAL DOCUMENT is the VIN-with-an-O error. The
    // entry survives so the COUNT of codes stays right and somebody can see
    // that a code is printed there.
    expect(codeList('restriction', [read('M'), read(null, 'low')])).toEqual([
      { code: 'M', confidence: 'high', recognised: true },
      { code: null, confidence: 'low', recognised: true },
    ])
  })

  it('flags a code it does not recognise, and never corrects it', () => {
    // The five first-codes the real card produced across ten runs: E, O and M
    // are federal restrictions; A, B and 5 are not. Every one is carried
    // through UNCHANGED — `5` does not become `S`.
    expect(
      codeList('restriction', [read('E'), read('O'), read('A'), read('5')]),
    ).toEqual([
      { code: 'E', confidence: 'high', recognised: true },
      { code: 'O', confidence: 'high', recognised: true },
      { code: 'A', confidence: 'high', recognised: false },
      { code: '5', confidence: 'high', recognised: false },
    ])
  })

  it('recognises against the right vocabulary for each kind', () => {
    // P is an endorsement and not a restriction; O is the reverse. A single
    // shared list would call both of them fine.
    expect(codeList('endorsement', [read('P')])[0]!.recognised).toBe(true)
    expect(codeList('restriction', [read('P')])[0]!.recognised).toBe(false)
    expect(codeList('restriction', [read('O')])[0]!.recognised).toBe(true)
    expect(codeList('endorsement', [read('O')])[0]!.recognised).toBe(false)
  })

  it('does not call an unread code unrecognised', () => {
    // There is nothing to recognise, and a warning on a blank is noise that
    // teaches people to ignore the warning that matters.
    expect(codeList('restriction', [read(null, 'low')])[0]!.recognised).toBe(
      true,
    )
  })
})

describe('the contract itself', () => {
  it('asks for exactly the fields the type declares', () => {
    // rate-con-shape.ts's argument, applied here: the schema is written out
    // rather than derived, so a test has to keep the two in step.
    expect([...CDL_FIELDS].sort()).toEqual(Object.keys(NOTHING_READ).sort())
  })

  it('requires every field, so a missing key is a failed read not a null', () => {
    expect([...CDL_SCHEMA.required].sort()).toEqual([...CDL_FIELDS].sort())
  })

  // THE 5DD TRAP, NAMED IN THE PROMPT AND ASSERTED HERE. The document
  // discriminator is a long alphanumeric printed beside the licence number,
  // often larger, and grabbing it files the driver under a number that matches
  // nothing on any inspection or MVR.
  it('warns the model off the document discriminator by name', () => {
    expect(CDL_EXTRACTION_SYSTEM).toContain('5DD')
    expect(CDL_EXTRACTION_SYSTEM).toContain('DOCUMENT DISCRIMINATOR')
    expect(CDL_EXTRACTION_SYSTEM).toMatch(/4d/)
  })

  it('tells the model not to transcribe what this system does not want', () => {
    for (const excluded of [
      'date of birth',
      'address',
      'height',
      'signature',
    ]) {
      expect(CDL_EXTRACTION_SYSTEM.toLowerCase()).toContain(excluded)
    }
    // And none of them is a field it could return.
    for (const excluded of [
      'dateOfBirth',
      'address',
      'sex',
      'height',
      'portrait',
    ]) {
      expect(CDL_FIELDS).not.toContain(excluded)
    }
  })
})
