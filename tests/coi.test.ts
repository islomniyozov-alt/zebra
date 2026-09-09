import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  COI_FIELDS,
  COI_FORBIDDEN_FIELDS,
  COI_SCHEMA,
} from '@/lib/extraction/coi-shape'
import { COI_EXTRACTION_SYSTEM_WITH_SCHEMA } from '@/lib/extraction/coi-prompt'
import { parseCoiResponse } from '@/lib/extraction/coi-parse'
import { checkCarrier, refuseCoi } from '@/lib/extraction/coi-refusal'
import { parseUsDate } from '@/lib/extraction/us-dates'

// ---------------------------------------------------------------------------
// THE ACORD CERTIFICATE CONTRACT, BEFORE ANY CERTIFICATE HAS BEEN READ.
//
// Written against the form rather than against a model's output, which is the
// whole point of doing it in this order: a contract drafted after reading the
// answers is a transcription of the answers.
//
// THE EXCLUSIONS ARE ASSERTED THREE WAYS HERE — absent from the TypeScript
// shape, absent from the JSON Schema, and refused by name in the prompt — with
// `additionalProperties: false` as the fourth. The same treatment date of
// birth got on the CDL and health information got on the medical card.
// ---------------------------------------------------------------------------

const field = (value: string | null, confidence = 'high') =>
  value === null ? null : { value, confidence }

const coi = (over: Record<string, unknown> = {}) => ({
  policyNumber: field('CA-8891233'),
  insurer: field('Great West Casualty Company'),
  effectiveAt: field('03/04/2026'),
  expiresAt: field('03/04/2027'),
  liabilityLimit: field('$1,000,000'),
  cargoLimit: field('$100,000'),
  insuredName: field('RAM HAULAGE LLC'),
  insuredMc: field('MC-1234567'),
  insuredDot: field('3456789'),
  ...over,
})

const parsed = (over: Record<string, unknown> = {}) =>
  parseCoiResponse(JSON.stringify(coi(over)))

describe('what the contract carries', () => {
  it('has exactly the nine fields, and the schema agrees', () => {
    expect([...COI_FIELDS].sort()).toEqual(
      Object.keys(COI_SCHEMA.properties).sort(),
    )
    expect([...COI_SCHEMA.required].sort()).toEqual([...COI_FIELDS].sort())
  })

  // THE LINE THAT MAKES A VOLUNTEERED FIELD A VIOLATION rather than an extra
  // key nobody notices.
  it('forbids anything the schema does not name', () => {
    expect(COI_SCHEMA.additionalProperties).toBe(false)
  })
})

describe('what the contract must never carry', () => {
  const source = readFileSync(
    join(process.cwd(), 'src', 'lib', 'extraction', 'coi-shape.ts'),
    'utf8',
  )

  for (const forbidden of COI_FORBIDDEN_FIELDS) {
    it(`has no ${forbidden} in the schema`, () => {
      expect(Object.keys(COI_SCHEMA.properties)).not.toContain(forbidden)
    })

    // THE SHAPE ITSELF, read as text. A key can only be in the interface if it
    // is declared there, so this catches a field added to the TypeScript and
    // forgotten in the schema.
    it(`has no ${forbidden} declared in the TypeScript shape`, () => {
      const declaration = new RegExp(String.raw`^\s+${forbidden}\??:`, 'm')
      expect(declaration.test(source)).toBe(false)
    })
  }

  it('refuses them by name in the prompt', () => {
    const prompt = COI_EXTRACTION_SYSTEM_WITH_SCHEMA.toLowerCase()
    for (const phrase of [
      'certificate holder',
      'producer',
      'description of operations',
      'premium',
    ]) {
      expect(prompt).toContain(phrase)
    }
    expect(prompt).toContain('do not return, ever')
  })
})

describe('the prompt asks for transcription, not interpretation', () => {
  it('asks for dates exactly as printed and never for ISO', () => {
    expect(COI_EXTRACTION_SYSTEM_WITH_SCHEMA).toContain('EXACTLY AS PRINTED')
    expect(COI_EXTRACTION_SYSTEM_WITH_SCHEMA).toContain('Do not convert them')
    // THE CDL'S MISTAKE, NOT REPEATED. Asking for ISO makes the model
    // interpret 03/04/2027 and throws the printed text away on the way out.
    expect(COI_EXTRACTION_SYSTEM_WITH_SCHEMA).not.toContain('yyyy-mm-dd')
  })

  it('offers no list of permitted values anywhere', () => {
    // The Georgia CLASS AM lesson: an enum tells the model what answers are
    // acceptable, and it picks one.
    const body = COI_EXTRACTION_SYSTEM_WITH_SCHEMA.slice(
      0,
      COI_EXTRACTION_SYSTEM_WITH_SCHEMA.indexOf('JSON Schema:'),
    )
    expect(body).not.toMatch(/one of:|must be one of|permitted values/i)
  })
})

