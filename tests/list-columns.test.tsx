/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import {
  gridColumnCap,
  gridResource,
  readGridColumns,
  saveGridColumns,
} from '@/lib/grid-columns'
import { can } from '@/lib/permissions'
import {
  BATCH_COLUMN_KEYS,
  BATCH_COLUMNS_HIDDEN,
  columnKeysFor,
  LOAD_COLUMN_KEYS,
  LOAD_COLUMNS_ADDED_SINCE_LEGACY,
  LOAD_COLUMNS_HIDDEN,
  readColumnMemory,
  TABLE_COLUMN_CAP,
  TRUCK_COLUMN_KEYS,
  TRUCK_COLUMNS_HIDDEN,
  visibleFromMemory,
} from '@/lib/list-columns'

// ---------------------------------------------------------------------------
// §7.1.7 — THE TWO OPERATIONAL LISTS STAY INSIDE §7.1's NINE.
//
// ── WHAT WENT WRONG, AND WHY NOTHING CAUGHT IT ────────────────────────────
//
// `/trucks` returned 500 for every organization, and `/loads` for every carrier
// with more than one authority, from 2026-09-20 until the UAT live check on
// 2026-10-04. The warnings column took trucks to eleven and loads to ten;
// `Table` throws above nine.
//
// Every instrument that should have seen it was pointed somewhere else. The suite
// has no test that renders either list. The workbench's trips grid — the page
// that FOUND the cap — has a guard, and it guards the trips grid: it greps that
// one file for its own `MAX_VISIBLE_COLUMNS` slice. And both page files carried a
// comment stating the column count, each accurate when written and neither
// re-counted since.
//
// ── SO THIS COUNTS THE PAGES, NOT THE MODULE ──────────────────────────────
//
// A test that only exercised `visibleWithinCap` would prove the arithmetic and
// miss the defect entirely: the arithmetic was never wrong, the COLUMN LIST was.
// So the first block reads the two page files and asserts the keys they declare
// are exactly the keys this module knows about — which is the thing that drifted.
// Build the instrument from the artefact.
// ---------------------------------------------------------------------------

// NO CHOOSER MOCK, AND THAT IS THE POINT NOW. The control moved to the page
// header (standing rule 1: a bar of its own costs a row of freight), so
// `LoadsTable` imports nothing that reaches a `'use server'` module and this
// renders the real component with nothing stubbed.

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/loads',
}))

afterEach(cleanup)

/**
 * The column keys a file declares, in source order.
 *
 * `key: '…'` inside a column literal. Neither file uses that spelling for
 * anything else — React's own `key` is JSX (`key={…}`) — and if one ever does,
 * this test fails loudly rather than quietly missing a column.
 */
function declaredKeys(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  return [...source.matchAll(/^\s*key: '([^']+)',$/gm)].map((hit) => hit[1]!)
}

describe('the key lists match the columns the pages actually declare', () => {
  it('/loads', () => {
    expect(declaredKeys('src/app/(app)/loads/LoadsTable.tsx')).toEqual([
      ...LOAD_COLUMN_KEYS,
    ])
  })

  it('/trucks', () => {
    expect(declaredKeys('src/app/(app)/trucks/page.tsx')).toEqual([
      ...TRUCK_COLUMN_KEYS,
    ])
  })

  it('and both are over the cap, which is why they have a chooser at all', () => {
    // IF THIS EVER FAILS, THE PAGE DOES NOT NEED THE MACHINERY. Stated as an
    // assertion rather than a comment because the alternative — a chooser on a
    // seven-column grid — is furniture, and nobody would notice.
    expect(LOAD_COLUMN_KEYS.length).toBeGreaterThan(TABLE_COLUMN_CAP)
    expect(TRUCK_COLUMN_KEYS.length).toBeGreaterThan(TABLE_COLUMN_CAP)
  })

  it('and the batches page says which of its eleven start hidden', () => {
    // WITHOUT THIS ARGUMENT the cap still holds — `readGridColumns` would keep
    // the first nine — but the two it dropped would be whichever happened to be
    // last, not the two §7.1.7 chose. Line-anchored, so a commented-out call
    // does not satisfy it.
    expect(
      readFileSync('src/app/(app)/payroll/batches/page.tsx', 'utf8'),
    ).toMatch(/^\s*HIDDEN_BY_DEFAULT\[tab\],$/m)
  })

  it('and each page hands its columns through keepColumns', () => {
    // LINE-ANCHORED, NOT `toContain`. A commented-out call contains the string
    // too — twice this session a guard passed against source that had been
    // commented out.
    for (const file of [
      'src/app/(app)/loads/LoadsTable.tsx',
      'src/app/(app)/trucks/page.tsx',
    ]) {
      expect(readFileSync(file, 'utf8')).toMatch(
        /^\s*columns=\{keepColumns\(columns, visible\)\}$/m,
      )
    }
  })
})

