import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HOLDS_SEAT } from '@/lib/team'
import { FLEET_STATUSES } from '@/lib/fleet-codes'
import {
  columnKeysFor,
  TABLE_COLUMN_CAP,
  TRUCK_COLUMN_KEYS,
  TRUCK_COLUMNS_ADDED_SINCE_LEGACY,
  TRUCK_COLUMNS_HIDDEN,
} from '@/lib/list-columns'
import { gridColumnCap } from '@/lib/grid-columns'
import {
  DEFAULT_TRUCK_VIEW,
  listWhere,
  readTruckListParams,
  statusChipWhere,
  TRUCK_STATUS_ORDER,
  TRUCK_VIEWS,
  truckListWhere,
  truckSearchWhere,
  truckViewFor,
  truckViewWhere,
  viewCountWhere,
  viewHoldsInactive,
} from '@/lib/truck-list'
import { truckChipCounts, type TruckCountGroup } from '@/lib/truck-list-counts'
import { trucksCsv, trucksCsvFilename } from '@/lib/truck-list-csv'
import type { TruckListRow } from '@/lib/truck-list-rows'

// ---------------------------------------------------------------------------
// §6.5 PART 1 — THE TRUCKS LIST TAKES DATATRUCK'S SHAPE, HELD TO ITS SECTION.
//
// The predicates, the URL reader, the pure count derivation and the file are
// tested as functions; the page is counted against the document by reading
// its source, the way tests/drivers-surface.test.ts does for /drivers. The
// agreement between the SQL counts and the Prisma listing is
// tests/integration/truck-list.test.ts, against real Postgres.
// ---------------------------------------------------------------------------

const PAGE = readFileSync(
  join('src', 'app', '(app)', 'trucks', 'page.tsx'),
  'utf8',
)
const ROUTE = readFileSync(
  join('src', 'app', '(app)', 'trucks', 'export', 'route.ts'),
  'utf8',
)
const DOC = readFileSync('TMS-DESIGN-SYSTEM.md', 'utf8')

/** The column literal for `key`, from its `key:` line to its `render:`. */
function literal(key: string): string {
  const start = PAGE.indexOf(`key: '${key}',`)
  expect(start, `column ${key} declared`).toBeGreaterThan(-1)
  const end = PAGE.indexOf('render:', start)
  return PAGE.slice(start, end)
}

describe('the four views (§6.5 part 1)', () => {
  it("are the brief's four, in the brief's order, Active by default", () => {
    expect([...TRUCK_VIEWS]).toEqual([
      'active',
      'unassigned',
      'all',
      'inactive',
    ])
    expect(DEFAULT_TRUCK_VIEW).toBe('active')
    expect(DOC).toContain(
      '**Four views as chips with counts, `?view=`, one predicate each**',
    )
  })

  it.each(['Active', 'ALL', 'removed', '', 'active ', undefined, ['all']])(
    'an unknown name (%j) opens Active, because a stale link should open',
    (raw) => {
      expect(truckViewFor(raw)).toBe('active')
    },
  )

  it('each view is one predicate', () => {
    expect(truckViewWhere('active')).toEqual({
      deletedAt: null,
      status: { not: 'SOLD' },
    })
    // UNASSIGNED READS THE SEAT DEFINITION team.ts OWNS, not a copy of it.
    expect(truckViewWhere('unassigned')).toEqual({
      deletedAt: null,
      status: { not: 'SOLD' },
      drivers: { none: HOLDS_SEAT },
    })
    expect(HOLDS_SEAT).toEqual({ deletedAt: null, status: { not: 'INACTIVE' } })
    expect(truckViewWhere('all')).toEqual({})
    expect(truckViewWhere('inactive')).toEqual({
      OR: [{ deletedAt: { not: null } }, { status: 'SOLD' }],
    })
  })

  it('only All and Inactive can hold a Sold or Removed truck', () => {
    expect(TRUCK_VIEWS.filter(viewHoldsInactive)).toEqual(['all', 'inactive'])
  })
})

