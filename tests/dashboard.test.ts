import { describe, expect, it } from 'vitest'
import type { Role } from '@/generated/prisma/client'
import { actionKeysFor, weekStart } from '@/lib/dashboard'
import { can, type AuthorizedSession } from '@/lib/permissions'

// ---------------------------------------------------------------------------
// The two decisions the dashboard makes before it touches the database: which
// rows a role is even allowed to be counted, and where the week starts.
// ---------------------------------------------------------------------------

const session = (role: Role): AuthorizedSession => ({
  userId: 'u',
  organizationId: 'o',
  role,
  companyScopes: [],
})

describe('who gets which rows in the action queue', () => {
  it('gives a DISPATCHER the operational rows and NO money row', () => {
    // The rule the whole application is built on: a dispatcher books freight
    // all day and never sees what it is worth. Not hidden — never counted.
    const keys = actionKeysFor(session('DISPATCHER'))

    expect(keys).toContain('podMissing')
    expect(keys).toContain('unassigned')
    // COMPLIANCE IS OPERATIONAL, not financial (§2.5): a dispatcher must see
    // it, because an expired inspection gates a dispatch decision they make.
    expect(keys).toContain('compliance')

    for (const money of [
      'noRate',
      'readyToInvoice',
      'overdue',
      'unapplied',
      'draftSettlements',
    ]) {
      expect(keys, `dispatcher was offered ${money}`).not.toContain(money)
    }
  })

  it('gives ACCOUNTING the money rows and compliance, not the dispatch one', () => {
    // Accounting runs the money end to end and reads operations because an
    // invoice is built from a load — but permissions.ts says in as many words
    // that it "does not dispatch", so it has no `dispatch:read`.
    //
    // That is the right answer rather than an oversight: the unassigned row
    // links to /dispatch, and offering a row that leads to a 404 would be a
    // worse dashboard than one that leaves it out.
    const keys = actionKeysFor(session('ACCOUNTING'))
    for (const key of [
      'compliance',
      'podMissing',
      'noRate',
      'readyToInvoice',
      'overdue',
      'unapplied',
      'draftSettlements',
    ]) {
      expect(keys, `accounting was denied ${key}`).toContain(key)
    }
    expect(keys).not.toContain('unassigned')
    expect(can(session('ACCOUNTING'), 'read', 'dispatch')).toBe(false)

    // COMPLIANCE, READ-ONLY. The owner answered §6 flag 5: accounting handles
    // insurance certificates at billing and factoring time, so it sees expiry
    // dates. THE PAIR is the point — reading is granted, renewing is not, and
    // asserting only the first half would let a later `crud('compliance')`
    // slip in unnoticed.
    expect(keys).toContain('compliance')
    expect(can(session('ACCOUNTING'), 'read', 'compliance')).toBe(true)
    for (const action of ['create', 'update', 'delete'] as const) {
      expect(
        can(session('ACCOUNTING'), action, 'compliance'),
        `accounting can ${action} compliance`,
      ).toBe(false)
    }
  })

  it('gives a MANAGER the numbers but not the payment work', () => {
    // A manager watches the operation and does not move money. They can see a
    // load has no rate; applying a payment is not their job.
    const keys = actionKeysFor(session('MANAGER'))
    expect(keys).toContain('noRate')
    expect(keys).toContain('readyToInvoice')
    expect(keys).toContain('overdue')
    expect(keys).toContain('unapplied')
  })

  it('gives an OWNER everything and a DRIVER nothing', () => {
    // Named rather than counted: a bare length is a magic number that says
    // nothing about WHICH row was added or lost when it moves.
    expect(actionKeysFor(session('OWNER'))).toEqual([
      'compliance',
      'podMissing',
      'noRate',
      'readyToInvoice',
      'overdue',
      'unapplied',
      'draftSettlements',
      'unassigned',
    ])
    // The portal is a separate shell with a separate vocabulary; a driver has
    // no operator permission at all, so there is no queue to build.
    expect(actionKeysFor(session('DRIVER'))).toEqual([])
  })

  it('is decided by permissions.ts, so an override moves it', () => {
    // Proof that the filter really is `can` and not a hard-coded role list —
    // revoking one resource drops exactly one row.
    const stripped: AuthorizedSession = {
      ...session('ACCOUNTING'),
      permissionOverrides: { revoke: ['payment:read'] },
    }
    expect(actionKeysFor(stripped)).not.toContain('unapplied')
    expect(actionKeysFor(stripped)).toContain('overdue')
  })
})

describe('where the week starts', () => {
  it('is the Monday of the current week', () => {
    // Thursday 6 August 2026 → Monday the 3rd.
    expect(weekStart(new Date('2026-08-06T14:00:00Z')).toISOString()).toBe(
      '2026-08-03T00:00:00.000Z',
    )
  })

  it('treats Sunday as the END of its week, not the start of the next', () => {
    // Sunday 9 August 2026 belongs to the week that began Monday the 3rd.
    // Getting this wrong empties the dashboard every Sunday, which is a bug
    // nobody sees on a Wednesday.
    expect(weekStart(new Date('2026-08-09T23:59:00Z')).toISOString()).toBe(
      '2026-08-03T00:00:00.000Z',
    )
  })

  it('returns Monday itself on a Monday', () => {
    expect(weekStart(new Date('2026-08-03T00:30:00Z')).toISOString()).toBe(
      '2026-08-03T00:00:00.000Z',
    )
  })

  it('is a Monday at UTC midnight, on every day of a year', () => {
    const day = new Date('2026-01-01T00:00:00Z')
    for (let index = 0; index < 365; index++) {
      const start = weekStart(day)
      expect(start.getUTCDay(), day.toISOString()).toBe(1)
      expect(start.getUTCHours()).toBe(0)
      // And never in the future: the week you are in started already.
      expect(start.getTime()).toBeLessThanOrEqual(day.getTime())
      // Never more than six days back either.
      expect(day.getTime() - start.getTime()).toBeLessThanOrEqual(
        6 * 86_400_000,
      )
      day.setUTCDate(day.getUTCDate() + 1)
    }
  })
})
