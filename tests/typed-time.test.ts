import { describe, expect, it } from 'vitest'
import { normalizeTypedTime } from '@/lib/typed-date'

// The appointment half of the typed-date convention (Phase 6, the window gap).

describe('a typed time', () => {
  it('takes the shortest thing a dispatcher would type', () => {
    expect(normalizeTypedTime('8')).toBe('08:00')
    expect(normalizeTypedTime('19')).toBe('19:00')
    expect(normalizeTypedTime('830')).toBe('08:30')
    expect(normalizeTypedTime('1830')).toBe('18:30')
  })

  it('and the forms a document prints', () => {
    expect(normalizeTypedTime('08:00')).toBe('08:00')
    expect(normalizeTypedTime('0800')).toBe('08:00')
    expect(normalizeTypedTime(' 16:30 ')).toBe('16:30')
  })

  it('is 24-hour, because every appointment in the corpus is', () => {
    // `7` is seven in the morning. Somebody who means the evening types 19 —
    // which is what removes the ambiguity this field exists to remove.
    expect(normalizeTypedTime('7')).toBe('07:00')
    expect(normalizeTypedTime('23:59')).toBe('23:59')
  })

  it('refuses a time that is not one, rather than inventing a near miss', () => {
    // Rule 5 of EXTRACTION-CONTRACT.md one layer down: a malformed value is
    // reported, not repaired. `2500` is not half past midnight.
    expect(normalizeTypedTime('2500')).toBeNull()
    expect(normalizeTypedTime('0870')).toBeNull()
    expect(normalizeTypedTime('99999')).toBeNull()
    expect(normalizeTypedTime('')).toBeNull()
    expect(normalizeTypedTime('later')).toBeNull()
  })
})
