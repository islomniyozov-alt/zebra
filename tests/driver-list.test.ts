import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DRIVER_CHIPS,
  DRIVER_TABS,
  WORKING_STATUSES,
  driverChipWhere,
  driverSearchWhere,
  driverTabWhere,
  driverViewFromUrl,
  isDriverTab,
  readinessFor,
  searchTerms,
  tabDateColumn,
} from '@/lib/driver-list'

// ---------------------------------------------------------------------------
// §6.4 PART 1 — the two rules the drivers list cannot carry in its page.
// ---------------------------------------------------------------------------

describe('three tabs and two chips (v11.38, owner 2026-11-19)', () => {
  it('are Active · Inactive · All, and Unassigned and Vacation are chips', () => {
    // COUNTED AGAINST THE DOCUMENT, the same instrument the accounting tabs
    // use: a tab added here and not there fails by name.
    const doc = readFileSync('TMS-DESIGN-SYSTEM.md', 'utf8')
    expect(doc).toContain('Active · Inactive · All')
    expect([...DRIVER_TABS]).toEqual(['active', 'inactive', 'all'])
    expect([...DRIVER_CHIPS]).toEqual(['unassigned', 'vacation'])
    expect(isDriverTab('terminated')).toBe(false)
    expect(isDriverTab('vacation')).toBe(false)
  })

  const now = new Date('2026-10-07T12:00:00.000Z')

  it('Active is everyone still employed — VACATION included — and Inactive is INACTIVE', () => {
    expect(driverTabWhere('active')).toEqual({
      deletedAt: null,
      status: { not: 'INACTIVE' },
    })
    expect(driverTabWhere('inactive')).toEqual({
      deletedAt: null,
      status: 'INACTIVE',
    })
  })

  it('All is every roster row that is not a removed mistake; the toggle widens any tab', () => {
    expect(driverTabWhere('all')).toEqual({ deletedAt: null })
    expect(driverTabWhere('all', true)).toEqual({})
    expect(driverTabWhere('inactive', true)).toEqual({ status: 'INACTIVE' })
  })

  it('Unassigned is a working driver with no truck; Vacation is VACATION or a return ahead', () => {
    expect(driverChipWhere('unassigned', now)).toEqual({
      status: { in: [...WORKING_STATUSES] },
      assignedTruckId: null,
    })
    expect(WORKING_STATUSES).not.toContain('INACTIVE')
    expect(driverChipWhere('vacation', now)).toEqual({
      OR: [{ status: 'VACATION' }, { offDutyUntil: { gt: now } }],
    })
  })

  it('old links still open: Terminated as Inactive, the old tabs as Active with the chip', () => {
    expect(driverViewFromUrl('terminated', undefined)).toEqual({
      tab: 'inactive',
      chip: null,
    })
    expect(driverViewFromUrl('vacation', undefined)).toEqual({
      tab: 'active',
      chip: 'vacation',
    })
    expect(driverViewFromUrl('unassigned', undefined)).toEqual({
      tab: 'active',
      chip: 'unassigned',
    })
    expect(driverViewFromUrl('all', 'vacation')).toEqual({
      tab: 'all',
      chip: 'vacation',
    })
    expect(driverViewFromUrl('nonsense', 'nonsense')).toEqual({
      tab: 'active',
      chip: null,
    })
    expect(driverViewFromUrl(['all'], undefined).tab).toBe('active')
  })

  it('the date column follows the view: Inactive brings when, Vacation the return', () => {
    expect(tabDateColumn('inactive')).toBe('terminated')
    expect(tabDateColumn('active', 'vacation')).toBe('returns')
    expect(tabDateColumn('all', 'unassigned')).toBeNull()
    expect(tabDateColumn('active')).toBeNull()
  })
})

describe('search (v11.38): name, phone, truck unit — every word', () => {
  it('splits on spaces, drops LIKE wildcards, caps words and their length', () => {
    expect(searchTerms('  Adzhmal   Ali ')).toEqual(['Adzhmal', 'Ali'])
    expect(searchTerms('50%_off\\')).toEqual(['50off'])
    expect(searchTerms('% _')).toEqual([])
    expect(searchTerms(undefined)).toEqual([])
    expect(searchTerms('a b c d e f g')).toHaveLength(5)
    expect(searchTerms('x'.repeat(60))[0]).toHaveLength(40)
  })

  it('every word must match one of first name, last name, phone or truck unit', () => {
    expect(driverSearchWhere([])).toEqual({})
    const where = driverSearchWhere(['ali', '4974'])
    expect(where.AND).toHaveLength(2)
    expect((where.AND as { OR: unknown[] }[])[1]!.OR).toEqual([
      { firstName: { contains: '4974', mode: 'insensitive' } },
      { lastName: { contains: '4974', mode: 'insensitive' } },
      { phone: { contains: '4974', mode: 'insensitive' } },
      {
        assignedTruck: {
          is: { unitNumber: { contains: '4974', mode: 'insensitive' } },
        },
      },
    ])
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
