import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { utcTimestampParam } from '@/lib/sql-params'

// ---------------------------------------------------------------------------
// A WINDOW THAT MOVES WITH THE MACHINE IT RUNS ON.
//
// `occurredAt` is TIMESTAMP(3) — no zone — and Prisma writes UTC into it. A
// script that reaches for `pg` directly and passes a JS `Date` gets it
// serialised in the process's local zone, so the comparison silently shifts.
//
// On 2026-09-25 `settlement-week-preflight.ts` reported 177 loads reaching
// POD_RECEIVED for 2026-09-13..19. The real number was 181: its window ended
// at 19:59:59.999Z instead of 23:59:59.999Z on a UTC-4 machine, and the four
// loads delivered in that gap were invisible to the gate whose job is to say
// whether the week is clear.
//
// THE FAILURE IS MACHINE-DEPENDENT, which is worse than a wrong number. In UTC
// nothing is lost, so it passes for whoever writes it and fails for whoever
// runs it — and it fails at the END of the period, where a week's freight sits.
// ---------------------------------------------------------------------------

describe('binding an instant to a timestamp column with no zone', () => {
  it('renders the UTC wall clock, not the local one', () => {
    expect(utcTimestampParam(new Date('2026-09-19T23:59:59.999Z'))).toBe(
      '2026-09-19 23:59:59.999',
    )
    expect(utcTimestampParam(new Date('2026-09-13T00:00:00.000Z'))).toBe(
      '2026-09-13 00:00:00.000',
    )
  })

  it('keeps the last millisecond of the period, which is where the bug bit', () => {
    // The end of the window is the whole point: a period end is inclusive and
    // the loads that fall off it are the ones delivered on the last evening.
    const end = new Date('2026-09-19T23:59:59.999Z')
    expect(utcTimestampParam(end).endsWith('23:59:59.999')).toBe(true)
  })

  it('is a STRING, because a Date is what node-postgres mistranslates', () => {
    // Not a style point. The type is the fix: there is no zone left in a naive
    // string for anything downstream to convert.
    expect(typeof utcTimestampParam(new Date())).toBe('string')
  })

  it('carries no zone marker at all — no Z, no offset, no T', () => {
    const rendered = utcTimestampParam(new Date('2026-09-19T23:59:59.999Z'))
    expect(rendered).not.toContain('Z')
    expect(rendered).not.toContain('T')
    expect(rendered).not.toMatch(/[+-]\d{2}:\d{2}$/)
  })

  it('refuses an invalid date rather than rendering "Invalid Date"', () => {
    expect(() => utcTimestampParam(new Date('nonsense'))).toThrow(/not a date/)
  })

  // ── AND THE PREFLIGHT USES IT, EVERYWHERE ───────────────────────────────
  it('is what the preflight binds, with no raw Date left', () => {
    // The rule being right is worth nothing if one of the five query sites
    // still passes the Date. This is the guard that caught the undated POD
    // event: count the call sites, do not assert one exists somewhere.
    const source = readFileSync('scripts/settlement-week-preflight.ts', 'utf8')

    expect(source).toContain('utcTimestampParam(periodStart)')
    expect(source).toContain('utcTimestampParam(periodEnd)')

    // Five query sites, every one on the string params.
    const bound = (source.match(/periodStartParam, periodEndParam/g) ?? [])
      .length
    expect(bound).toBe(5)

    // And not a single site left binding the Dates themselves.
    expect(source).not.toMatch(/\[periodStart, periodEnd[,\]]/)
  })
})
