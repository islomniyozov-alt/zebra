import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DRIVER_TABS,
  WORKING_STATUSES,
  driverTabWhere,
  isDriverTab,
  readinessFor,
} from '@/lib/driver-list'

// ---------------------------------------------------------------------------
// §6.4 PART 1 — the two rules the drivers list cannot carry in its page.
// ---------------------------------------------------------------------------

describe('the five tabs', () => {
  it('are the five §6.4 names, in the order the office reads them', () => {
    // COUNTED AGAINST THE DOCUMENT, the same instrument the accounting tabs
    // use: a tab added here and not there fails by name.
    const doc = readFileSync('TMS-DESIGN-SYSTEM.md', 'utf8')
    expect(doc).toContain(
      'Active · Unassigned · All · Terminated · Vacation board',
    )
    expect([...DRIVER_TABS]).toEqual([
      'active',
      'unassigned',
      'all',
      'terminated',
      'vacation',
    ])
    expect(isDriverTab('vacation')).toBe(true)
    expect(isDriverTab('inactive')).toBe(false)
  })

  const now = new Date('2026-10-07T12:00:00.000Z')

  it('Active is the roster at work — not removed, not INACTIVE, not VACATION', () => {
    expect(driverTabWhere('active', now)).toEqual({
      deletedAt: null,
      status: { in: [...WORKING_STATUSES] },
    })
    expect(WORKING_STATUSES).not.toContain('INACTIVE')
    expect(WORKING_STATUSES).not.toContain('VACATION')
  })

  it('Unassigned is Active with no truck', () => {
    expect(driverTabWhere('unassigned', now)).toEqual({
      deletedAt: null,
      status: { in: [...WORKING_STATUSES] },
      assignedTruckId: null,
    })
  })

  it('All is every roster row that is not a removed mistake', () => {
    expect(driverTabWhere('all', now)).toEqual({ deletedAt: null })
    // The removed toggle widens, as a flag, on any tab.
    expect(driverTabWhere('all', now, true)).toEqual({})
    expect(driverTabWhere('terminated', now, true)).toEqual({
      status: 'INACTIVE',
    })
  })

  it('Terminated is INACTIVE; Vacation board is VACATION or a return date still ahead', () => {
    expect(driverTabWhere('terminated', now)).toEqual({
      deletedAt: null,
      status: 'INACTIVE',
    })
    expect(driverTabWhere('vacation', now)).toEqual({
      deletedAt: null,
      OR: [{ status: 'VACATION' }, { offDutyUntil: { gt: now } }],
    })
  })
})

describe('ready to go', () => {
  const ready = {
    qualifiable: true,
    dqfIncomplete: 0,
    truckAssigned: true,
    truckExpired: false,
  }

  it('is all four facts at once', () => {
    expect(readinessFor(ready)).toEqual({ ready: true, reason: null })
  })

  it('names the FIRST reason, in the order a dispatcher would fix them', () => {
    expect(readinessFor({ ...ready, qualifiable: false })).toEqual({
      ready: false,
      reason: 'not_qualifiable',
    })
    expect(readinessFor({ ...ready, dqfIncomplete: 2 })).toEqual({
      ready: false,
      reason: 'dqf',
    })
    expect(readinessFor({ ...ready, truckAssigned: false })).toEqual({
      ready: false,
      reason: 'no_truck',
    })
    expect(readinessFor({ ...ready, truckExpired: true })).toEqual({
      ready: false,
      reason: 'truck_expired',
    })
    // Two reasons at once: the earlier one is named, not a count.
    expect(
      readinessFor({ ...ready, dqfIncomplete: 1, truckAssigned: false }).reason,
    ).toBe('dqf')
  })

  it('never says ready about an expired truck, however complete the file', () => {
    expect(readinessFor({ ...ready, truckExpired: true }).ready).toBe(false)
  })
})
