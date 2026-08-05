import { describe, expect, it } from 'vitest'
import { apportionCents, centsToInput, factoringSplit } from '@/lib/money'

// ---------------------------------------------------------------------------
// The two calculations a factoring screen can get plausibly wrong.
//
// A fee that apportions to one cent less than it charged makes per-load
// profitability quietly wrong on every factored load forever, and nothing
// complains. So the invariant — the parts sum to the whole — is asserted on
// every case here, including the awkward ones.
// ---------------------------------------------------------------------------

describe('apportioning a fee across the loads it covers', () => {
  it('splits a fee that does not divide evenly, and loses nothing', () => {
    // Three loads: $2,450.00, $1,900.00, $1,625.00 — weights totalling 597500.
    // A $150.75 fee -> 15075 cents. Worked from the actual numerators rather
    // than from memory; my first version of this comment had all three shares
    // slightly wrong and the test caught it, which is the argument for putting
    // the arithmetic in the comment at all.
    //
    //   exact shares  6181.3808   4793.7238   4099.8954
    //   floors        6181        4793        4099      = 15073, leftover 2
    //   remainders    227500      432500      535000
    //   the two largest remainders take a cent each: third, then second
    //   result        6181        4794        4100      = 15075
    const parts = apportionCents(15075, [245000, 190000, 162500])
    expect(parts).toEqual([6181, 4794, 4100])
    expect(parts.reduce((sum, part) => sum + part, 0)).toBe(15075)
  })

  it('sums to the whole for every split it is given', () => {
    // The invariant, over shapes chosen to be awkward rather than tidy.
    const cases: Array<[number, number[]]> = [
      [15075, [245000, 190000, 162500]],
      [1, [1, 1, 1]],
      [2, [1, 1, 1]],
      [100, [1, 1, 1]],
      [9999, [1, 2, 3, 4, 5, 6, 7]],
      [5, [100000, 1]],
      [123457, [3, 3, 3, 3, 3, 3, 3]],
    ]
    for (const [total, weights] of cases) {
      const parts = apportionCents(total, weights)
      expect(parts.reduce((sum, part) => sum + part, 0)).toBe(total)
      expect(parts).toHaveLength(weights.length)
    }
  })

  it('is deterministic — the same split every time it is recomputed', () => {
    // The drift check compares stored shares against a recomputation. If the
    // split wandered on ties, the check would report drift that is only the
    // arithmetic disagreeing with itself.
    const once = apportionCents(100, [1, 1, 1])
    for (let index = 0; index < 20; index++) {
      expect(apportionCents(100, [1, 1, 1])).toEqual(once)
    }
    // Ties break by position, so the leftover lands on the earliest parts.
    expect(once).toEqual([34, 33, 33])
  })

  it('gives a single load the whole fee', () => {
    expect(apportionCents(15075, [502500])).toEqual([15075])
  })

  it('handles a zero fee and a zero-weight invoice without losing money', () => {
    expect(apportionCents(0, [100, 200])).toEqual([0, 0])
    // Loads totalling nothing is a data problem; dropping the fee would hide
    // it, so it lands on the first part where somebody will see it.
    expect(apportionCents(500, [0, 0])).toEqual([500, 0])
  })

  it('carries a credit the same way it carries a charge', () => {
    const parts = apportionCents(-15075, [245000, 190000, 162500])
    expect(parts.reduce((sum, part) => sum + part, 0)).toBe(-15075)
  })
})

describe('what the factor advances, charges and holds', () => {
  it('a worked example, checked by hand', () => {
    // $5,025.00 invoice, 97% advance, 3% fee — Triumph's usual shape.
    //   advance  5025.00 x 0.97 = 4874.25  -> 487425
    //   fee      5025.00 x 0.03 =  150.75  ->  15075
    //   reserve  what is left            ->     0
    const split = factoringSplit(502500, 9700, 300)
    expect(split.advanceCents).toBe(487425)
    expect(split.feeCents).toBe(15075)
    expect(split.reserveCents).toBe(0)
    expect(centsToInput(split.advanceCents)).toBe('4874.25')
    expect(centsToInput(split.feeCents)).toBe('150.75')
  })

  it('holds a reserve when the advance and fee do not consume the invoice', () => {
    // 90% advance, 3% fee leaves a 7% reserve the factor releases on payment.
    //   advance 4522.50, fee 150.75, reserve 351.75
    const split = factoringSplit(502500, 9000, 300)
    expect(split.advanceCents).toBe(452250)
    expect(split.feeCents).toBe(15075)
    expect(split.reserveCents).toBe(35175)
    expect(centsToInput(split.reserveCents)).toBe('351.75')
  })

  it('always sums to the invoice, including where the rates round', () => {
    // The reserve is what is LEFT rather than a third rounding, which is what
    // makes this true by construction instead of by luck.
    for (const total of [1, 7, 99, 12345, 502500, 999999]) {
      for (const [advance, fee] of [
        [9700, 300],
        [9000, 300],
        [8500, 275],
        [10000, 0],
      ]) {
        const split = factoringSplit(total, advance!, fee!)
        expect(split.advanceCents + split.feeCents + split.reserveCents).toBe(
          total,
        )
      }
    }
  })

  it('a one-cent invoice does not invent money', () => {
    const split = factoringSplit(1, 9700, 300)
    expect(split.advanceCents + split.feeCents + split.reserveCents).toBe(1)
  })
})