describe('the URL, read once', () => {
  it('reads every filter and validates the coded ones', () => {
    const read = readTruckListParams({
      view: 'unassigned',
      company: 'c1',
      q: '  1001 ',
      status: 'OUT_OF_SERVICE',
      fleet: 'In shop',
      make: 'FRHT',
      yearFrom: '2015',
      yearTo: '2020',
      attention: '1',
      tag: 'lease',
      missing: 'vin',
    })
    expect(read).toEqual({
      view: 'unassigned',
      company: 'c1',
      q: '1001',
      status: 'OUT_OF_SERVICE',
      fleet: 'In shop',
      make: 'FRHT',
      yearFrom: 2015,
      yearTo: 2020,
      attention: true,
      tag: 'lease',
      missing: 'vin',
    })
  })

  it('drops a status, fleet status or check it does not know', () => {
    const read = readTruckListParams({
      status: 'BROKEN',
      fleet: 'Scrapped',
      missing: 'insurance',
      attention: 'yes',
    })
    expect(read.status).toBeUndefined()
    expect(read.fleet).toBeUndefined()
    expect(read.missing).toBeNull()
    expect(read.attention).toBe(false)
    expect(read.q).toBe('')
    expect(read.view).toBe('active')
  })

  it('a year is four digits, and a range whose end precedes its start narrows nothing', () => {
    expect(readTruckListParams({ yearFrom: '20' }).yearFrom).toBeUndefined()
    expect(readTruckListParams({ yearTo: 'abcd' }).yearTo).toBeUndefined()
    const backwards = readTruckListParams({ yearFrom: '2020', yearTo: '2015' })
    expect(backwards.yearFrom).toBeUndefined()
    expect(backwards.yearTo).toBeUndefined()
    const oneEnd = readTruckListParams({ yearTo: '2015' })
    expect(oneEnd.yearTo).toBe(2015)
    expect(oneEnd.yearFrom).toBeUndefined()
  })

  it('the fleet status filter accepts exactly the code list', () => {
    for (const code of FLEET_STATUSES) {
      expect(readTruckListParams({ fleet: code }).fleet).toBe(code)
    }
  })
})

describe('the where, built once', () => {
  it('searches unit, plate and VIN, case-insensitively, and nothing when blank', () => {
    expect(truckSearchWhere('  ')).toEqual({})
    expect(truckSearchWhere(' ab1 ')).toEqual({
      OR: [
        { unitNumber: { contains: 'ab1', mode: 'insensitive' } },
        { plate: { contains: 'ab1', mode: 'insensitive' } },
        { vin: { contains: 'ab1', mode: 'insensitive' } },
      ],
    })
  })

  it('ANDs every part, so the search and the Inactive view keep their ORs', () => {
    const params = readTruckListParams({
      view: 'inactive',
      q: 'x',
      make: 'FRHT',
    })
    const where = truckListWhere(params, { companyId: { in: ['c1'] } })
    const list = listWhere(where)
    expect(list).toEqual({ AND: [where.base, where.view, where.status] })
    expect(where.base.AND).toContainEqual({ companyId: { in: ['c1'] } })
    expect(where.base.AND).toContainEqual(truckSearchWhere('x'))
    expect(where.base.AND).toContainEqual({ make: 'FRHT' })
    expect(where.view).toEqual(truckViewWhere('inactive'))
  })

  it('the health filter brings its live base and its own definition', () => {
    const where = truckListWhere(readTruckListParams({ missing: 'plate' }), {})
    expect(where.base.AND).toContainEqual({ deletedAt: null })
    expect(where.base.AND).toContainEqual({
      OR: [{ plate: { equals: null } }, { plate: { equals: '' } }],
    })
  })

  it('a view chip honours the status filter and replaces the active view', () => {
    const where = truckListWhere(
      readTruckListParams({ view: 'all', status: 'AVAILABLE' }),
      {},
    )
    expect(viewCountWhere(where, 'unassigned')).toEqual({
      AND: [where.base, { status: 'AVAILABLE' }, truckViewWhere('unassigned')],
    })
  })

  it("a status chip is the view's rows by the Status column's value, Removed apart", () => {
    const where = truckListWhere(readTruckListParams({ view: 'all' }), {})
    expect(statusChipWhere(where, 'SOLD')).toEqual({
      AND: [listWhere(where), { deletedAt: null, status: 'SOLD' }],
    })
    expect(statusChipWhere(where, 'REMOVED')).toEqual({
      AND: [listWhere(where), { deletedAt: { not: null } }],
    })
  })
})