describe('whatever is stored, the table gets nine columns or fewer', () => {
  const grids = [
    {
      name: '/loads',
      keys: LOAD_COLUMN_KEYS,
      hidden: LOAD_COLUMNS_HIDDEN,
    },
    {
      name: '/trucks',
      keys: TRUCK_COLUMN_KEYS,
      hidden: TRUCK_COLUMNS_HIDDEN,
    },
    {
      // THE THIRD ONE, FOUND THE SAME DAY AND BY THE SAME PROBE. §6.2.9 took
      // this grid from eight columns to eleven; it had the chooser already, and
      // a chooser without a cap is a 500 on the first visit of every user who
      // has never set a preference — which is all of them.
      name: '/payroll/batches',
      keys: BATCH_COLUMN_KEYS,
      hidden: BATCH_COLUMNS_HIDDEN,
    },
  ]

  for (const grid of grids) {
    for (const showCompany of [true, false]) {
      it(`${grid.name}, authority column ${showCompany ? 'shown' : 'absent'}`, () => {
        const available = columnKeysFor(grid.keys, showCompany)
        const cap =
          grid.name === '/loads'
            ? gridColumnCap('loads.loads')
            : TABLE_COLUMN_CAP
        // FIVE STORED STATES: never chosen, a hidden set naming nothing (every
        // column shown), a hidden set naming everything, and the two OLD
        // shapes a real row can still hold — a "shown" list of everything and
        // a "shown" list of ten real columns.
        const stored: unknown[] = [
          null,
          { hidden: [] },
          { hidden: [...available] },
          [...available],
          available.slice(0, 10),
        ]
        for (const value of stored) {
          const { hidden } = readColumnMemory(value, available)
          const visible = visibleFromMemory(available, grid.hidden, hidden, cap)
          expect(visible.length).toBeLessThanOrEqual(cap)
          // AND NOT EMPTY, and never without the column carrying the row link.
          expect(visible.length).toBeGreaterThan(0)
          expect(visible[0]).toBe(available[0])
        }
      })
    }
  }

  it('more visible columns than the cap are cut from the end, never warnings', () => {
    const available = [...LOAD_COLUMN_KEYS]
    // Somebody who restored rate and billing: twelve, against a cap of ten.
    const visible = visibleFromMemory(available, LOAD_COLUMNS_HIDDEN, [], 10)
    expect(visible).toHaveLength(10)
    expect(visible).toContain('warnings')
    expect(visible[0]).toBe('loadNumber')
  })

  it('a hidden set is honoured, in the table order', () => {
    expect(visibleFromMemory(['a', 'b', 'c'], ['c'], ['b'])).toEqual(['a', 'c'])
  })

  it('no stored choice means the grid defaults', () => {
    expect(visibleFromMemory(['a', 'b', 'c'], ['b'], null)).toEqual(['a', 'c'])
  })
})

describe('column memory is the set a person HID (§6.7, 2026-10-09)', () => {
  it('a column added later appears for somebody who saved a choice', () => {
    // THE RULING'S POINT. They hid billing; a brand-new column is not in
    // their hidden set, so they see it without re-ticking anything.
    const { hidden } = readColumnMemory({ hidden: ['billing'] }, [
      'loadNumber',
      'billing',
      'brandNew',
    ])
    expect(
      visibleFromMemory(['loadNumber', 'billing', 'brandNew'], [], hidden),
    ).toEqual(['loadNumber', 'brandNew'])
  })

  it('an old "shown" list migrates to the columns it left out', () => {
    const available = [...LOAD_COLUMN_KEYS]
    // Saved before Driver and DEL date existed, with Truck unticked.
    const shown = available.filter(
      (key) => !['truck', 'driver', 'deliveryDate', 'rate'].includes(key),
    )
    const memory = readColumnMemory(
      shown,
      available,
      LOAD_COLUMNS_ADDED_SINCE_LEGACY,
    )
    expect(memory.migrated).toBe(true)
    // Truck and rate were left out deliberately; Driver and DEL date never
    // existed for that person, so they are NOT hidden.
    expect(memory.hidden).toEqual(['truck', 'rate'])
  })

  it('an old list that meant "never chose" stays the defaults', () => {
    const available = ['a', 'b']
    expect(readColumnMemory(['a', 'b'], available)).toEqual({
      hidden: null,
      migrated: false,
    })
    expect(readColumnMemory(['gone'], available)).toEqual({
      hidden: null,
      migrated: false,
    })
  })
})

