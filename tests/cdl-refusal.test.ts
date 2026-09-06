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
      refuseCdl(
        card({ state: { value: 'WA', confidence: 'high', note: 'WA 98101' } }),
      ),
    ).toBeNull()
  })

  it('refuses a header that disagrees with the address', () => {
    // Two independent readings; a disagreement means two documents got mixed
    // or the header was misread. Picking a winner would be the system deciding
    // which of its own mistakes to keep.
    expect(
      refuseCdl(
        card({ state: { value: 'WA', confidence: 'high', note: 'OR 97201' } }),
      ),
    ).toBe('state_disagrees')
  })
})

describe('endorsement and restriction codes', () => {
  it('turns NONE into an empty list rather than a code', () => {
    // Carried through, it becomes an endorsement called NONE — which reads on
    // a compliance screen as a driver holding something.
    expect(codeList(['NONE'])).toEqual([])
    expect(codeList(['N/A'])).toEqual([])
    expect(codeList([])).toEqual([])
    expect(codeList(null)).toEqual([])
  })

  it('keeps real codes, uppercased and trimmed', () => {
    expect(codeList([' h ', 'n', 'T'])).toEqual(['H', 'N', 'T'])
  })

  it('drops NONE from a list that also has codes', () => {
    expect(codeList(['H', 'NONE'])).toEqual(['H'])
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
