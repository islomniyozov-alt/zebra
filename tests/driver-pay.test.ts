import { describe, expect, it } from 'vitest'
import {
  amountFromSnapshot,
  isConcretePayRule,
  payFor,
  readSnapshot,
  ruleInForce,
  type PayRule,
  type PayableLoad,
} from '@/lib/driver-pay'
import {
  ENGLISH_BASIS,
  basisSentence,
  settlementPdfLines,
} from '@/lib/settlement-view'
import { percentOfCents } from '@/lib/money'

// ---------------------------------------------------------------------------
// WHAT A DRIVER IS OWED. The one calculation in this system whose output is a
// person's wages, so every case below is one somebody could check by hand.
//
// The load throughout is $2,450.00 linehaul + $380.00 fuel + $160.00 detention
// = $2,990.00 gross. Gross and linehaul differ by $540.00, which at 30% is
// $162.00 a load — the reason the two percentage rules are separate choices.
// ---------------------------------------------------------------------------

const LOAD: PayableLoad = {
  id: 'load-1',
  loadNumber: 'L-1042',
  linehaulCents: 245000,
  fuelSurchargeCents: 38000,
  accessorialsCents: 16000,
  totalRevenueCents: 299000,
  actualMiles: 1240,
  dispatchedMiles: 1210,
}

const rule = (over: Partial<PayRule> = {}): PayRule => ({
  id: 'rule-1',
  type: 'PERCENT_GROSS',
  percentBps: 3000,
  perMileCents: null,
  flatCents: null,
  effectiveFrom: new Date('2026-01-01'),
  effectiveTo: null,
  ...over,
})

describe('a percentage of what', () => {
  it('pays 30% of GROSS on the gross rule', () => {
    // 299000 x 0.30 = 89700 -> $897.00
    const result = payFor(LOAD, rule({ type: 'PERCENT_GROSS' }))
    expect(result).toMatchObject({ ok: true, amountCents: 89700 })
    if (!result.ok) return
    expect(result.snapshot).toMatchObject({
      basis: 299000,
      basisLabel: 'totalRevenueCents',
      percentBps: 3000,
    })
  })

  it('pays 30% of LINEHAUL on the linehaul rule — a different number', () => {
    // 245000 x 0.30 = 73500 -> $735.00. The $162.00 gap is the whole reason
    // these are two named choices instead of one "percentage" field.
    const result = payFor(LOAD, rule({ type: 'PERCENT_LINEHAUL' }))
    expect(result).toMatchObject({ ok: true, amountCents: 73500 })
    if (!result.ok) return
    expect(result.snapshot.basisLabel).toBe('linehaulCents')
    expect(89700 - 73500).toBe(16200)
  })

  it('rounds a percentage half up, once', () => {
    // 27.5% of $1,000.01: 100001 x 2750 / 10000 = 27500.275 -> 27500.
    // And a basis where the half is exact: 33.33% of $1.50 is 0.49995 -> 50.
    expect(percentOfCents(100001, 2750)).toBe(27500)
    expect(percentOfCents(150, 3333)).toBe(50)
  })

  it('never multiplies where it should take a fraction', () => {
    // The bug this file caught during Step 6: routing the percentage through
    // `multiplyCents` paid 30 TIMES the load rather than 30 percent of it.
    // $897.00, not $89,700.00 — a hundredfold error that reads as plausible
    // until you notice the currency.
    const result = payFor(LOAD, rule())
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(result.amountCents).toBeLessThan(LOAD.totalRevenueCents)
  })
})

