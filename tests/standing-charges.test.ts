import { describe, expect, it } from 'vitest'
import {
  scopeCovers,
  standingRulesFor,
  STANDING_SCOPES,
  type StandingChargeRule,
  type StandingExemption,
} from '../src/lib/standing-charges'
import { computeDeductions } from '../src/lib/deductions'

// ---------------------------------------------------------------------------
// STANDING CHARGES — SELECTION, NOT ARITHMETIC (§6.2.4).
//
// `standing-charges.ts` decides WHICH charges reach a driver and hands them to
// `computeDeductions`, which already has its own suite over the six real
// statements. So this file tests the selection, and then tests ONCE that the
// handover produces a line — because a selection that returned the right rules
// into a shape the engine ignored would pass every test above it.
// ---------------------------------------------------------------------------

const WEEK = {
  start: new Date(Date.UTC(2026, 7, 9)),
  end: new Date(Date.UTC(2026, 7, 15)),
}

const charge = (
  over: Partial<StandingChargeRule> = {},
): StandingChargeRule => ({
  id: 'sc-1',
  type: 'Admin Fee',
  description: null,
  amountCents: 3500,
  cadence: 'WEEKLY',
  appliesTo: 'ALL',
  effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
  effectiveTo: null,
  ...over,
})

const driver = (over: Record<string, unknown> = {}) => ({
  id: 'd-1',
  driverType: 'COMPANY_DRIVER',
  hasFreight: true,
  ...over,
})

describe('the scope decides who a charge reaches', () => {
  it('ALL covers every ownership type', () => {
    for (const type of ['COMPANY_DRIVER', 'LEASE_OPERATOR', 'OWNER_OPERATOR']) {
      expect(scopeCovers('ALL', type), type).toBe(true)
    }
  })

  it('a named scope covers only its own type', () => {
    expect(scopeCovers('OWNER_OPERATOR', 'OWNER_OPERATOR')).toBe(true)
    expect(scopeCovers('OWNER_OPERATOR', 'COMPANY_DRIVER')).toBe(false)
    expect(scopeCovers('COMPANY_DRIVER', 'LEASE_OPERATOR')).toBe(false)
  })

  // THE SCOPE HAS FOUR VALUES AND §6.2.4 NAMED TWO. `LEASED` is the one it
  // left out, and a two-choice scope would have made it unreachable by
  // anything but ALL — which is the divergence flagged in PHASE-5-BRIEF §7.
  it('LEASED is a scope of its own, not a kind of company driver', () => {
    expect(STANDING_SCOPES).toContain('LEASE_OPERATOR')
    expect(scopeCovers('COMPANY_DRIVER', 'LEASE_OPERATOR')).toBe(false)
    expect(scopeCovers('LEASE_OPERATOR', 'LEASE_OPERATOR')).toBe(true)
  })

  // AN UNRECOGNISED SCOPE MATCHES NOTHING. A typo in the column that decides
  // who gets charged should undercharge and be noticed, never overcharge and be
  // discovered on a statement.
  it('an unrecognised scope reaches nobody rather than everybody', () => {
    expect(scopeCovers('OWNER-OPERATOR', 'OWNER_OPERATOR')).toBe(false)
    expect(scopeCovers('', 'OWNED')).toBe(false)
    expect(scopeCovers('all', 'OWNED')).toBe(false)
  })
})

describe('the charge follows the work', () => {
  // §6.2.4's load-bearing sentence. Billing an admin fee for a week somebody
  // did not drive is a deduction against zero earnings, which lands as a
  // negative net on a document handed to a person.
  it('a driver with no freight that week gets no line', () => {
    const rules = standingRulesFor({
      charges: [charge()],
      exemptions: [],
      driver: driver({ hasFreight: false }),
    })
    expect(rules).toEqual([])
  })

  it('and the same driver with freight gets one', () => {
    const rules = standingRulesFor({
      charges: [charge()],
      exemptions: [],
      driver: driver({ hasFreight: true }),
    })
    expect(rules).toHaveLength(1)
    expect(rules[0]?.type).toBe('Admin Fee')
  })
})

describe('an exemption is a row, and it only exempts its own driver', () => {
  const exemption: StandingExemption = {
    standingChargeId: 'sc-1',
    driverId: 'd-1',
    reason: 'pays Ifta through the lease',
  }

  it('the exempt driver gets nothing', () => {
    expect(
      standingRulesFor({
        charges: [charge()],
        exemptions: [exemption],
        driver: driver({ id: 'd-1' }),
      }),
    ).toEqual([])
  })

  // THE BUG THIS CATCHES is an exemption set built without filtering by driver:
  // one driver's exemption would then silently exempt the whole fleet, and the
  // charge would simply stop appearing on forty statements.
  it('every other driver still gets the charge', () => {
    expect(
      standingRulesFor({
        charges: [charge()],
        exemptions: [exemption],
        driver: driver({ id: 'd-2' }),
      }),
    ).toHaveLength(1)
  })

  it('and an exemption on one charge does not reach another', () => {
    const rules = standingRulesFor({
      charges: [charge(), charge({ id: 'sc-2', type: 'Ifta' })],
      exemptions: [exemption],
      driver: driver({ id: 'd-1' }),
    })
    expect(rules.map((rule) => rule.type)).toEqual(['Ifta'])
  })
})

describe('what it hands the engine', () => {
  // NO TARGET AND NO MONTHLY TOTAL. A target is a per-driver balance and an
  // org-wide one would race between two statements refreshed at once; the
  // monthly split has no column. Both null, deliberately.
  it('carries no target and no monthly total', () => {
    const rules = standingRulesFor({
      charges: [charge({ cadence: 'MONTHLY_SPLIT_WEEKLY' })],
      exemptions: [],
      driver: driver(),
    })
    expect(rules[0]?.targetCents).toBeNull()
    expect(rules[0]?.monthlyTotalCents).toBeNull()
  })

  // THE HANDOVER ITSELF. The engine decides in-force, pricing and sign; a
  // selection that returned correct rules in a shape `computeDeductions`
  // ignored would pass every test above this one.
  it('and the engine turns them into a signed line', () => {
    const result = computeDeductions({
      period: WEEK,
      rules: standingRulesFor({
        charges: [charge({ amountCents: 3500 })],
        exemptions: [],
        driver: driver(),
      }),
      charges: [],
      escrowHeldCents: 0,
    })
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0]?.totalCents).toBe(-3500)
    expect(result.totalCents).toBe(-3500)
    expect(result.omitSection).toBe(false)
  })

  // IN FORCE IS THE ENGINE'S DECISION, AGAINST THE SETTLEMENT'S OWN PERIOD —
  // never against today. A rule that starts in November must not print on an
  // August statement, and a run rebuilding August must use August's rules.
  it('a charge that starts after the period prints nothing', () => {
    const result = computeDeductions({
      period: WEEK,
      rules: standingRulesFor({
        charges: [charge({ effectiveFrom: new Date(Date.UTC(2026, 10, 1)) })],
        exemptions: [],
        driver: driver(),
      }),
      charges: [],
      escrowHeldCents: 0,
    })
    expect(result.lines).toEqual([])
    expect(result.omitSection).toBe(true)
  })

  it('and one that ended before it prints nothing either', () => {
    const result = computeDeductions({
      period: WEEK,
      rules: standingRulesFor({
        charges: [charge({ effectiveTo: new Date(Date.UTC(2026, 5, 30)) })],
        exemptions: [],
        driver: driver(),
      }),
      charges: [],
      escrowHeldCents: 0,
    })
    expect(result.lines).toEqual([])
  })
})