describe('the counts, derived from the groups', () => {
  const group = (
    over: Partial<TruckCountGroup> & { status: string; n: number },
  ): TruckCountGroup => ({
    removed: false,
    active: true,
    unassigned: false,
    inactive: false,
    statusOk: true,
    ...over,
  })
  const groups: TruckCountGroup[] = [
    group({ status: 'AVAILABLE', n: 3 }),
    group({ status: 'AVAILABLE', unassigned: true, n: 2 }),
    group({ status: 'OUT_OF_SERVICE', unassigned: true, n: 4 }),
    group({ status: 'SOLD', active: false, inactive: true, n: 1 }),
    group({
      status: 'AVAILABLE',
      removed: true,
      active: false,
      inactive: true,
      n: 5,
    }),
    // Fails the status filter: in no count at all.
    group({ status: 'DISPATCHED', statusOk: false, n: 7 }),
  ]

  it('each view chip, under the status filter and not the view', () => {
    const counts = truckChipCounts(groups, 'active')
    expect(counts.views).toEqual({
      active: 9,
      unassigned: 6,
      all: 15,
      inactive: 6,
    })
  })

  it("the status chips report the view's rows, a removed row under REMOVED", () => {
    const active = truckChipCounts(groups, 'active')
    expect(active.status.AVAILABLE).toBe(5)
    expect(active.status.OUT_OF_SERVICE).toBe(4)
    expect(active.status.SOLD).toBe(0)
    expect(active.status.REMOVED).toBe(0)
    expect(active.matching).toBe(9)
    const all = truckChipCounts(groups, 'all')
    expect(all.status.SOLD).toBe(1)
    // The removed row is AVAILABLE in the column and REMOVED on the screen.
    expect(all.status.REMOVED).toBe(5)
    expect(all.status.AVAILABLE).toBe(5)
    expect(all.matching).toBe(15)
  })

  it('every chip starts at zero, so a chip with nothing behind it reads 0', () => {
    const counts = truckChipCounts([], 'inactive')
    for (const status of TRUCK_STATUS_ORDER)
      expect(counts.status[status]).toBe(0)
    expect(counts.status.REMOVED).toBe(0)
    expect(counts.views).toEqual({
      active: 0,
      unassigned: 0,
      all: 0,
      inactive: 0,
    })
  })

  it("the footer's order is the brief's, Sold last", () => {
    expect([...TRUCK_STATUS_ORDER]).toEqual([
      'AVAILABLE',
      'IN_TRANSIT',
      'DISPATCHED',
      'MAINTENANCE',
      'OUT_OF_SERVICE',
      'SOLD',
    ])
  })
})

describe('the file (§7.1.5)', () => {
  const row = (over: Partial<TruckListRow>): TruckListRow => ({
    id: 't1',
    unitNumber: '1001',
    companyName: 'RAM Haulage',
    make: 'FRHT',
    model: 'Cascadia',
    year: 2021,
    plate: 'DF671G',
    plateState: 'IL',
    vin: '3AKJHHDR7MSMR8235',
    ownerName: null,
    odometer: 412000,
    status: 'OUT_OF_SERVICE',
    isRetired: false,
    fleetStatus: null,
    agingDays: null,
    headingTo: null,
    crew: [],
    warnings: [],
    ...over,
  })

  it("writes the person's visible columns in the table's order, as codes", () => {
    const csv = trucksCsv(
      [
        row({
          crew: [
            { id: 'd1', name: 'A One' },
            { id: 'd2', name: 'B Two' },
          ],
        }),
        row({
          id: 't2',
          unitNumber: '1002',
          isRetired: true,
          status: 'AVAILABLE',
          warnings: [{ name: 'compliance_expired', detail: 'REGISTRATION' }],
        }),
      ],
      ['unitNumber', 'plateState', 'driver', 'status', 'warnings', 'nonsense'],
    )
    const lines = csv.replace(/^﻿/, '').split('\r\n')
    expect(lines[0]).toBe('unit_number,state,driver,status,warnings')
    expect(lines[1]).toBe('1001,IL,A One / B Two,OUT_OF_SERVICE,')
    // A removed truck says so in the status column, as the screen does.
    expect(lines[2]).toBe('1002,IL,,REMOVED,compliance_expired')
  })

  it('names the file by the view and the day', () => {
    expect(trucksCsvFilename('unassigned', '2026-11-10')).toBe(
      'zebra-trucks-unassigned-2026-11-10.csv',
    )
    expect(trucksCsvFilename('active', '2026-11-10')).toBe(
      'zebra-trucks-active-2026-11-10.csv',
    )
  })
})