describe('the other two rules', () => {
  it('pays per mile from ACTUAL miles when the load has them', () => {
    // 1240 x $0.58 = $719.20
    const result = payFor(
      LOAD,
      rule({ type: 'PER_MILE', percentBps: null, perMileCents: 58 }),
    )
    expect(result).toMatchObject({ ok: true, amountCents: 71920 })
    if (!result.ok) return
    expect(result.snapshot.basisLabel).toBe('actualMiles')
  })

  it('falls back to dispatched miles, and says which it used', () => {
    // 1210 x $0.58 = $701.80. The label is what lets a driver see that the
    // figure came from the planned distance rather than the run one.
    const result = payFor(
      { ...LOAD, actualMiles: null },
      rule({ type: 'PER_MILE', percentBps: null, perMileCents: 58 }),
    )
    expect(result).toMatchObject({ ok: true, amountCents: 70180 })
    if (!result.ok) return
    expect(result.snapshot.basisLabel).toBe('dispatchedMiles')
  })

  it('refuses a per-mile load with no miles at all', () => {
    // Rather than paying zero. Zero is a number that looks like an answer.
    expect(
      payFor(
        { ...LOAD, actualMiles: null, dispatchedMiles: null },
        rule({ type: 'PER_MILE', percentBps: null, perMileCents: 58 }),
      ),
    ).toEqual({ ok: false, reason: 'no_miles' })
  })

  it('pays a flat rate whatever the load is worth', () => {
    const result = payFor(
      LOAD,
      rule({ type: 'FLAT_PER_LOAD', percentBps: null, flatCents: 45000 }),
    )
    expect(result).toMatchObject({ ok: true, amountCents: 45000 })
  })
})

describe('what is refused', () => {
  it('refuses CUSTOM in words rather than evaluating anything', () => {
    // The schema carries a CUSTOM member and an `expression` column. Paying a
    // person by evaluating a string is a calculator nobody reviewed.
    expect(payFor(LOAD, rule({ type: 'CUSTOM' }))).toEqual({
      ok: false,
      reason: 'custom_unsupported',
    })
    expect(isConcretePayRule('CUSTOM')).toBe(false)
  })

  it('refuses a load with no rule at all', () => {
    expect(payFor(LOAD, null)).toEqual({ ok: false, reason: 'no_rule' })
  })

  it('refuses a rule missing the figure its own type needs', () => {
    expect(payFor(LOAD, rule({ percentBps: null }))).toEqual({
      ok: false,
      reason: 'rule_incomplete',
    })
    expect(payFor(LOAD, rule({ type: 'PER_MILE', percentBps: null }))).toEqual({
      ok: false,
      reason: 'rule_incomplete',
    })
  })
})

describe('which rule was in force', () => {
  const january = rule({
    id: 'jan',
    percentBps: 2800,
    effectiveFrom: new Date('2026-01-01'),
    effectiveTo: new Date('2026-05-31'),
  })
  const june = rule({
    id: 'jun',
    percentBps: 3000,
    effectiveFrom: new Date('2026-06-01'),
  })

  it('picks the rule covering the day, not the newest one', () => {
    // A load delivered in March is paid at March's rate even though the raise
    // landed in June. This is the whole point of rules being a history.
    expect(ruleInForce([january, june], new Date('2026-03-15'))?.id).toBe('jan')
    expect(ruleInForce([january, june], new Date('2026-07-15'))?.id).toBe('jun')
  })

  it('has no answer before the first rule starts', () => {
    expect(ruleInForce([january, june], new Date('2025-12-31'))).toBeNull()
  })

  it('is inclusive of both ends of a closed rule', () => {
    expect(ruleInForce([january], new Date('2026-01-01'))?.id).toBe('jan')
    expect(ruleInForce([january], new Date('2026-05-31'))?.id).toBe('jan')
  })

  it('takes the later start where two overlap', () => {
    // Overlaps are refused at entry, but a stale row from before that refusal
    // existed must not silently pay the older rate.
    const stale = rule({ id: 'stale', effectiveFrom: new Date('2020-01-01') })
    expect(ruleInForce([stale, january], new Date('2026-03-15'))?.id).toBe(
      'jan',
    )
  })
})

