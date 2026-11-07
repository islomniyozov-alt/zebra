/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Table } from '@/components/ui/Table'
import { gridColumnCap } from '@/lib/grid-columns'
import {
  columnKeysFor,
  LOAD_COLUMN_KEYS,
  LOAD_COLUMNS_HIDDEN,
  visibleFromMemory,
} from '@/lib/list-columns'

// ---------------------------------------------------------------------------
// §7.1 (amended 2026-11-07) — A COLUMN IS AS WIDE AS WHAT IT HOLDS.
//
// Owner's review of /loads on dev: "Authority, Broker and Pickup have more room
// than they need while Driver truncates." Measured there at 1920, the browser's
// own distribution gave DEL date 202 px for a twelve-character date and Status
// 201 px for a badge, while Driver had 123 px and cut 70 rows of 100.
//
// So a column that is never truncated is FITTED (`fit: 'content'`: header width
// zero, nothing wraps) and the truncating columns take the rest by `share`.
//
// ── WHAT IS PINNED, AND WHY IN TWO WAYS ───────────────────────────────────
//
// The declarations are read off the loads list's source, column by column,
// because the rule names WHICH columns are fitted and a render alone would pass
// with the wrong set fitted as long as some set was. The render then proves the
// declarations reach the markup — the classes on the header and the cell, the
// percentage on the header — and that a grid that fits nothing is untouched,
// because `Table` is every grid's table and the opt-in is the whole reason the
// change could ship on one screen.
// ---------------------------------------------------------------------------

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/loads',
}))

afterEach(cleanup)

const SOURCE = 'src/app/(app)/loads/LoadsTable.tsx'
/** §6.7: the seven that are never truncated. */
const FITTED = [
  'loadNumber',
  'deliveryDate',
  'truck',
  'status',
  'billing',
  'rate',
  'warnings',
]
/** §6.7: the five that share what is left. */
const SHARED = ['company', 'customer', 'pickup', 'delivery', 'driver']

describe('the loads list declares the widths §6.7 names', () => {
  const source = readFileSync(SOURCE, 'utf8')

  /** The column literal from its `key:` line to its `render:`. */
  const literal = (key: string): string => {
    const start = source.indexOf(`key: '${key}',`)
    expect(start, `no column '${key}' in ${SOURCE}`).toBeGreaterThan(-1)
    const end = source.indexOf('render:', start)
    expect(end, `no render after '${key}'`).toBeGreaterThan(start)
    return source.slice(start, end)
  }

  it('names every column once, so the slices below are the columns', () => {
    for (const key of [...FITTED, ...SHARED]) {
      expect(source.split(`key: '${key}',`).length - 1, key).toBe(1)
    }
  })

  for (const key of FITTED) {
    it(`${key} is fitted to its content and does not truncate`, () => {
      // LINE-ANCHORED: a commented-out `fit` would contain the string too.
      expect(literal(key)).toMatch(/^\s*fit: 'content',$/m)
      expect(literal(key)).not.toMatch(/truncate: true/)
    })
  }

  for (const key of SHARED) {
    it(`${key} truncates and is not fitted`, () => {
      expect(literal(key)).toMatch(/^\s*truncate: true,$/m)
      expect(literal(key)).not.toMatch(/fit:/)
    })
  }

  it('driver alone takes two shares, because it holds two seats', () => {
    expect(literal('driver')).toMatch(/^\s*share: 2,$/m)
    for (const key of SHARED.filter((k) => k !== 'driver')) {
      expect(literal(key), key).not.toMatch(/share:/)
    }
  })
})