describe("the columns are Datatruck's, inside the cap (§7.1.7)", () => {
  it("declares Datatruck's order with the three optional columns after status", () => {
    expect([...TRUCK_COLUMN_KEYS]).toEqual([
      'unitNumber',
      'make',
      'model',
      'plate',
      'vin',
      'year',
      'plateState',
      'company',
      'driver',
      'ownerName',
      'odometer',
      'status',
      'fleetStatus',
      'aging',
      'headingTo',
      'warnings',
    ])
  })

  it("hides the brief's four and heading to — never warnings, model or odometer", () => {
    expect([...TRUCK_COLUMNS_HIDDEN].sort()).toEqual(
      ['aging', 'fleetStatus', 'headingTo', 'ownerName', 'vin'].sort(),
    )
    expect(TRUCK_COLUMNS_HIDDEN as readonly string[]).not.toContain('warnings')
    expect(TRUCK_COLUMNS_HIDDEN as readonly string[]).not.toContain('year')
  })

  it("shows the brief's eleven with the authority column, ten without (owner's ruling 2026-11-10)", () => {
    const shown = (multi: boolean) =>
      columnKeysFor(TRUCK_COLUMN_KEYS, multi).filter(
        (key) => !(TRUCK_COLUMNS_HIDDEN as readonly string[]).includes(key),
      )
    expect(shown(true)).toEqual([
      'unitNumber',
      'make',
      'model',
      'plate',
      'year',
      'plateState',
      'company',
      'driver',
      'odometer',
      'status',
      'warnings',
    ])
    expect(shown(true)).toHaveLength(gridColumnCap('trucks.trucks'))
    expect(gridColumnCap('trucks.trucks')).toBe(11)
    expect(gridColumnCap('trucks.trucks')).toBeGreaterThan(TABLE_COLUMN_CAP)
    expect(shown(false)).toHaveLength(10)
    // THE RULING, PINNED in the section that carries it.
    expect(DOC).toContain('**`/trucks` IS CAPPED AT ELEVEN**')
  })

  it('the columns the list gained are not counted as hidden by an old saved choice', () => {
    expect([...TRUCK_COLUMNS_ADDED_SINCE_LEGACY]).toEqual([
      'vin',
      'plateState',
      'driver',
      'ownerName',
    ])
    expect(
      readFileSync(join('src', 'lib', 'grid-columns.ts'), 'utf8'),
    ).toContain("'trucks.trucks': TRUCK_COLUMNS_ADDED_SINCE_LEGACY")
  })

  it('fits the identifiers, year, state, odometer, badge, aging and warnings; shares the names', () => {
    for (const key of [
      'unitNumber',
      'plate',
      'vin',
      'year',
      'plateState',
      'odometer',
      'status',
      'fleetStatus',
      'aging',
      'warnings',
    ]) {
      expect(literal(key), key).toContain("fit: 'content'")
      expect(literal(key), key).not.toContain('truncate: true')
    }
    for (const key of ['make', 'model', 'company', 'ownerName', 'headingTo']) {
      expect(literal(key), key).toContain('truncate: true')
      expect(literal(key), key).not.toContain('share:')
    }
    expect(literal('driver')).toContain('truncate: true')
    expect(literal('driver')).toContain('share: 2')
  })

  it('the unit carries a copy icon outside the anchor, and the driver seats link', () => {
    // The whole unit column, `trailing` included — it is declared after
    // `render`, past where `literal()` stops.
    const unitColumn = PAGE.slice(
      PAGE.indexOf("key: 'unitNumber',"),
      PAGE.indexOf("key: 'make',"),
    )
    expect(unitColumn).toContain('trailing: (row) =>')
    expect(unitColumn).toContain('<CopyLoadNumber')
    expect(PAGE).toContain('recordLink(`/drivers/${seat.id}`, seat.name)')
    expect(PAGE).toContain("currentUserCan('read', 'driver')")
  })
})

