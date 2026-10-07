import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DRIVER_KIND,
  DRIVER_KINDS,
  PERSON_DRIVER,
  assertDriverKind,
  crewLabelFor,
  isDriverKind,
  isReferralPayee,
} from '@/lib/driver-kind'
import { ReferenceError } from '@/lib/reference'

// ---------------------------------------------------------------------------
// A PERSON, OR SOMEBODY WHO TAKES A CUT.
//
// Owner's ruling, 2026-09-24. Every failure here is silent in production: a
// payee left in the roster count inflates a number used for insurance, a person
// wrongly marked a payee drops out of the Driver Qualification File, and a
// commission in the second seat prints as somebody who was in the truck.
// ---------------------------------------------------------------------------

describe('the code list', () => {
  it('is exactly the two the ruling named', () => {
    expect([...DRIVER_KINDS]).toEqual(['PERSON', 'PAYEE'])
  })

  it('defaults to PERSON, so every existing row keeps meaning what it meant', () => {
    // The migration's default, restated where the rule lives. A default of
    // PAYEE would have silently emptied the DQF roster on deploy.
    expect(DEFAULT_DRIVER_KIND).toBe('PERSON')
  })

  it('recognises the two and refuses anything else', () => {
    expect(isDriverKind('PERSON')).toBe(true)
    expect(isDriverKind('PAYEE')).toBe(true)
    expect(isDriverKind('payee')).toBe(false)
    expect(isDriverKind('AGENCY')).toBe(false)
  })

  it('refuses by name, as a reference error the form can print (item 17)', () => {
    // `Truck.fleetStatus` learned this: a text column with a code list is only
    // a code list if something refuses the values outside it. Since the kind
    // became a field on the driver form, the refusal is a ReferenceError with
    // a code and a field, so it reaches the person as a sentence under the
    // select rather than a five-hundred.
    for (const bad of ['payee', undefined, '', 42]) {
      let caught: unknown
      try {
        assertDriverKind(bad)
      } catch (error) {
        caught = error
      }
      expect(caught, String(bad)).toBeInstanceOf(ReferenceError)
      expect(caught).toMatchObject({ code: 'not_driver_kind', field: 'kind' })
    }
    expect(assertDriverKind('PAYEE')).toBe('PAYEE')
    expect(assertDriverKind('PERSON')).toBe('PERSON')
  })
})

describe('who is a commission rather than a person', () => {
  it('is the PAYEE rows and nobody else', () => {
    expect(isReferralPayee({ kind: 'PAYEE' })).toBe(true)
    expect(isReferralPayee({ kind: 'PERSON' })).toBe(false)
  })

  it('treats an unknown kind as a person', () => {
    // The safe direction. Appearing wrongly in a compliance list gets noticed;
    // vanishing from one does not.
    expect(isReferralPayee({ kind: 'AGENCY' })).toBe(false)
  })
})

describe('the one spelling of the exclusion', () => {
  // FOUR CALLERS SHARE THIS: the DQF roster, the compliance warnings, the
  // dispatch pickers and the roster counts. Four hand-written clauses would be
  // four places to miss, and the one missed is found as a DQF nobody filed.
  it('excludes PAYEE by NOT, not by equals PERSON', () => {
    expect(PERSON_DRIVER).toEqual({ kind: { not: 'PAYEE' } })
  })
})

describe('what the statement calls the second seat', () => {
  it('says Referral for a payee', () => {
    // "Team with 7 Star" is a false statement about who was in the truck, on
    // the one document a driver reads to check their own pay.
    expect(crewLabelFor({ kind: 'PAYEE' })).toBe('Referral')
  })

  it('says Team with for a person', () => {
    expect(crewLabelFor({ kind: 'PERSON' })).toBe('Team with')
  })
})