describe('a settlement reproduces from its own snapshot', () => {
  it('recomputes every rule type from the snapshot alone', () => {
    const cases: PayRule[] = [
      rule({ type: 'PERCENT_GROSS', percentBps: 3000 }),
      rule({ type: 'PERCENT_LINEHAUL', percentBps: 2750 }),
      rule({ type: 'PER_MILE', percentBps: null, perMileCents: 58 }),
      rule({ type: 'FLAT_PER_LOAD', percentBps: null, flatCents: 45000 }),
    ]
    for (const each of cases) {
      const result = payFor(LOAD, each)
      expect(result.ok, each.type).toBe(true)
      if (!result.ok) continue
      // No lookup of the rule — this is what "reproduces exactly" means when
      // the rule has since been changed or deleted.
      expect(amountFromSnapshot(result.snapshot), each.type).toBe(
        result.amountCents,
      )
    }
  })

  it('survives the round trip through a JSON column', () => {
    const result = payFor(LOAD, rule())
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const stored = JSON.parse(JSON.stringify(result.snapshot))
    const read = readSnapshot(stored)
    expect(read).not.toBeNull()
    expect(amountFromSnapshot(read!)).toBe(89700)
  })

  it('reads nothing out of a column holding something else', () => {
    for (const junk of [null, 42, 'text', [], { ruleId: 'x' }]) {
      expect(readSnapshot(junk as never)).toBeNull()
    }
  })
})

describe('the working, as a sentence', () => {
  it('names the basis so a driver can check the figure', () => {
    const gross = payFor(LOAD, rule({ type: 'PERCENT_GROSS' }))
    const linehaul = payFor(LOAD, rule({ type: 'PERCENT_LINEHAUL' }))
    expect(gross.ok && basisSentence(gross.snapshot, 'en-US')).toBe(
      '30% of $2,990.00 gross',
    )
    expect(linehaul.ok && basisSentence(linehaul.snapshot, 'en-US')).toBe(
      '30% of $2,450.00 linehaul',
    )
  })

  it('renders a fractional percentage without a trailing zero', () => {
    const result = payFor(LOAD, rule({ percentBps: 2750 }))
    expect(result.ok && basisSentence(result.snapshot, 'en-US')).toBe(
      '27.5% of $2,990.00 gross',
    )
  })

  it('says when the miles were the planned ones', () => {
    const result = payFor(
      { ...LOAD, actualMiles: null },
      rule({ type: 'PER_MILE', percentBps: null, perMileCents: 58 }),
    )
    expect(result.ok && basisSentence(result.snapshot, 'en-US')).toBe(
      '1,210 dispatched mi at $0.58',
    )
  })

  it('puts the words where each language puts them', () => {
    // The RTL defect this template machinery exists for. Glued English words
    // around mirrored figures rendered "of $2,450.00 gross 30%" on the Farsi
    // settlement screen; a template per language puts them in order.
    const result = payFor(LOAD, rule({ type: 'PERCENT_LINEHAUL' }))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const russian = basisSentence(result.snapshot, 'ru-RU', {
      ...ENGLISH_BASIS,
      percentLinehaul: '{percent} от {amount} основной ставки',
    })
    expect(russian.startsWith('30% от')).toBe(true)
    expect(russian.endsWith('основной ставки')).toBe(true)
    // And no English survives into it.
    expect(russian).not.toContain('of')
    expect(russian).not.toContain('linehaul')
  })

  it('leaves the PDF in English, because base-14 fonts cannot draw the rest', () => {
    const result = payFor(LOAD, rule())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(
      settlementPdfLines([
        {
          type: 'LOAD_PAY',
          description: 'Load pay',
          amountCents: result.amountCents,
          payRuleSnapshot: JSON.parse(JSON.stringify(result.snapshot)),
          load: { loadNumber: 'L-1042' },
        },
      ])[0]!.basis,
    ).toBe('30% of $2,990.00 gross')
  })
})
