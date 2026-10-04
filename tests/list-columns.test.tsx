/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { readGridColumns } from '@/lib/grid-columns'
import {
  BATCH_COLUMN_KEYS,
  BATCH_COLUMNS_HIDDEN,
  columnKeysFor,
  LOAD_COLUMN_KEYS,
  LOAD_COLUMNS_HIDDEN,
  TABLE_COLUMN_CAP,
  TRUCK_COLUMN_KEYS,
  TRUCK_COLUMNS_HIDDEN,
  visibleWithinCap,
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

// THE CHOOSER IS STUBBED, and only the chooser. It imports a `'use server'`
// module, which drags the Prisma client and the request context into a jsdom
// test for a popover this test makes no claim about. The claim here is the
// TABLE's column count — `Table`'s real throw, the real column list, the real
// `keepColumns`.
vi.mock('@/app/(app)/_grid/ColumnsChooser', () => ({
  ColumnsChooser: () => null,
}))

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
        // FOUR STORED STATES, INCLUDING THE TWO THAT ARRIVE FROM REAL ROWS:
        // `readGridColumns` returns everything when no preference exists, and a
        // row written before this cap existed can name more than nine columns
        // that all still exist.
        const stored = [
          available, // never chosen
          [], // a row that names nothing this table has
          [...available].reverse(), // ticked everything, in another order
          available.slice(0, 10), // ten real columns, hand-edited or historic
        ]
        for (const choice of stored) {
          const visible = visibleWithinCap(available, grid.hidden, choice)
          expect(visible.length).toBeLessThanOrEqual(TABLE_COLUMN_CAP)
          // AND NOT EMPTY. An empty list renders one column — the anchor
          // `keepColumns` keeps — which reads as a broken page, not a
          // preference.
          expect(visible.length).toBeGreaterThan(0)
          expect(visible[0]).toBe(available[0])
        }
      })
    }
  }

  it('a stored list of more than nine real columns is truncated, not handed on', () => {
    // A SYNTHETIC GRID, because neither real one can express this case. `/loads`
    // declares exactly ten columns with the authority one, so "ten stored" IS
    // "everything" and comes back as the default nine whether the slice exists
    // or not — the loop above passes this break on /loads for that reason and
    // proves nothing there. Twelve columns with eleven stored is a genuine
    // subset that is still over the cap, which is the only shape that isolates
    // the slice.
    const available = Array.from({ length: 12 }, (_, index) => `c${index}`)
    const visible = visibleWithinCap(available, ['c11'], available.slice(0, 11))
    expect(visible.length).toBe(TABLE_COLUMN_CAP)
    expect(visible[0]).toBe('c0')
  })

  it('a stored choice is honoured, in the table order and not the stored one', () => {
    const visible = visibleWithinCap(
      ['a', 'b', 'c'],
      ['c'],
      ['c', 'a'], // ticked in the other order
    )
    expect(visible).toEqual(['a', 'c'])
  })

  it('and the default set is what "everything" means', () => {
    expect(visibleWithinCap(['a', 'b', 'c'], ['b'], ['a', 'b', 'c'])).toEqual([
      'a',
      'c',
    ])
  })
})

describe('the cap lives in readGridColumns, so no grid can get past it', () => {
  // THE WHOLE POINT OF PUTTING IT THERE. Three pages each solved — or failed to
  // solve — this on their own; a fourth will be written by somebody who has not
  // read §7.1.7, and the only protection that survives that is the function they
  // cannot avoid calling.
  const txWith = (value: unknown) =>
    ({
      userPreference: {
        findFirst: async () => (value === undefined ? null : { value }),
      },
    }) as never

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
    const grids: { keys: readonly string[]; hidden: readonly string[] }[] = [
      { keys: LOAD_COLUMN_KEYS, hidden: LOAD_COLUMNS_HIDDEN },
      { keys: TRUCK_COLUMN_KEYS, hidden: TRUCK_COLUMNS_HIDDEN },
    ]
    for (const grid of grids) {
      // WITHOUT THE SLICE DOING THE WORK. The slice is the backstop for a stored
      // row; the default set has to stand on its own, or the first thing a new
      // user sees is a page whose last column was truncated silently.
      const shown = grid.keys.filter((key) => !grid.hidden.includes(key))
      expect(shown.length).toBeLessThanOrEqual(TABLE_COLUMN_CAP)
    }
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
    customerName: 'Amazon',
    pickup: 'Chicago, IL',
    delivery: 'Dallas, TX',
    truck: '104',
    operationalStatus: 'IN_TRANSIT' as const,
    billingStatus: 'UNINVOICED' as const,
    rate: '$2,450.00',
    isCancelled: false,
    warnings: [],
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
    pickup: 'Pickup',
    delivery: 'Delivery',
    truck: 'Truck',
    status: 'Status',
    billing: 'Billing',
    rate: 'Rate',
    emptyTitle: 'No loads',
    emptyBody: 'Add one.',
    emptyFilteredTitle: 'Nothing matches',
    emptyFilteredBody: 'Clear the filters.',
    clearFilters: 'Clear filters',
    columns: 'Columns',
    columnsApply: 'Apply',
    columnsCancel: 'Cancel',
    columnsFirstLocked: 'always shown',
  }

  async function renderList(visible: readonly string[]) {
    const { LoadsTable } = await import('@/app/(app)/loads/LoadsTable')
    render(
      <LoadsTable
        rows={[row]}
        showCompanyColumn
        visible={visible}
        labels={labels}
        statusLabels={{ IN_TRANSIT: 'In transit' }}
        billingLabels={{ UNINVOICED: 'Not invoiced' }}
        columnErrors={{}}
      />,
    )
    return screen.getAllByRole('columnheader')
  }

  it('nine headers, not ten', async () => {
    const headers = await renderList(
      visibleWithinCap(
        columnKeysFor(LOAD_COLUMN_KEYS, true),
        LOAD_COLUMNS_HIDDEN,
        columnKeysFor(LOAD_COLUMN_KEYS, true),
      ),
    )
    expect(headers.length).toBe(TABLE_COLUMN_CAP)
    // THE AUTHORITY COLUMN IS THE ONE THAT MADE IT TEN, so it had better be one
    // of the nine: dropping it would be "fixed" by hiding the thing that
    // distinguishes six carriers' freight from each other.
    expect(headers.map((cell) => cell.textContent)).toContain('Authority')
    expect(headers.map((cell) => cell.textContent)).toContain('Warnings')
  })

  it('and the ten-column list is what throws, so the cap is load-bearing', async () => {
    // THE FAILURE ITSELF, OBSERVED. Hand the component every column and §7.1's
    // throw is what a dispatcher met on 2026-09-20 — proof that the nine above
    // is the fix and not a coincidence of this fixture.
    await expect(
      renderList(columnKeysFor(LOAD_COLUMN_KEYS, true)),
    ).rejects.toThrow(/nine columns at most; this one has 10/)
  })
})