describe('the page, held to the section', () => {
  it('reads through the lib and renders', () => {
    expect(PAGE).toContain("from '@/lib/truck-list'")
    expect(PAGE).toMatch(
      /readTruckListData\(\s*tx,\s*session\.companyScopes,\s*listParams,/,
    )
    expect(PAGE).toContain('readTruckListParams(params)')
    // The page parses no parameter of its own.
    expect(PAGE).not.toMatch(
      /params\['(view|status|removed|attention|tag|company|q)'\]/,
    )
  })

  it('offers the four views as chips with counts, Active the default chip', () => {
    expect(PAGE).toMatch(/param: 'view',[\s\S]{0,400}defaultValue: 'active'/)
    expect(PAGE).toContain('TRUCK_VIEWS.map((name) => ({')
    expect(PAGE).toContain('count: counts.views[name]')
  })

  it('replaced the Needs attention and Show removed links', () => {
    expect(PAGE).not.toContain("t('ref.showRetired')")
    expect(PAGE).not.toContain("t('ref.hideRetired')")
    expect(PAGE).not.toContain("t('warning.all')")
    expect(PAGE).not.toContain("params['removed']")
    // Needs attention lives inside Filters now.
    const filters = readFileSync(
      join('src', 'app', '(app)', 'trucks', 'TruckFilters.tsx'),
      'utf8',
    )
    expect(filters).toContain("write('attention', attention ? null : '1')")
    expect(PAGE).toContain("needsAttention: t('warning.attention')")
  })

  it('has the search, the authority dropdown, Filters, the chooser and Export', () => {
    expect(PAGE).toContain("param: 'q',")
    expect(PAGE).toContain('<AuthorityFilter')
    expect(PAGE).toContain('<TruckFilters')
    expect(PAGE).toContain('grid="trucks.trucks"')
    expect(PAGE).toContain('href={exportHref}')
    expect(PAGE).toContain('`/trucks/export${')
    expect(PAGE).toMatch(/^\s*columns=\{keepColumns\(columns, visible\)\}$/m)
  })

  it('has no Import file, no bulk actions and no Save view', () => {
    expect(PAGE).not.toContain('SavedViews')
    expect(PAGE).not.toContain('/trucks/import')
    expect(PAGE).not.toMatch(/Bulk|bulk-actions|selectable/)
  })

  it('carries the status counts as read-only chips above the data-health row', () => {
    const chips = PAGE.indexOf('data-status-chip=')
    const health = PAGE.indexOf('<DataHealthRow')
    expect(chips).toBeGreaterThan(-1)
    expect(health).toBeGreaterThan(chips)
    // Not links, not buttons: a chip that reported and narrowed would be two
    // controls in one.
    const footer = PAGE.slice(
      PAGE.indexOf("aria-label={t('trucks.statusCounts')}"),
      health,
    )
    expect(footer).not.toContain('<Link')
    expect(footer).not.toContain('<button')
    expect(PAGE).toContain(
      "status !== 'SOLD' || viewHoldsInactive(listParams.view)",
    )
  })

  it('reads 500 and says so past it', () => {
    expect(PAGE).toContain('const PAGE_CAP = 500')
    expect(PAGE).toContain("t('trucks.capped')")
  })

  it("the export route is the list's reader under the list's permission", () => {
    expect(ROUTE).toContain(
      'readTruckListExport(tx, session, params, new Date())',
    )
    expect(ROUTE).toMatch(/withCurrentOrg\(\s*'read',\s*'truck',/)
    expect(ROUTE).toContain('readTruckListParams(')
    expect(ROUTE).not.toContain('prisma')
  })
})
