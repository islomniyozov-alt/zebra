import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ACTIVE_ROSTER,
  assertRosterStatus,
  DERIVED_STATUSES,
  isRosterStatus,
  rosterBadge,
  ROSTER_STATUSES,
} from '@/lib/driver-roster'
import { assignableDriver } from '@/lib/driver-availability'
import { dispatchStatusFrom } from '@/lib/dispatch-fields'
import { ReferenceError } from '@/lib/reference'
import type { DriverStatus } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// ONE COLUMN, ONE QUESTION (owner's rulings, 2026-09-21).
//
// `Driver.status` answered two: what the roster says about a person, and what
// their freight is doing. Item 11 derives the second, migration 55 moved the
// rows, and these are the rules that stop the two merging again.
// ---------------------------------------------------------------------------

const NOW = new Date(Date.UTC(2026, 8, 21, 12, 0, 0))
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000)

describe('what the roster may say', () => {
  it('is three values, and none of them describe freight', () => {
    expect([...ROSTER_STATUSES]).toEqual(['AVAILABLE', 'VACATION', 'INACTIVE'])
    for (const derived of DERIVED_STATUSES) {
      expect(isRosterStatus(derived)).toBe(false)
    }
  })

  it('REFUSES a derived status by name rather than coercing it', () => {
    // Quietly mapping DISPATCHED to AVAILABLE would let an import keep writing
    // a value that means nothing and never say so.
    for (const derived of DERIVED_STATUSES) {
      let caught: unknown
      try {
        assertRosterStatus(derived)
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(ReferenceError)
      expect((caught as ReferenceError).code).toBe('not_roster_status')
      expect((caught as ReferenceError).field).toBe('status')
    }
  })

  it('lets the three through, and lets absence through', () => {
    for (const status of ROSTER_STATUSES) {
      expect(assertRosterStatus(status)).toBe(status)
    }
    // An edit form that did not render the field must not rewrite it.
    expect(assertRosterStatus(undefined)).toBeUndefined()
  })
})

describe('one status per row', () => {
  it('shows no roster badge for somebody who simply works here', () => {
    expect(rosterBadge(ACTIVE_ROSTER)).toBeNull()
  })

  it('shows the roster badge when it contradicts working here', () => {
    expect(rosterBadge('VACATION')).toBe('VACATION')
    expect(rosterBadge('INACTIVE')).toBe('INACTIVE')
  })

  it('shows nothing for a value the roster cannot state', () => {
    // A row left over from before migration 55 would otherwise render a badge
    // reading "Dispatched" beside a derived status saying something else —
    // the exact two-answer problem the ruling removes.
    for (const derived of DERIVED_STATUSES) {
      expect(rosterBadge(derived)).toBeNull()
    }
  })

  it('renders ONE status column on the drivers list', () => {
    // A source guard, because the defect is a column existing rather than a
    // value being wrong. The second column was `key: 'dispatch'`.
    const page = readFileSync('src/app/(app)/drivers/page.tsx', 'utf8')
    expect(page.match(/key: 'status'/g) ?? []).toHaveLength(1)
    expect(page).not.toContain("key: 'dispatch',")
  })

  it('offers the form roster values only', () => {
    const fields = readFileSync('src/app/(app)/drivers/fields.ts', 'utf8')
    expect(fields).toContain('ROSTER_STATUSES.map')
    expect(fields).not.toContain("'DISPATCHED'")
    expect(fields).not.toContain("'ON_ROUTE'")
  })
})

describe('the roster reaches the derived status', () => {
  const status = (rosterStatus: DriverStatus, activeStatuses: string[] = []) =>
    dispatchStatusFrom(
      { rosterStatus, isOffDuty: false, offDutyUntil: null, activeStatuses },
      NOW,
    )

  it('reads Off duty for a driver on holiday, whatever the freight says', () => {
    // Nobody sets two things to say one thing. VACATION is off duty, and the
    // list shows the more specific roster badge over the top of it.
    expect(status('VACATION', ['IN_TRANSIT'])).toBe('off_duty')
  })

  it('reads Off duty for somebody who no longer drives here', () => {
    expect(status('INACTIVE')).toBe('off_duty')
  })

  it('still reads the freight for an active driver', () => {
    expect(status('AVAILABLE', ['IN_TRANSIT'])).toBe('in_transit')
    expect(status('AVAILABLE')).toBe('available')
  })
})

describe('who may be given work', () => {
  it('is on the roster, working, and not off duty', () => {
    const where = assignableDriver(NOW)
    expect(where.status).toBe(ACTIVE_ROSTER)
    expect(where.deletedAt).toBeNull()
    expect(where.OR).toEqual([
      { isOffDuty: false },
      { offDutyUntil: { lte: NOW } },
    ])
  })

  it('reads the clock rather than the flag alone', () => {
    // THE WHOLE REASON THIS IS A FUNCTION. `isOffDuty: false` on its own
    // would keep a driver out of every picker after their return date passed,
    // which is the stale-flag failure `offDutyUntil` exists to prevent.
    const later = assignableDriver(hours(48))
    expect(later.OR).toEqual([
      { isOffDuty: false },
      { offDutyUntil: { lte: hours(48) } },
    ])
  })

  it('refuses an off-duty driver at the point of ASSIGNMENT too', () => {
    // A picker that hides somebody the engine would still accept is half a
    // rule. `assertAssignable` is the thing that acts.
    const dispatch = readFileSync('src/lib/dispatch.ts', 'utf8')
    expect(dispatch).toContain('isOffDutyNow')
    expect(dispatch).toContain('dispatch.conflict.offDuty')
  })
})

describe('the board counts available trucks from the freight', () => {
  const page = readFileSync('src/app/(app)/dispatch/page.tsx', 'utf8')

  it('never from a stored word', () => {
    expect(page).toContain('loads: { none: ACTIVE_LOAD }')
    expect(page).not.toContain("status: 'AVAILABLE'")
  })

  it('counts exactly the trucks whose Heading to cell is blank', () => {
    // ONE PREDICATE, TWO READINGS. `headingToForTrucks` finds a truck's
    // current load with the same three conditions; if they drift apart the
    // board will say eleven trucks are free and show nine blank cells.
    const lib = readFileSync('src/lib/dispatch-fields.ts', 'utf8')
    expect(lib).toContain('export const ACTIVE_LOAD')
    for (const condition of [
      'deletedAt: null',
      'isCancelled: false',
      'operationalStatus: { notIn: [...FINISHED] }',
    ]) {
      expect(lib).toContain(condition)
    }
  })
})