describe('and the render carries them', () => {
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
    customer: 'Broker',
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

  async function renderList(showCompanyColumn: boolean) {
    const { LoadsTable } = await import('@/app/(app)/loads/LoadsTable')
    const { ToastProvider } = await import('@/components/ui/Toast')
    const available = columnKeysFor(LOAD_COLUMN_KEYS, showCompanyColumn)
    render(
      <ToastProvider>
        <LoadsTable
          rows={[row]}
          showCompanyColumn={showCompanyColumn}
          columnCap={gridColumnCap('loads.loads')}
          expandLabels={expandLabels}
          menuLabels={menuLabels}
          visible={visibleFromMemory(
            available,
            LOAD_COLUMNS_HIDDEN,
            null,
            gridColumnCap('loads.loads'),
          )}
          labels={labels}
          statusLabels={{ IN_TRANSIT: 'In transit' }}
          billingLabels={{ UNINVOICED: 'Not invoiced' }}
          mayOpen={{ customer: true, driver: true, truck: true }}
        />
      </ToastProvider>,
    )
    const headers = screen.getAllByRole('columnheader')
    const header = (name: string): HTMLElement => {
      const found = headers.find((cell) => cell.textContent === name)
      expect(found, `no header "${name}"`).toBeDefined()
      return found!
    }
    return { header }
  }

  it('a fitted header asks for no width and nothing in its column wraps', async () => {
    const { header } = await renderList(true)
    for (const name of ['Load', 'DEL date', 'Truck', 'Status', 'Warnings']) {
      expect(header(name).className, name).toContain('w-0')
      expect(header(name).className, name).toContain('whitespace-nowrap')
      expect(header(name).style.width, name).toBe('')
    }
    // The cells follow the header: the badge does not wrap, the driver may
    // truncate and must still be allowed to.
    const status = screen.getByText('In transit').closest('td')!
    expect(status.className).toContain('whitespace-nowrap')
    const driver = screen.getByText('Hassan Ali').closest('td')!
    expect(driver.className).toContain('truncate')
    expect(driver.className).not.toContain('whitespace-nowrap')
  })

  /**
   * The percentage, as a number. jsdom serialises `40.00%` back as `40%`, so
   * the string is not the thing to compare.
   */
  const percent = (cell: HTMLElement): number => {
    expect(cell.style.width, cell.textContent ?? '').toMatch(/%$/)
    return Number.parseFloat(cell.style.width)
  }

  it('the truncating headers share the rest: one each, driver two', async () => {
    const { header } = await renderList(true)
    // Five truncating columns, six shares: 1/6 and 2/6.
    expect(percent(header('Driver'))).toBeCloseTo(100 / 3, 1)
    for (const name of ['Authority', 'Broker', 'Pickup', 'Delivery']) {
      expect(percent(header(name)), name).toBeCloseTo(100 / 6, 1)
      expect(header(name).className, name).not.toContain('w-0')
    }
  })

  it('without the authority column the shares renormalise over four', async () => {
    const { header } = await renderList(false)
    expect(percent(header('Driver'))).toBeCloseTo(40, 1)
    for (const name of ['Broker', 'Pickup', 'Delivery']) {
      expect(percent(header(name)), name).toBeCloseTo(20, 1)
    }
  })
})

describe('a grid that fits no column is laid out exactly as before', () => {
  // THE OPT-IN IS THE WHOLE POINT. `Table` is every grid's table; a `share`
  // declared on a grid with no fitted column must do nothing, or the twenty
  // accounting grids would move on a chain that reviewed one list.
  it('no percentage on any header and no zero width', () => {
    render(
      <Table
        columns={[
          { key: 'a', header: 'A', truncate: true, render: () => 'x' },
          {
            key: 'b',
            header: 'B',
            truncate: true,
            share: 2,
            render: () => 'y',
          },
          { key: 'c', header: 'C', render: () => 'z' },
        ]}
        rows={[{ id: '1' }]}
        rowKey={(r) => r.id}
        empty={null}
        caption="three columns"
      />,
    )
    for (const cell of screen.getAllByRole('columnheader')) {
      expect(cell.style.width, cell.textContent ?? '').toBe('')
      expect(cell.className, cell.textContent ?? '').not.toContain('w-0')
      expect(cell.className).not.toContain('whitespace-nowrap')
    }
  })
})
