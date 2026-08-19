import { describe, expect, it } from 'vitest'
import { formatAddress } from '@/lib/locations'

// ---------------------------------------------------------------------------
// THE ADDRESS A DRIVER IS GIVEN.
//
// Every shape below is one the seeded facility book actually contains: 4,367
// rows imported from two exports, some complete, some city-and-state only,
// some with a street the parser could read and a postcode it refused. The
// point of the tests is that each of those renders as a sentence a person can
// read down a phone — and that the missing parts are absent rather than
// rendered as stray punctuation.
// ---------------------------------------------------------------------------

describe('an address on one line', () => {
  it('writes the full thing the way it is read aloud', () => {
    expect(
      formatAddress({
        addressLine1: '11077 US-190',
        city: 'Hammond',
        state: 'LA',
        postalCode: '70401',
      }),
    ).toBe('11077 US-190, Hammond, LA 70401')
  })

  // THE POSTCODE HAS NO COMMA BEFORE IT. "Hammond, LA, 70401" is not how the
  // address is written, and the Amazon delta's own file writes it that way —
  // which is a fact about that export, not about how it should be shown.
  it('joins the state and the postcode with a space, not a comma', () => {
    expect(
      formatAddress({ city: 'Seattle', state: 'WA', postalCode: '98121' }),
    ).toBe('Seattle, WA 98121')
  })

  it('renders a city and state with no postcode', () => {
    expect(formatAddress({ city: 'Memphis', state: 'TN' })).toBe('Memphis, TN')
  })

  it('renders a street with nothing after it', () => {
    expect(formatAddress({ addressLine1: '3639 E Holmes Rd' })).toBe(
      '3639 E Holmes Rd',
    )
  })

  // XUSU's residue: a state recovered from the address tail, no city worth
  // printing. It still says something true.
  it('renders a state alone', () => {
    expect(formatAddress({ state: 'SC', postalCode: '29730' })).toBe('SC 29730')
  })

  // NULL, NOT '' — the caller falls back to the facility code, and it can only
  // do that if absence is distinguishable from a blank line.
  it('is null when there is nothing to say', () => {
    expect(formatAddress(null)).toBeNull()
    expect(formatAddress({})).toBeNull()
    expect(
      formatAddress({ addressLine1: null, city: null, state: null }),
    ).toBeNull()
  })

  // Whitespace-only columns exist in both exports; they are absence, not a
  // value, and `optionalText` is what makes them so.
  it('treats whitespace as absence rather than as a part', () => {
    expect(
      formatAddress({ addressLine1: '   ', city: 'Reno', state: 'NV' }),
    ).toBe('Reno, NV')
  })
})
