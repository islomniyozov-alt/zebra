import { describe, expect, it } from 'vitest'
import { assertCodesConfirmed } from '@/lib/fleet'
import { ReferenceError } from '@/lib/reference'

// ---------------------------------------------------------------------------
// ENDORSEMENTS AND RESTRICTIONS ARE NEVER AUTO-ACCEPTED.
//
// ── WHY A PERSON, AND NOT A CHECK ─────────────────────────────────────────
//
// Twenty reads of one Georgia licence produced SEVEN different letters for one
// printed restriction glyph — A, B, C, E, O, S and 5 — and seventeen of those
// reads returned a letter at `high` confidence.
//
// AND RECOGNITION CANNOT BE THE GATE, which is the part worth writing down.
// `E` and `O` are both real restriction codes, and both were wrong. A
// recognition check waves them straight through. It happened to flag nine of
// ten in the second batch purely because of which letters the model guessed
// that time — a check whose success depends on the shape of the error is not a
// check, it is a coincidence with good manners.
//
// So recognition stays as SIGNAL beside each code, and the gate is a tick.
//
// IT IS TESTED HERE RATHER THAN THROUGH THE ACTION because the rule lives in
// `src/lib/fleet.ts` — AGENTS.md's placement rule, and the reason for it: a
// rule inside a `'use server'` body needs the whole auth context stood up to
// reach, so it ships on a reading instead of a test.
// ---------------------------------------------------------------------------

const refusalOf = (input: {
  codesPresented?: unknown
  codesConfirmed?: unknown
}): string | null => {
  try {
    assertCodesConfirmed(input)
    return null
  } catch (error) {
    if (error instanceof ReferenceError) return error.code
    throw error
  }
}

describe('a licence was read, so its codes need confirming', () => {
  it('refuses to save when the tick is missing', () => {
    expect(refusalOf({ codesPresented: 'yes' })).toBe('codes_unconfirmed')
    expect(refusalOf({ codesPresented: 'yes', codesConfirmed: '' })).toBe(
      'codes_unconfirmed',
    )
    // An unchecked box posts nothing at all, which is the common case.
    expect(
      refusalOf({ codesPresented: 'yes', codesConfirmed: undefined }),
    ).toBe('codes_unconfirmed')
  })

  it('refuses anything that is not the tick, rather than accepting truthiness', () => {
    // "false" and "off" are truthy strings. A gate that took any value would
    // be satisfied by an unchecked box in a browser that posted one.
    for (const value of ['false', 'off', 'no', '0', 'on', 'true']) {
      expect(
        refusalOf({ codesPresented: 'yes', codesConfirmed: value }),
        value,
      ).toBe('codes_unconfirmed')
    }
  })

  it('saves once somebody says the codes match the card', () => {
    expect(
      refusalOf({ codesPresented: 'yes', codesConfirmed: 'yes' }),
    ).toBeNull()
  })

  it('names the field, so the message lands on the tick', () => {
    try {
      assertCodesConfirmed({ codesPresented: 'yes' })
      throw new Error('expected a refusal')
    } catch (error) {
      expect((error as ReferenceError).field).toBe('codesConfirmed')
    }
  })
})

describe('no licence was read, so there is nothing to confirm', () => {
  it('lets a manual entry through untouched', () => {
    // THE HIDDEN MARKER IS WHY THIS IS POSSIBLE. An absent checkbox looks the
    // same whether the form asked and was ignored or never asked at all;
    // without `codesPresented` the gate would either block manual entry or
    // default to "fine", and defaulting to fine makes it decorative.
    expect(refusalOf({})).toBeNull()
    expect(refusalOf({ codesPresented: '' })).toBeNull()
    expect(refusalOf({ codesPresented: 'no' })).toBeNull()
  })

  it('does not care about a stray tick when nothing was presented', () => {
    expect(refusalOf({ codesConfirmed: 'yes' })).toBeNull()
  })
})