describe('the cap lives in readGridColumns, so no grid can get past it', () => {
  // THE WHOLE POINT OF PUTTING IT THERE. Three pages each solved — or failed to
  // solve — this on their own; a fourth will be written by somebody who has not
  // read §7.1.7, and the only protection that survives that is the function they
  // cannot avoid calling.
  const writes: unknown[] = []
  const txWith = (value: unknown) =>
    ({
      userPreference: {
        findFirst: async () =>
          value === undefined ? null : { value, organizationId: 'o1' },
        upsert: async (args: { update: { value: unknown } }) => {
          writes.push(args.update.value)
        },
      },
    }) as never

  it('writes an old row back in the new shape, once, on read', async () => {
    writes.length = 0
    const visible = await readGridColumns(
      txWith(['loadNumber', 'customer', 'status', 'warnings']),
      'u1',
      'loads.loads',
      [...LOAD_COLUMN_KEYS],
      LOAD_COLUMNS_HIDDEN,
    )
    expect(writes).toHaveLength(1)
    const written = writes[0] as { hidden: string[] }
    expect(written.hidden).not.toContain('driver')
    expect(written.hidden).toContain('truck')
    // And what renders is what the migrated memory says, Driver included.
    expect(visible).toContain('driver')
    expect(visible).not.toContain('truck')
  })

  it('and writes nothing for a row already in the new shape', async () => {
    writes.length = 0
    await readGridColumns(
      txWith({ hidden: ['rate'] }),
      'u1',
      'loads.loads',
      [...LOAD_COLUMN_KEYS],
      LOAD_COLUMNS_HIDDEN,
    )
    expect(writes).toHaveLength(0)
  })

  it('saving stores what was offered and left unticked', async () => {
    writes.length = 0
    const result = await saveGridColumns(
      txWith(undefined),
      'o1',
      'u1',
      'loads.loads',
      ['loadNumber', 'customer', 'warnings'],
      ['loadNumber', 'customer', 'truck', 'rate', 'warnings'],
    )
    expect(result).toEqual({ ok: true })
    expect(writes).toEqual([{ hidden: ['truck', 'rate'] }])
  })

  it('with no stored row at all', async () => {
    const visible = await readGridColumns(
      txWith(undefined),
      'u1',
      'payroll.batches',
      BATCH_COLUMN_KEYS,
      BATCH_COLUMNS_HIDDEN,
    )
    expect(visible.length).toBe(9)
    expect(visible).not.toContain('created')
    // AND THE THREE §6.2.9 ADDED ARE STILL THERE, because a 500 answered by
    // quietly dropping the feature's own columns is not a fix.
    expect(visible).toContain('gross')
    expect(visible).toContain('deductions')
    expect(visible).toContain('amount')
  })

  it('and with a stored row naming eleven columns', async () => {
    const visible = await readGridColumns(
      txWith([...BATCH_COLUMN_KEYS]),
      'u1',
      'payroll.batches',
      BATCH_COLUMN_KEYS,
      BATCH_COLUMNS_HIDDEN,
    )
    expect(visible.length).toBeLessThanOrEqual(TABLE_COLUMN_CAP)
  })

  it('and a page that names nothing hidden still gets nine', async () => {
    // THE DEFAULT PARAMETER, which is what a future page will use by omission.
    // It loses its last columns rather than the request.
    const visible = await readGridColumns(
      txWith(undefined),
      'u1',
      'payroll.batches',
      BATCH_COLUMN_KEYS,
    )
    expect(visible.length).toBe(TABLE_COLUMN_CAP)
  })
})

