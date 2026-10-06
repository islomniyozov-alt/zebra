import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  accessorialTypeFor,
  rateSplitFromMoney,
  storedMoneyOf,
} from '@/lib/rate-split'

// ---------------------------------------------------------------------------
// THE RATE FIELD IS THE LINE HAUL (§7.6, 2026-10-06, load 1177).
//
// Load 1177's own rate confirmation, as `parse.ts` stored it on dev — read
// back by scratchpad probe m68-probe.cjs, not retyped from memory:
//   linehaul 245000 · fuel 38750 · "Detention (2 hrs)" 12000 · total 295750
// Under the old reading all 295750 was line haul and a 30% rule paid $887.25;
// under this one the rule pays 30% of 245000 = $735.00.
// ---------------------------------------------------------------------------

const LOAD_1177 = {
  money: {
    totalCents: 295750,
    unreadable: [],
    totalAgrees: true,
    accessorials: [
      {
        cents: 12000,
        label: 'Detention (2 hrs)',
        printed: '$120.00',
        confidence: 'high',
      },
    ],
    linehaulCents: 245000,
    differenceCents: 0,
    fuelSurchargeCents: 38750,
  },
}

describe('the split a load takes from its rate con', () => {
  it('reads line haul, fuel and the accessorial lines apart — load 1177', () => {
    const split = rateSplitFromMoney(storedMoneyOf(LOAD_1177))
    expect(split).toEqual({
      linehaulCents: 245000,
      fuelSurchargeCents: 38750,
      accessorials: [
        { type: 'DETENTION', amountCents: 12000, label: 'Detention (2 hrs)' },
      ],
    })
    // THE TWO FIGURES THE RULING TURNED ON, from the split and not from a
    // belief about it: 30% of the line haul, 30% of the old reading.
    expect((split!.linehaulCents * 3000) / 10_000).toBe(73500)
    expect((295750 * 3000) / 10_000).toBe(88725)
  })

  it('takes nothing from a rate con that printed only a total', () => {
    // A total alone is not a line haul — that reading IS the defect.
    const money = storedMoneyOf({
      money: { ...LOAD_1177.money, linehaulCents: null, totalAgrees: null },
    })
    expect(rateSplitFromMoney(money)).toBeNull()
  })

  it('takes nothing from a split that does not add up to its total', () => {
    const money = storedMoneyOf({
      money: { ...LOAD_1177.money, totalAgrees: false, differenceCents: 500 },
    })
    expect(rateSplitFromMoney(money)).toBeNull()
  })

  it('reads a payload with no money, or a malformed one, as no money', () => {
    expect(storedMoneyOf(null)).toBeNull()
    expect(storedMoneyOf({ extracted: {} })).toBeNull()
    expect(storedMoneyOf({ money: 'not an object' })).toBeNull()
    // Strings where integers belong are not silently coerced.
    const odd = storedMoneyOf({
      money: { ...LOAD_1177.money, linehaulCents: '245000' },
    })
    expect(odd?.linehaulCents).toBeNull()
    expect(rateSplitFromMoney(odd)).toBeNull()
  })

  it("names the accessorial type from the rate con's own words, OTHER otherwise", () => {
    expect(accessorialTypeFor('Detention (2 hrs)')).toBe('DETENTION')
    expect(accessorialTypeFor('LAYOVER - weather')).toBe('LAYOVER')
    expect(accessorialTypeFor('TONU')).toBe('TONU')
    expect(accessorialTypeFor('Lumper fee')).toBe('LUMPER')
    expect(accessorialTypeFor('Extra stop (Toledo)')).toBe('EXTRA_STOP')
    expect(accessorialTypeFor('Driver assist unload')).toBe('DRIVER_ASSIST')
    expect(accessorialTypeFor('Redelivery')).toBe('REDELIVERY')
    expect(accessorialTypeFor('Storage 2 days')).toBe('STORAGE')
    expect(accessorialTypeFor('Fuel advance fee')).toBe('FUEL_ADVANCE_FEE')
    expect(accessorialTypeFor('Misc')).toBe('OTHER')
  })

  it('drops a zero or negative accessorial line rather than filing it', () => {
    const money = storedMoneyOf({
      money: {
        ...LOAD_1177.money,
        accessorials: [
          { cents: 0, label: 'Detention' },
          { cents: -500, label: 'Credit' },
          { cents: 12000, label: 'Detention (2 hrs)' },
        ],
      },
    })
    expect(rateSplitFromMoney(money)?.accessorials).toHaveLength(1)
  })
})

// ── THE TWO READERS OF THE RULE, HELD TO IT IN SOURCE ───────────────────────
describe('the form and the action read the ruling, not the total', () => {
  it('prefills the rate field from the line haul and nothing else', () => {
    const form = readFileSync(
      join('src', 'app', '(app)', 'loads', 'new', 'CreateLoadForm.tsx'),
      'utf8',
    )
    const body = form.slice(form.indexOf('function extractedRate('))
    const fn = body.slice(0, body.indexOf('\n}\n') + 3)
    expect(fn).toContain("'money.linehaul'")
    expect(fn).not.toContain("'money.total'")
  })

  it('takes the split from the lib, inside the create transaction', () => {
    const action = readFileSync(
      join('src', 'app', '(app)', 'loads', 'new', 'actions.ts'),
      'utf8',
    )
    expect(action).toContain("from '@/lib/rate-split'")
    expect(action).toMatch(/fuelSurchargeCents: split\.fuelSurchargeCents/)
    expect(action).toMatch(
      /for \(const line of split\?\.accessorials \?\? \[\]\)/,
    )
  })
})