describe('when a certificate was not read', () => {
  it('accepts a clean one', () => {
    expect(refuseCoi(parsed())).toBeNull()
  })

  // THE SPINE. A compliance row cannot exist without an expiry — the column is
  // NOT NULL and it is the only field that feeds an alarm.
  it('refuses with no expiry', () => {
    expect(refuseCoi(parsed({ expiresAt: null }))).toBe('no_expiry')
  })

  it('refuses a guessed expiry', () => {
    expect(refuseCoi(parsed({ expiresAt: field('03/04/2027', 'low') }))).toBe(
      'low_confidence_expiry',
    )
  })

  it('refuses an expiry in no stated format', () => {
    expect(refuseCoi(parsed({ expiresAt: field('sometime in March') }))).toBe(
      'unreadable_expiry',
    )
  })

  // BOTH DATES COME OFF ONE ROW IN ONE HAND. If one will not read, the reading
  // of the other is not to be trusted either.
  it('refuses when the effective date will not read', () => {
    expect(refuseCoi(parsed({ effectiveAt: field('n/a') }))).toBe(
      'unreadable_effective',
    )
  })

  it('refuses a certificate that expires before it starts', () => {
    expect(
      refuseCoi(
        parsed({
          effectiveAt: field('03/04/2027'),
          expiresAt: field('03/04/2026'),
        }),
      ),
    ).toBe('expiry_before_effective')
  })

  // Catches a transposed decade — 2027 read as 2037 — rather than adjudicating
  // what an underwriter may sell.
  it('refuses an implausible term', () => {
    expect(
      refuseCoi(
        parsed({
          effectiveAt: field('03/04/2026'),
          expiresAt: field('03/04/2037'),
        }),
      ),
    ).toBe('implausible_term')
  })

  // A policy number is the obvious spine candidate and is deliberately not it:
  // it identifies the policy but it triggers nothing.
  it('accepts a certificate with no policy number', () => {
    expect(refuseCoi(parsed({ policyNumber: null }))).toBeNull()
  })

  it('accepts one with no cargo line, because that is a real answer', () => {
    expect(refuseCoi(parsed({ cargoLimit: null }))).toBeNull()
  })
})

describe('does this certificate name the carrier it is filed against', () => {
  const ram = { name: 'RAM Haulage', mcNumber: '1234567', dotNumber: '3456789' }

  it('accepts a legal suffix as agreement', () => {
    const check = checkCarrier(parsed(), ram)
    expect(check.agrees).toBe(true)
    expect(check.notes).toEqual([])
  })

  it('says so when the certificate names somebody else', () => {
    const check = checkCarrier(
      parsed({ insuredName: field('Dolphins Transport Inc') }),
      ram,
    )
    expect(check.agrees).toBe(false)
    expect(check.notes.join()).toContain('Dolphins Transport Inc')
  })

  // A USDOT NUMBER CANNOT BE SPELLED TWO WAYS, which is why it is the stronger
  // signal wherever both sides have one.
  it('catches a USDOT that disagrees', () => {
    const check = checkCarrier(parsed({ insuredDot: field('9999999') }), ram)
    expect(check.agrees).toBe(false)
    expect(check.notes.join()).toContain('9999999')
  })

  it('ignores punctuation in an MC number', () => {
    expect(
      checkCarrier(parsed({ insuredMc: field('1234567') }), ram).agrees,
    ).toBe(true)
  })

  // ABSENCE IS NEVER A DISAGREEMENT. Most certificates print neither number.
  it('says nothing when the certificate prints no numbers', () => {
    const check = checkCarrier(
      parsed({ insuredMc: null, insuredDot: null }),
      ram,
    )
    expect(check.agrees).toBe(true)
  })

  it('says nothing when the company row holds no numbers', () => {
    const check = checkCarrier(parsed(), {
      name: 'RAM Haulage',
      mcNumber: null,
      dotNumber: null,
    })
    expect(check.agrees).toBe(true)
  })
})

describe('the shared date rule', () => {
  it('reads the three printed shapes as one day', () => {
    expect(parseUsDate('03/04/2027')).toEqual({ ok: true, iso: '2027-03-04' })
    expect(parseUsDate('2027-03-04')).toEqual({ ok: true, iso: '2027-03-04' })
    expect(parseUsDate('Mar 4, 2027')).toEqual({ ok: true, iso: '2027-03-04' })
  })

  it('refuses a format nobody stated', () => {
    expect(parseUsDate('4 March 2027').ok).toBe(false)
  })
})