describe('the chooser asks about a permission the role on that screen holds', () => {
  // THE DEFECT THIS IS ABOUT. `saveColumnsAction` asked for `settlement:read`
  // for every grid — correct for the Accounting tabs it was built for, and a
  // ForbiddenError on the two lists a DISPATCHER lives on. The control would
  // have rendered, submitted and thrown, for the one role that cannot work
  // around it by using a different screen.
  const dispatcher = {
    userId: 'u1',
    organizationId: 'o1',
    role: 'DISPATCHER' as const,
    companyScopes: [],
  }

  it('loads and trucks ask about load and truck', () => {
    expect(gridResource('loads.loads')).toBe('load')
    expect(gridResource('trucks.trucks')).toBe('truck')
  })

  it('and the Accounting grids still ask what they always did', () => {
    expect(gridResource('payroll.batches')).toBe('settlement')
    expect(gridResource('invoices.invoices')).toBe('settlement')
  })

  it('so a dispatcher may tidy both lists, and could not have before', () => {
    expect(can(dispatcher, 'read', gridResource('loads.loads'))).toBe(true)
    expect(can(dispatcher, 'read', gridResource('trucks.trucks'))).toBe(true)
    // THE OLD VALUE, ASSERTED AS FALSE. Without this line the three above would
    // pass against a `gridResource` that returned `settlement` for everything in
    // an organization whose dispatcher happened to hold it.
    expect(can(dispatcher, 'read', 'settlement')).toBe(false)
  })
})

describe('what is never default-hidden', () => {
  // §7.1.7. An absent warnings column reads as "nothing wrong", which is the one
  // thing a hidden column must not be able to say — so it is not a matter of
  // taste on these two lists.
  it('the warnings column, on either list', () => {
    expect([...LOAD_COLUMNS_HIDDEN]).not.toContain('warnings')
    expect([...TRUCK_COLUMNS_HIDDEN]).not.toContain('warnings')
  })

  it('nor the first column, which carries the row link', () => {
    expect([...LOAD_COLUMNS_HIDDEN]).not.toContain(LOAD_COLUMN_KEYS[0])
    expect([...TRUCK_COLUMNS_HIDDEN]).not.toContain(TRUCK_COLUMN_KEYS[0])
  })

  it('and hiding the defaults is enough to get under the cap', () => {
    const grids: {
      keys: readonly string[]
      hidden: readonly string[]
      cap: number
    }[] = [
      {
        keys: LOAD_COLUMN_KEYS,
        hidden: LOAD_COLUMNS_HIDDEN,
        cap: gridColumnCap('loads.loads'),
      },
      {
        keys: TRUCK_COLUMN_KEYS,
        hidden: TRUCK_COLUMNS_HIDDEN,
        cap: gridColumnCap('trucks.trucks'),
      },
    ]
    for (const grid of grids) {
      // WITHOUT THE CAP DOING THE WORK. The cap is the backstop for a stored
      // row; the default set has to stand on its own, or the first thing a new
      // user sees is a page whose last column was truncated silently.
      const shown = grid.keys.filter((key) => !grid.hidden.includes(key))
      expect(shown.length).toBeLessThanOrEqual(grid.cap)
    }
  })

  it('the loads list opens on the ten the owner named (2026-10-09)', () => {
    // THE RULING, PINNED: only rate and billing start hidden.
    expect([...LOAD_COLUMNS_HIDDEN].sort()).toEqual(['billing', 'rate'])
    expect(
      LOAD_COLUMN_KEYS.filter(
        (key) => !LOAD_COLUMNS_HIDDEN.includes(key as never),
      ),
    ).toEqual([
      'loadNumber',
      'company',
      'customer',
      'pickup',
      'delivery',
      'deliveryDate',
      'driver',
      'truck',
      'status',
      'warnings',
    ])
    // Ten is over §7.1's nine, which is why `/loads` alone is capped at ten.
    expect(gridColumnCap('loads.loads')).toBe(10)
    expect(gridColumnCap('trucks.trucks')).toBe(TABLE_COLUMN_CAP)
  })
})

// ---------------------------------------------------------------------------
// AND THE RENDER, WHICH IS THE ONLY PROOF THAT MATTERS
//
// Everything above is about lists of strings. `Table` throws on a count, and
// what it counts is the array a page hands it — so one of these two pages gets
// rendered for real, with the authority column present, which is the exact
// condition that returned 500.
// ---------------------------------------------------------------------------

