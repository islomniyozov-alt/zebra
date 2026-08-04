import { describe, expect, it } from 'vitest'
import {
  MoneyFormatError,
  formatCents,
  centsToInput,
  loadRevenueCents,
  multiplyCents,
  parseMoneyToCents,
  parseQuantityToHundredths,
} from '@/lib/money'

// ---------------------------------------------------------------------------
// Phase 3 §0: "the likeliest failure in this phase is not sprawl — it's a
// financial calculation that is PLAUSIBLE." So every case below is one a
// person can check by hand, and the awkward ones are the point.
// ---------------------------------------------------------------------------

describe('parsing what a dispatcher types', () => {
  it.each([
    ['1234.56', 123456],
    ['$1,234.56', 123456],
    ['  2450 ', 245000],
    ['2450.', 245000],
    ['.5', 50],
    ['0.05', 5],
    ['-40', -4000],
    ['-1,234.56', -123456],
  ])('%s -> %i cents', (input, cents) => {
    expect(parseMoneyToCents(input)).toBe(cents)
  })

  it('does not go through a float', () => {
    // Measured on this machine rather than asserted from memory — my first
    // attempt used 1234.56, which multiplies out exactly and proved nothing:
    //
    //   19.99 * 100 -> 1998.9999999999998
    //    8.20 * 100 ->  819.9999999999999
    //    4.35 * 100 ->  434.99999999999994
    //
    // `Math.round` papers over all three, until a value where it does not.
    // The parser never gets there: no float exists in it.
    expect(Number.isInteger(Number('19.99') * 100)).toBe(false)
    expect(Number.isInteger(Number('4.35') * 100)).toBe(false)

    expect(parseMoneyToCents('19.99')).toBe(1999)
    expect(parseMoneyToCents('8.20')).toBe(820)
    expect(parseMoneyToCents('4.35')).toBe(435)
  })

  it('truncates a third decimal rather than inventing a cent', () => {
    // A third place in a typed rate is a typo. Rounding it would be this
    // module deciding something the person did not.
    expect(parseMoneyToCents('10.999')).toBe(1099)
    expect(parseMoneyToCents('10.991')).toBe(1099)
  })

  it.each(['', '   ', 'abc', '12.34.56', '1e3', '$', '--5', '1,2,3.4.5'])(
    'refuses %s rather than guessing',
    (input) => {
      expect(() => parseMoneyToCents(input)).toThrow(MoneyFormatError)
    },
  )

  it('round-trips through the input format', () => {
    for (const cents of [0, 5, 99, 100, 123456, -4000, -1]) {
      expect(parseMoneyToCents(centsToInput(cents))).toBe(cents)
    }
  })

  it('formats the cents column with both digits', () => {
    expect(centsToInput(5)).toBe('0.05')
    expect(centsToInput(100)).toBe('1.00')
    expect(centsToInput(-1)).toBe('-0.01')
  })
})

describe('quantity times unit price — the only rounding in the system', () => {
  it('2.5 hours of detention at $65.00 is $162.50', () => {
    // 250 hundredths x 6500 cents = 1,625,000 hundredths of a cent
    // 1,625,000 / 100 = 16,250 cents exactly. No rounding needed.
    expect(multiplyCents('2.5', 6500)).toBe(16250)
  })

  it('3 x $16.67 is $50.01, not $50.00', () => {
    // 300 x 1667 = 500,100 hundredths -> 5,001 cents.
    expect(multiplyCents('3', 1667)).toBe(5001)
  })

  it('rounds a half cent UP', () => {
    // 0.5 x 1 cent = 50 hundredths. Half up -> 1 cent.
    expect(multiplyCents('0.5', 1)).toBe(1)
    // 0.49 x 1 cent = 49 hundredths -> 0 cents.
    expect(multiplyCents('0.49', 1)).toBe(0)
  })

  it('rounds a credit the mirror of its charge', () => {
    // The pair that banker's rounding would break: a -0.5 cent credit must
    // reverse a +0.5 cent charge exactly, or a reversed invoice leaves a cent
    // behind and somebody spends an afternoon on it.
    expect(multiplyCents('0.5', 1)).toBe(1)
    expect(multiplyCents('-0.5', 1)).toBe(-1)
    expect(multiplyCents('0.5', 1) + multiplyCents('-0.5', 1)).toBe(0)
  })

  it('truncates a quantity beyond two places, matching Decimal(10,2)', () => {
    // The column is Decimal(10,2); a third place cannot be stored, so it must
    // not change the arithmetic either.
    expect(parseQuantityToHundredths('0.333')).toBe(33)
    expect(multiplyCents('0.333', 100)).toBe(33)
  })

  it('a worked invoice line, checked by hand', () => {
    // Detention 2.5h @ $65.00 = $162.50
    // Lumper    1   @ $125.00 = $125.00
    // Linehaul  1   @ $2,450.00 = $2,450.00
    //                             ---------
    //                             $2,737.50 -> 273750 cents
    const lines = [
      multiplyCents('2.5', 6500),
      multiplyCents('1', 12500),
      multiplyCents('1', 245000),
    ]
    expect(lines).toEqual([16250, 12500, 245000])
    expect(lines.reduce((total, line) => total + line, 0)).toBe(273750)
    expect(centsToInput(273750)).toBe('2737.50')
  })
})

describe('what a load is worth', () => {
  it('is the three stored integers, added', () => {
    expect(
      loadRevenueCents({
        linehaulCents: 245000,
        fuelSurchargeCents: 38000,
        accessorialsCents: 16250,
      }),
    ).toBe(299250)
  })

  it('is reproducible by a reader from the stored columns', () => {
    // §7's rule, as an assertion: 2450.00 + 380.00 + 162.50 = 2992.50
    expect(centsToInput(299250)).toBe('2992.50')
  })
})

describe('display', () => {
  it('renders a minus sign, not parentheses (design system §8)', () => {
    expect(formatCents(-4000, 'en-US')).toBe('-$40.00')
    expect(formatCents(-4000, 'en-US')).not.toContain('(')
  })

  it('always shows both cents digits', () => {
    expect(formatCents(245000, 'en-US')).toBe('$2,450.00')
    expect(formatCents(5, 'en-US')).toBe('$0.05')
  })
})
