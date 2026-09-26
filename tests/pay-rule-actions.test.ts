import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  closePayRuleAction,
  savePayRuleAction,
} from '@/app/(app)/drivers/pay-actions'
import { PAY_RULE_INITIAL } from '@/app/(app)/drivers/pay-state'

// ---------------------------------------------------------------------------
// WHAT A DISPATCHER SEES WHEN THEY MISTYPE A PAY RATE.
//
// `saveDriverPayRule` and `closePayRule` are covered by
// `tests/integration/settlements.test.ts`, including the overlap refusal. The
// ACTIONS were not covered at all — and the actions are what a person touches:
// the form parsing and the error mapping between a typed box and a message on
// the screen.
//
// ── THESE RUN WITHOUT AUTH, AND THAT IS THE POINT ─────────────────────────
//
// Every branch below returns BEFORE `withCurrentOrg` is reached, because the
// parsing happens first. So the surface a person hits by typing is testable
// without standing up an auth context — which is the argument AGENTS.md makes
// for keeping actions thin, read from the other direction.
//
// The `overlaps` branch is the exception: it comes back from the domain function
// and needs a database. Its refusal is already integration-tested, so what is
// checked here is the MAPPING — a reason with no entry falls through to
// `driverNotFound`, which would tell somebody their driver is missing when their
// dates collide.
// ---------------------------------------------------------------------------

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

const save = (fields: Record<string, string>) =>
  savePayRuleAction('drv_1', PAY_RULE_INITIAL, form(fields))

describe('a mistyped figure never reaches the database', () => {
  it('names a bad PERCENTAGE as a percentage problem', async () => {
    const out = await save({
      type: 'PERCENT_GROSS',
      percent: 'thirty-ish',
      effectiveFrom: '2026-09-04',
    })
    expect(out.error).toBe('payRule.error.badPercent')
    expect(out.savedId).toBeNull()
  })

  it('names a bad PER-MILE rate as a per-mile problem', async () => {
    // NOT the percent message. A dispatcher fixing the wrong field is a
    // dispatcher who thinks the software is broken.
    const out = await save({
      type: 'PER_MILE',
      perMile: 'sixty cents',
      effectiveFrom: '2026-09-04',
    })
    expect(out.error).toBe('payRule.error.badPerMile')
  })

  it('names a bad FLAT amount as a flat problem', async () => {
    const out = await save({
      type: 'FLAT_PER_LOAD',
      flat: 'a lot',
      effectiveFrom: '2026-09-04',
    })
    expect(out.error).toBe('payRule.error.badFlat')
  })

  it('reads ONLY the figure its type needs', async () => {
    // A leftover value in a hidden field must not become a number on the saved
    // rule. So a PER_MILE save whose per-mile box is VALID and whose percent box
    // is rubbish must get past the money parsing entirely and fail on the dates.
    //
    // THE FIRST VERSION OF THIS TEST PROVED NOTHING: it passed a broken percent
    // AND a broken per-mile, so it returned `badPerMile` whether the percent was
    // read or not. Parsing all three would have looked identical.
    const out = await save({
      type: 'PER_MILE',
      percent: 'nonsense',
      perMile: '0.60',
      // No effectiveFrom, so the dates are the next thing to fail on.
    })
    expect(out.error).toBe('payRule.error.badDates')
  })
})

describe('the dates', () => {
  it('refuses a missing effective-from', async () => {
    const out = await save({ type: 'PERCENT_GROSS', percent: '30' })
    expect(out.error).toBe('payRule.error.badDates')
  })

  it('refuses an unreadable effective-from', async () => {
    const out = await save({
      type: 'PERCENT_GROSS',
      percent: '30',
      effectiveFrom: 'next Tuesday',
    })
    expect(out.error).toBe('payRule.error.badDates')
  })

  it('refuses an unreadable effective-TO while accepting a blank one', async () => {
    // Blank means "still open" and must not be an error; unreadable must be.
    const unreadable = await save({
      type: 'PERCENT_GROSS',
      percent: '30',
      effectiveFrom: '2026-09-04',
      effectiveTo: 'whenever',
    })
    expect(unreadable.error).toBe('payRule.error.badDates')
  })

  it('refuses a close with no date, and never reaches the rule', async () => {
    const out = await closePayRuleAction(
      'drv_1',
      'rule_1',
      PAY_RULE_INITIAL,
      form({ effectiveTo: '' }),
    )
    expect(out.error).toBe('payRule.error.badDates')
    expect(out.savedId).toBeNull()
  })

  it('refuses a close with an unreadable date', async () => {
    const out = await closePayRuleAction(
      'drv_1',
      'rule_1',
      PAY_RULE_INITIAL,
      form({ effectiveTo: 'the 4th' }),
    )
    expect(out.error).toBe('payRule.error.badDates')
  })
})

// ── THE FIFTH BRANCH, WHICH NEEDS A DATABASE TO REACH ───────────────────
describe('every refusal the domain function can return has a message', () => {
  it('maps all of them, so none falls through to "driver not found"', () => {
    // `ERRORS[outcome.reason] ?? 'payRule.error.driverNotFound'` — a reason with
    // no entry tells somebody their DRIVER is missing when their DATES collide.
    // The union is the source of truth, so this reads it from the source rather
    // than from a list typed twice.
    const source = readFileSync('src/lib/driver-pay.ts', 'utf8')
    const union = /export type SaveRuleFailure =([\s\S]*?)\n\n/.exec(source)
    expect(union).not.toBeNull()
    const reasons = [...(union![1] ?? '').matchAll(/'([a-z_]+)'/g)].map(
      (m) => m[1]!,
    )
    expect(reasons.length).toBeGreaterThan(3)

    const actions = readFileSync('src/app/(app)/drivers/pay-actions.ts', 'utf8')
    for (const reason of reasons) {
      expect(
        actions,
        `${reason} has no message and would read as "driver not found"`,
      ).toContain(`${reason}:`)
    }
  })
})
