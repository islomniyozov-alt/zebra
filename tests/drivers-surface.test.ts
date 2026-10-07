import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DRIVER_COLUMNS_HIDDEN, DRIVER_COLUMN_KEYS } from '@/lib/list-columns'

// ---------------------------------------------------------------------------
// §6.4 PART 1 — THE DRIVERS LIST, HELD TO ITS OWN SECTION IN SOURCE.
//
// The same instrument tests/accounting-surface.test.ts applies to the money
// lists: the page is counted against the document, so a tab or a column added
// to one and not the other fails by name rather than on a screenshot.
// ---------------------------------------------------------------------------

const page = readFileSync(
  join('src', 'app', '(app)', 'drivers', 'page.tsx'),
  'utf8',
)
const doc = readFileSync('TMS-DESIGN-SYSTEM.md', 'utf8')

describe('the drivers list (§6.4 part 1)', () => {
  it('declares the five tabs §6.4 names, in its order, through the lib', () => {
    expect(page).toContain("from '@/lib/driver-list'")
    expect(page).toMatch(/DRIVER_TABS\.map\(/)
    expect(doc).toContain(
      'Active · Unassigned · All · Terminated · Vacation board',
    )
  })

  it('names the ten columns of the brief and hides only email and CDL', () => {
    // §7.1.7: warnings is never default-hidden — an absent warnings column
    // reads as "nothing wrong".
    expect([...DRIVER_COLUMN_KEYS]).toEqual([
      'name',
      'ready',
      'type',
      'status',
      'lastActivity',
      'company',
      'phone',
      'email',
      'truck',
      'cdl',
      'warnings',
    ])
    expect([...DRIVER_COLUMNS_HIDDEN]).toEqual(['email', 'cdl'])
    expect(DRIVER_COLUMNS_HIDDEN as readonly string[]).not.toContain('warnings')
    expect(page).toContain("'drivers.drivers'")
  })

  it('keeps ONE status column, and the tab carries the employee status', () => {
    // Owner's ruling 2026-09-21, restated by §6.4: the brief's "employee
    // status" is the tab, not a second badge. driver-roster.test.ts counts
    // `key: 'status'`; this asserts nothing was smuggled in under another name.
    expect(page).not.toContain("key: 'employeeStatus'")
    expect(page).not.toContain("key: 'dispatch',")
  })

  it('derives assign status through readinessFor and never stores it', () => {
    expect(page).toContain('readinessFor(')
    const schema = readFileSync('prisma/schema.prisma', 'utf8')
    expect(schema).not.toMatch(/readyToGo|assignStatus|isReady\s/)
  })

  it('offers roster bulk actions only', () => {
    const bar = readFileSync(
      join('src', 'app', '(app)', 'drivers', 'bulk-actions.ts'),
      'utf8',
    )
    expect(bar).toContain("active: 'AVAILABLE'")
    expect(bar).toContain("vacation: 'VACATION'")
    expect(bar).toContain("terminated: 'INACTIVE'")
    expect(bar).not.toContain("'DISPATCHED'")
    expect(bar).not.toContain("'ON_ROUTE'")
    expect(bar).toContain('setRosterStatus(')
  })

  it('saves views under its own grid, and is not exportable (§7.1.7, flagged)', () => {
    expect(page).toContain('grid="drivers"')
    const exportsRoute = readFileSync(
      join('src', 'app', '(app)', 'exports', 'route.ts'),
      'utf8',
    )
    const fence = exportsRoute.slice(
      exportsRoute.indexOf('const NOT_EXPORTABLE'),
      exportsRoute.indexOf('const isExportable'),
    )
    expect(fence).toContain("'drivers.drivers'")
  })
})