describe('LoadsTable renders inside the cap with the authority column shown', () => {
  const row = {
    id: 'l1',
    loadNumber: 'L-1001',
    reference: 'TRIP-9',
    companyName: 'RAM Haulage',
    customerId: 'c1',
    customerName: 'Amazon',
    drivers: [{ id: 'd1', name: 'Hassan Ali' }],
    pickup: 'Chicago, IL',
    delivery: 'Dallas, TX',
    deliveryDate: 'Oct 9, 2026',
    truckId: 't1',
    truck: '104',
    operationalStatus: 'IN_TRANSIT' as const,
    billingStatus: 'UNINVOICED' as const,
    rate: '$2,450.00',
    isCancelled: false,
    warnings: [],
    stops: [],
    attachPod: true,
  }

  const expandLabels = {
    expand: 'Show details',
    collapse: 'Hide details',
    stops: 'Stops',
    notes: 'Notes',
    notesNone: 'None',
    notesLoading: 'Loading',
    notesFailed: 'Failed',
    warnings: 'Warnings',
    warningsNone: 'Nothing',
    stopTypes: { PICKUP: 'Pickup', DELIVERY: 'Delivery', INTERMEDIATE: 'Stop' },
    warningNames: {} as never,
  }
  const menuLabels = {
    menu: 'Load actions',
    open: 'Open',
    copy: 'Copy load number',
    copied: 'Load {n} copied',
    copyFailed: 'Could not copy',
    attachPod: 'Attach POD',
  }

  const labels = {
    warnings: 'Warnings',
    warningCount: '{count} warnings',
    warningClear: 'Clear',
    warningNames: {} as never,
    caption: 'Loads',
    load: 'Load',
    reference: 'Ref',
    company: 'Authority',
    customer: 'Customer',
    driver: 'Driver',
    pickup: 'Pickup',
    delivery: 'Delivery',
    deliveryDate: 'DEL date',
    truck: 'Truck',
    status: 'Status',
    billing: 'Billing',
    rate: 'Rate',
    copy: 'Copy load number',
    copied: 'Load {n} copied',
    copyFailed: 'Could not copy load {n}.',
    emptyTitle: 'No loads',
    emptyBody: 'Add one.',
    emptyFilteredTitle: 'Nothing matches',
    emptyFilteredBody: 'Clear the filters.',
    clearFilters: 'Clear filters',
  }

  async function renderList(visible: readonly string[]) {
    const { LoadsTable } = await import('@/app/(app)/loads/LoadsTable')
    const { ToastProvider } = await import('@/components/ui/Toast')
    render(
      <ToastProvider>
        <LoadsTable
          rows={[row]}
          showCompanyColumn
          columnCap={gridColumnCap('loads.loads')}
          expandLabels={expandLabels}
          menuLabels={menuLabels}
          visible={visible}
          labels={labels}
          statusLabels={{ IN_TRANSIT: 'In transit' }}
          billingLabels={{ UNINVOICED: 'Not invoiced' }}
          mayOpen={{ customer: true, driver: true, truck: true }}
        />
      </ToastProvider>,
    )
    return screen.getAllByRole('columnheader')
  }

  it('ten headers by default, the authority and warnings among them', async () => {
    const available = columnKeysFor(LOAD_COLUMN_KEYS, true)
    const headers = await renderList(
      visibleFromMemory(
        available,
        LOAD_COLUMNS_HIDDEN,
        null,
        gridColumnCap('loads.loads'),
      ),
    )
    expect(headers.length).toBe(10)
    // THE AUTHORITY COLUMN tells six carriers' freight apart, so it had better
    // be shown; dropping it would "fix" the cap by hiding the distinction.
    const text = headers.map((cell) => cell.textContent)
    expect(text).toContain('Authority')
    expect(text).toContain('Pickup')
    expect(text).toContain('Warnings')
    expect(text).not.toContain('Rate')
  })

  it('and every column at once is what throws, so the cap is load-bearing', async () => {
    // THE FAILURE ITSELF, OBSERVED. Hand the component all twelve and the
    // grid's cap throws — proof that the ten above is the cap and not a
    // coincidence of this fixture.
    await expect(
      renderList(columnKeysFor(LOAD_COLUMN_KEYS, true)),
    ).rejects.toThrow(/10 columns at most; this one has 12/)
  })
})
