import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { facilityCode, parseSeedAddress, stateCode } from '@/lib/facility-code'

// ---------------------------------------------------------------------------
// A CODE IS AN EXACT KEY. THE ADDRESS AROUND IT IS NOT TRUSTED TWICE.
//
// `facility-memory.ts` matches addresses and is fuzzy because it must be. This
// is the opposite discipline: "MEM1" is one building, and a rule that made it
// nearly-match another code would attach freight to the wrong dock in silence.
//
// The parsing here exists because the Datatruck export ships ONE formatted
// address string — "11077 US-190, Hammond, LA 70401, USA" — into a schema that
// keeps the parts separate.
// ---------------------------------------------------------------------------

describe('what counts as a facility code', () => {
  it('takes a code as written', () => {
    expect(facilityCode('MEM1')).toBe('MEM1')
    expect(facilityCode('KCDC_WAR_740370001_656')).toBe(
      'KCDC_WAR_740370001_656',
    )
  })

  it('trims, because a spreadsheet cell is not a promise', () => {
    expect(facilityCode('  DXH5 ')).toBe('DXH5')
  })

  it('treats empty as ABSENT rather than as a code', () => {
    // A row storing '' would occupy the one unique slot a null never can, and
    // the second codeless facility would collide with the first.
    expect(facilityCode('')).toBeNull()
    expect(facilityCode('   ')).toBeNull()
    expect(facilityCode(null)).toBeNull()
    expect(facilityCode(undefined)).toBeNull()
  })

  // NO FOLDING, NO NORMALISING. Every code in the 3,599-row export is upper
  // case; inventing a case rule for data that has never needed one would only
  // hide the day a different one arrives.
  it('does not change case', () => {
    expect(facilityCode('mem1')).toBe('mem1')
    expect(facilityCode('mem1')).not.toBe(facilityCode('MEM1'))
  })
})

describe('the state, as the two letters the column holds', () => {
  it('maps the export full names', () => {
    expect(stateCode('Louisiana')).toBe('LA')
    expect(stateCode('Texas')).toBe('TX')
    expect(stateCode('district of columbia')).toBe('DC')
  })

  it('passes a code through, upper-cased', () => {
    expect(stateCode('la')).toBe('LA')
    expect(stateCode('AR')).toBe('AR')
  })

  // FLAG 11'S LESSON. Slicing "Texas" to "TE" produced a state that does not
  // exist and nothing noticed. Unknown is null, not a prefix.
  it('returns null for anything it does not know, never a slice', () => {
    expect(stateCode('Tex')).toBeNull()
    expect(stateCode('Ontario')).toBeNull()
    expect(stateCode('')).toBeNull()
    expect(stateCode(null)).toBeNull()
  })
})

describe('pulling the street and postcode out of one formatted address', () => {
  it('takes the street from before the first comma', () => {
    expect(
      parseSeedAddress('11077 US-190, Hammond, LA 70401, USA').addressLine1,
    ).toBe('11077 US-190')
  })

  // THE BUG A DRY RUN CAUGHT BEFORE ANYTHING WAS WRITTEN. The first five-digit
  // run in that string is 11077 — the STREET NUMBER. Taking it would have
  // given 451 of 3,383 rows a postcode that is part of their own address.
  it('takes the postcode after the STATE, not the first five digits', () => {
    expect(
      parseSeedAddress('11077 US-190, Hammond, LA 70401, USA').postalCode,
    ).toBe('70401')
  })

  it('still reads it when the street number is short', () => {
    expect(
      parseSeedAddress('4400 E 19th St, Texarkana, AR 71854, USA').postalCode,
    ).toBe('71854')
  })

  it('reads a zip+4 as the five', () => {
    expect(parseSeedAddress('1 Way, Town, OH 44601-1234, USA').postalCode).toBe(
      '44601',
    )
  })

  it('is null rather than wrong when there is no postcode', () => {
    // A driver can be told an address that is missing a part. They cannot be
    // told one that is confidently wrong.
    expect(
      parseSeedAddress('Some Yard, Hammond, LA, USA').postalCode,
    ).toBeNull()
    expect(parseSeedAddress('').addressLine1).toBeNull()
    expect(parseSeedAddress(null).postalCode).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// THE SCRIPT AND THE LIBRARY AGREE.
//
// `scripts/seed-facilities.mjs` is plain JavaScript and cannot import the
// TypeScript above, so it carries its own copy of these two rules. That is the
// same hand-maintained correspondence that let a mail worker and an endpoint
// drift apart (flag 64) — so it is asserted rather than remembered.
// ---------------------------------------------------------------------------

describe('the seed script carries the same rules it was written beside', () => {
  const script = readFileSync('scripts/seed-facilities.mjs', 'utf8')

  it('anchors its postcode on the state, exactly as the library does', () => {
    const library = readFileSync('src/lib/facility-code.ts', 'utf8')
    const pattern = /[A-Za-z]{2},?\s+(\d{5})/
    expect(library).toMatch(pattern)
    expect(script, 'the script would give 451 rows a street number').toMatch(
      pattern,
    )
  })

  it('knows the same states', () => {
    // A state the script cannot read imports as null and moves a dock into
    // whatever zone its city implies.
    for (const name of ['louisiana', 'texas', 'puerto rico', 'wyoming']) {
      expect(script, `${name} missing from the script's table`).toContain(name)
    }
  })

  it('refuses to write without being told twice', () => {
    expect(script).toContain('--write')
    expect(script).toContain('--yes')
    expect(script).toMatch(
      /WRITE\s*=\s*process\.argv\.includes\('--write'\)\s*&&/,
    )
  })

  it('prints the target before it does anything', () => {
    // Flag 59: a command that names a variable a dev terminal can satisfy is a
    // coin flip that reports heads.
    expect(script.indexOf('Target:')).toBeLessThan(
      script.indexOf('insert into'),
    )
  })

  it('refuses to guess the tenant when there is more than one', () => {
    expect(script).toContain('SEED_ORGANIZATION_ID')
    expect(script).toMatch(/active organizations/)
  })

  it('upserts on the unique key rather than checking first', () => {
    // Idempotence as a property of the schema, not a promise made by a script.
    expect(script).toMatch(/on conflict \("organizationId", "facilityCode"\)/)
  })
})
