import { describe, expect, it } from 'vitest'
import { normalizeAddress, placeAgrees } from '@/lib/facility-memory'

// ---------------------------------------------------------------------------
// THE ONE DECISION IN FACILITY MEMORY THAT IS NOT A QUERY (§3 step 4).
//
// How hard an address is folded before two of them are called the same dock.
// Fold too little and the office never recognises a facility it has been to
// twice; fold too much and a driver arrives at the wrong building with a gate
// code that does not open it.
// ---------------------------------------------------------------------------

const salem = { city: 'Salem', state: 'OR', postalCode: '97302' }

describe('folding an address', () => {
  it('spells a street type one way, which is what two documents differ by', () => {
    // The same dock, printed twice by two brokers.
    expect(
      normalizeAddress({ addressLine1: '3120 Turner Road SE', ...salem }),
    ).toBe(normalizeAddress({ addressLine1: '3120 Turner Rd SE', ...salem }))
    expect(
      normalizeAddress({ addressLine1: '8800 Elder Creek Road', ...salem }),
    ).toBe(normalizeAddress({ addressLine1: '8800 ELDER CREEK RD.', ...salem }))
  })

  it('and ignores the punctuation and spacing a fax adds', () => {
    expect(
      normalizeAddress({ addressLine1: '  100  Main St. ', ...salem }),
    ).toBe(normalizeAddress({ addressLine1: '100 Main Street', ...salem }))
  })

  it('KEEPS the directional — north and south are a mile apart', () => {
    // THE TEST THAT MATTERS, first half. A fold that dropped "N" and "S" as
    // noise would send a driver to the wrong end of the same street with a
    // gate code that does not open the gate.
    expect(
      normalizeAddress({ addressLine1: '100 Main St N', ...salem }),
    ).not.toBe(normalizeAddress({ addressLine1: '100 Main St S', ...salem }))
    // Spelled either way, it is still the same directional.
    expect(
      normalizeAddress({ addressLine1: '100 Main St North', ...salem }),
    ).toBe(normalizeAddress({ addressLine1: '100 Main St N', ...salem }))
  })

  it('KEEPS the suite — two tenants at one address are two facilities', () => {
    // Second half, and the one that costs an hour at the dock: the gate code
    // for Ste 3 does not belong to Ste 4.
    expect(
      normalizeAddress({ addressLine1: '500 Dock Ave Suite 3', ...salem }),
    ).not.toBe(
      normalizeAddress({ addressLine1: '500 Dock Ave Ste 4', ...salem }),
    )
    expect(
      normalizeAddress({ addressLine1: '500 Dock Ave Suite 3', ...salem }),
    ).toBe(normalizeAddress({ addressLine1: '500 Dock Ave STE 3', ...salem }))
  })

  it('and keeps the number, which is the whole address', () => {
    expect(
      normalizeAddress({ addressLine1: '100 Main St', ...salem }),
    ).not.toBe(normalizeAddress({ addressLine1: '1000 Main St', ...salem }))
  })
})

describe('what the fold refuses to answer', () => {
  it('has no key for a stop with no street — which is most of them', () => {
    // THE COMMON CASE AND THE IMPORTANT ONE. Most Locations in this system are
    // lane endpoints typed as "Salem, OR". A key for those would match every
    // load into Salem to the first Salem dock anybody saved.
    expect(normalizeAddress({ city: 'Salem', state: 'OR' })).toBeNull()
    expect(normalizeAddress({ addressLine1: '   ', ...salem })).toBeNull()
  })

  it('and none for a street with no state to put it in', () => {
    // "100 Main St" is in every town in the country.
    expect(normalizeAddress({ addressLine1: '100 Main St' })).toBeNull()
    expect(
      normalizeAddress({ addressLine1: '100 Main St', city: 'Salem' }),
    ).toBeNull()
    expect(
      normalizeAddress({ addressLine1: '100 Main St', postalCode: '97302' }),
    ).toBeNull()
  })

  it('separates two states with the same street name', () => {
    expect(
      normalizeAddress({
        addressLine1: '100 Main St',
        city: 'Salem',
        state: 'OR',
      }),
    ).not.toBe(
      normalizeAddress({
        addressLine1: '100 Main St',
        city: 'Salem',
        state: 'MA',
      }),
    )
  })

  it('and the KEY IS COARSE on purpose — the zip is not in it', () => {
    // THE BUG THE INTEGRATION TEST FOUND. When the postal code was part of the
    // key, one broker's template printing a zip and another's not gave the same
    // dock two keys, and it never recognised itself. The rest of the address is
    // compared in `placeAgrees`, where a value only counts against a match if
    // BOTH documents printed it.
    expect(normalizeAddress({ addressLine1: '100 Main St', state: 'OR' })).toBe(
      normalizeAddress({
        addressLine1: '100 Main St',
        city: 'Salem',
        state: 'OR',
        postalCode: '97302',
      }),
    )
  })
})

describe('whether two printings of one street line are one place', () => {
  it('a zip on one and none on the other is not a disagreement', () => {
    // Which is the ordinary difference between two brokers' templates.
    expect(
      placeAgrees(
        { city: 'Salem', state: 'OR', postalCode: '97302' },
        { city: 'Salem', state: 'OR' },
      ),
    ).toBe(true)
  })

  it('two zips that differ are two docks', () => {
    expect(placeAgrees({ postalCode: '97302' }, { postalCode: '97301' })).toBe(
      false,
    )
  })

  it('the zip outranks the city, because a dock can be in the next town', () => {
    // A document can print "Salem" for an address that is legally in Keizer.
    expect(
      placeAgrees(
        { city: 'Salem', postalCode: '97302-1234' },
        { city: 'Keizer', postalCode: '97302' },
      ),
    ).toBe(true)
  })

  it('and with no zips, two towns on one street name are two docks', () => {
    expect(placeAgrees({ city: 'Salem' }, { city: 'Portland' })).toBe(false)
  })

  it('with nothing printed on either, the street line stands alone', () => {
    // The weakest match this makes, stated rather than hidden: it needs BOTH
    // documents to omit the city and the zip.
    expect(placeAgrees({}, {})).toBe(true)
  })
})
