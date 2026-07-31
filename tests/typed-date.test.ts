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
