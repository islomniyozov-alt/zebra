import { describe, expect, it } from 'vitest'
import { normalizeTypedDate, utcMidnight } from '@/lib/typed-date'

// The forty-second target turned on this. `<input type="date">` costs three
// tab stops per date, and the first timed run put every keystroke after the
// pickup date into the wrong field — the load saved with a delivery date in
// the year 1, and §8 then refused every later load as overlapping, because a
// load with no usable window overlaps everything.

const TODAY = new Date(Date.UTC(2026, 6, 31))

describe('dates a dispatcher can type', () => {
  it.each([
    ['810', '2026-08-10'],
    ['8/10', '2026-08-10'],
    ['08/10', '2026-08-10'],
    ['0810', '2026-08-10'],
    ['08/10/26', '2026-08-10'],
    ['08/10/2026', '2026-08-10'],
    ['08-10-2026', '2026-08-10'],
    ['2026-08-10', '2026-08-10'],
    ['  8/10  ', '2026-08-10'],
    // Three digits: the shortest form worth optimising for.
    ['131', '2026-01-31'],
  ])('parses %s', (typed, expected) => {
    expect(normalizeTypedDate(typed, TODAY)).toBe(expected)
  })

  it.each([
    ['', 'empty'],
    ['tomorrow', 'words'],
    ['13/40', 'no such month or day'],
    ['0231', 'the 31st of February'],
    ['02/31/2026', 'the same, written out'],
    ['1899-01-01', 'out of range'],
    ['99', 'too few digits to mean anything'],
  ])('refuses %s (%s)', (typed) => {
    // Refused, not guessed. A date this form invents is a load that shows up
    // on the wrong day, and §8 then treats it as overlapping everything.
    expect(normalizeTypedDate(typed, TODAY)).toBeNull()
  })

  // §0 RULE 14 (v11.45). Reproduced on dev 2026-11-23: an expiry typed
  // `2/18/2027` on the compliance panel answered "Enter the expiry date.",
  // because the separators were thrown away before the digits were counted.
  it.each([
    ['2/18/2027', '2027-02-18'],
    ['2/18/26', '2026-02-18'],
    ['2/8/27', '2027-02-08'],
    ['2.18.26', '2026-02-18'],
    ['2-18-2027', '2027-02-18'],
    ['12/5', '2026-12-05'],
    ['12/5/2026', '2026-12-05'],
  ])(
    'takes a one-digit month or day with a separator: %s',
    (typed, expected) => {
      expect(normalizeTypedDate(typed, TODAY)).toBe(expected)
    },
  )

  it('reads 12/5 as the 5th of December, not the 25th of January', () => {
    // The digit path read `12/5` as `125`. Its own digit form still means
    // what it always meant.
    expect(normalizeTypedDate('12/5', TODAY)).toBe('2026-12-05')
    expect(normalizeTypedDate('125', TODAY)).toBe('2026-01-25')
  })

  it.each([
    ['2/18/202', 'a three-digit year'],
    ['2/18/2027/1', 'four parts'],
    ['123/4', 'a three-digit month'],
    ['2/30/2027', 'the 30th of February'],
  ])('refuses a separated date it cannot vouch for: %s (%s)', (typed) => {
    expect(normalizeTypedDate(typed, TODAY)).toBeNull()
  })

  it('rolls nothing into the next month', () => {
    // `new Date(2026, 1, 31)` is the 3rd of March in JavaScript. Accepting
    // that would silently move a delivery a month.
    expect(normalizeTypedDate('02/31/2026', TODAY)).toBeNull()
    expect(normalizeTypedDate('02/28/2026', TODAY)).toBe('2026-02-28')
  })

  it('lands at UTC midnight, so a date-only field carries no timezone', () => {
    // §8, and design-system rule 3's other half: an appointment time renders in
    // the stop's zone, a DATE has no zone at all. Local midnight would make
    // this the 9th for everyone west of Greenwich.
    expect(utcMidnight('2026-08-10').toISOString()).toBe(
      '2026-08-10T00:00:00.000Z',
    )
  })
})
