import { describe, expect, it } from 'vitest'
import {
  activeSort,
  applyList,
  dayBound,
  isFiltered,
  readListParams,
  sortHref,
  sumCents,
  totalsLabel,
  type ListShape,
} from '@/lib/list-view'

// ---------------------------------------------------------------------------
// THE FOUR CONTROLS EVERY ACCOUNTING LIST HAS (§7.1.1, §7.1.2, §7.4.1, §7.4.2).
//
// Five screens share this module so that "inclusive" means one thing. These are
// the cases where it could quietly mean two.
// ---------------------------------------------------------------------------

interface Row {
  id: string
  name: string
  companyId: string
  at: Date | null
  cents: number
}

const on = (day: string) => new Date(`${day}T00:00:00.000Z`)

const ROWS: Row[] = [
  {
    id: 'a',
    name: 'Werner',
    companyId: 'c1',
    at: on('2026-09-13'),
    cents: 1000,
  },
  {
    id: 'b',
    name: 'amazon',
    companyId: 'c2',
    at: on('2026-09-19'),
    cents: 999,
  },
  { id: 'c', name: 'Brace', companyId: 'c1', at: on('2026-09-20'), cents: 250 },
  { id: 'd', name: 'Undated', companyId: 'c2', at: null, cents: 5 },
]

const SHAPE: ListShape<Row> = {
  searchText: (row) => row.name,
  dateOf: (row) => row.at,
  companyIdOf: (row) => row.companyId,
  sorts: {
    name: (row) => row.name,
    cents: (row) => row.cents,
    at: (row) => row.at?.getTime() ?? null,
  },
  defaultSort: 'name',
}

const ids = (rows: readonly Row[]) => rows.map((row) => row.id)

describe('reading the four controls off a URL', () => {
  it('treats a blank or whitespace query as absent', () => {
    // NOT an empty string: `q=''` reaching the filter would match every row and
    // read as a search that found everything, which is true and useless.
    expect(readListParams({ q: '   ' }).q).toBeNull()
    expect(readListParams({ q: '' }).q).toBeNull()
    expect(readListParams({}).q).toBeNull()
    expect(readListParams({ q: ' 5284 ' }).q).toBe('5284')
  })

  it('takes the first of a repeated key', () => {
    expect(readListParams({ q: ['first', 'second'] }).q).toBe('first')
  })

  it('is ascending unless the URL says desc', () => {
    expect(readListParams({ dir: 'desc' }).dir).toBe('desc')
    expect(readListParams({ dir: 'DESC' }).dir).toBe('asc')
    expect(readListParams({ dir: 'sideways' }).dir).toBe('asc')
    expect(readListParams({}).dir).toBe('asc')
  })

  it('knows when nothing is filtering', () => {
    expect(isFiltered(readListParams({}))).toBe(false)
    expect(isFiltered(readListParams({ sort: 'cents', dir: 'desc' }))).toBe(
      false,
    )
    expect(isFiltered(readListParams({ q: 'x' }))).toBe(true)
    expect(isFiltered(readListParams({ from: '2026-09-13' }))).toBe(true)
    expect(isFiltered(readListParams({ company: 'c1' }))).toBe(true)
  })
})

// ── THE BOUNDS ARE INCLUSIVE, AND NOT SYMMETRIC ─────────────────────────────
//
// A date input gives a day, not an instant. `to=2026-09-19` taken as midnight
// would exclude everything that happened ON the 19th — and a settlement week
// ends on a Saturday, which is exactly where MONEY-DESIGN §0 says a day's slip
// puts money in the wrong week and looks like nothing.
describe('dayBound', () => {
  it('starts at midnight and ends at the last millisecond', () => {
    expect(dayBound('2026-09-19', 'start')?.toISOString()).toBe(
      '2026-09-19T00:00:00.000Z',
    )
    expect(dayBound('2026-09-19', 'end')?.toISOString()).toBe(
      '2026-09-19T23:59:59.999Z',
    )
  })

  it('refuses anything that is not a day rather than guessing', () => {
    for (const value of ['', 'today', '2026-9-19', '19/09/2026', undefined]) {
      expect(dayBound(value, 'start')).toBeNull()
    }
  })

  it('refuses a day that does not exist', () => {
    // `2026-02-31` PARSES in JavaScript and comes back as March 3rd, so a
    // round-trip check is the only thing that catches it — and without it the
    // list would filter by a day nobody chose and show it to nobody.
    expect(new Date('2026-02-31T00:00:00.000Z').getTime()).not.toBeNaN()
    expect(dayBound('2026-02-31', 'start')).toBeNull()
    expect(dayBound('2026-13-01', 'start')).toBeNull()
  })
})

describe('filtering', () => {
  it('matches the search case-insensitively', () => {
    expect(
      ids(applyList(ROWS, readListParams({ q: 'AMAZON' }), SHAPE)),
    ).toEqual(['b'])
    expect(ids(applyList(ROWS, readListParams({ q: 'race' }), SHAPE))).toEqual([
      'c',
    ])
  })

  it('keeps a row on the range boundary at both ends', () => {
    const params = readListParams({ from: '2026-09-13', to: '2026-09-19' })
    expect(ids(applyList(ROWS, params, SHAPE))).toEqual(['b', 'a'])
  })

  it('treats `from` alone as since', () => {
    const params = readListParams({ from: '2026-09-20' })
    expect(ids(applyList(ROWS, params, SHAPE))).toEqual(['c'])
  })

  it('treats `to` alone as until', () => {
    const params = readListParams({ to: '2026-09-13' })
    expect(ids(applyList(ROWS, params, SHAPE))).toEqual(['a'])
  })

  it('puts an undated row OUT of every range, not in all of them', () => {
    // An undated invoice is not "issued in September". Keeping it would put a
    // row in a total whose bounds it does not satisfy — and the totals row is
    // the number the reader came for.
    const params = readListParams({ from: '2000-01-01', to: '2099-12-31' })
    expect(ids(applyList(ROWS, params, SHAPE))).not.toContain('d')
    // And with no range at all it is present, which is the other half.
    expect(ids(applyList(ROWS, readListParams({}), SHAPE))).toContain('d')
  })

  it('narrows by company', () => {
    const params = readListParams({ company: 'c1' })
    expect(ids(applyList(ROWS, params, SHAPE)).sort()).toEqual(['a', 'c'])
  })

  it('applies the controls together, not in turn', () => {
    const params = readListParams({ company: 'c1', from: '2026-09-14' })
    expect(ids(applyList(ROWS, params, SHAPE))).toEqual(['c'])
  })

  it('ignores a range on a list that has no date', () => {
    const shape: ListShape<Row> = { ...SHAPE, dateOf: undefined }
    const params = readListParams({ from: '2026-09-20' })
    // ALL FOUR, not zero. A range silently matching nothing on a list with no
    // date would look like a screen with no data.
    expect(applyList(ROWS, params, shape)).toHaveLength(4)
  })
})

describe('sorting', () => {
  it('falls back to the default when the column is unknown', () => {
    // A stale link should OPEN. The alternative is an error page for a URL that
    // used to work, which is the worst outcome for a shared view.
    expect(activeSort(readListParams({ sort: 'gone' }), SHAPE).key).toBe('name')
    expect(activeSort(readListParams({}), SHAPE).key).toBe('name')
  })

  it("uses the column's default direction only until the reader clicks", () => {
    const shape: ListShape<Row> = { ...SHAPE, defaultDir: 'desc' }
    expect(activeSort(readListParams({}), shape).dir).toBe('desc')
    // Once `sort` is in the URL the direction is theirs, including ascending.
    expect(activeSort(readListParams({ sort: 'name' }), shape).dir).toBe('asc')
  })

  it('sorts money by its stored value, not its rendered string', () => {
    // §7.1.1's own example: `$1,000.00` sorts ABOVE `$9.99` as text and BELOW it
    // as money. 1000 cents and 999 cents are the same trap one order of
    // magnitude down, and the rendered form is the one a reader would blame.
    const params = readListParams({ sort: 'cents', dir: 'desc' })
    expect(ids(applyList(ROWS, params, SHAPE))).toEqual(['a', 'b', 'c', 'd'])
    expect(
      ids(applyList(ROWS, readListParams({ sort: 'cents' }), SHAPE)),
    ).toEqual(['d', 'c', 'b', 'a'])
  })

  it('puts nulls last in BOTH directions', () => {
    // A missing value is not the smallest value — "—" at the top of a column
    // sorted by amount reads as zero, and §8 is explicit that empty and zero are
    // different facts.
    expect(ids(applyList(ROWS, readListParams({ sort: 'at' }), SHAPE))).toEqual(
      ['a', 'b', 'c', 'd'],
    )
    expect(
      ids(applyList(ROWS, readListParams({ sort: 'at', dir: 'desc' }), SHAPE)),
    ).toEqual(['c', 'b', 'a', 'd'])
  })

  it('does not reorder the array it was given', () => {
    const original = [...ROWS]
    applyList(ROWS, readListParams({ sort: 'cents' }), SHAPE)
    expect(ROWS).toEqual(original)
  })
})

describe('sortHref', () => {
  const current = { key: 'cents', dir: 'asc' as const }

  it('flips the active column and starts a new one ascending', () => {
    // Inheriting the old direction is what makes a second click feel broken: a
    // reader who sorted amounts high-to-low and then clicks Customer means "A
    // first".
    expect(sortHref('/x', {}, 'cents', current)).toBe('/x?sort=cents&dir=desc')
    expect(sortHref('/x', {}, 'name', current)).toBe('/x?sort=name')
    expect(sortHref('/x', {}, 'cents', { key: 'cents', dir: 'desc' })).toBe(
      '/x?sort=cents',
    )
  })

  it('keeps every other filter', () => {
    // A sort link that dropped `from` and `to` would widen the totals row under
    // the reader's hand — and the totals row is what they were sorting in order
    // to read.
    const href = sortHref(
      '/x',
      { q: '5284', from: '2026-09-13', to: '2026-09-19', company: 'c1' },
      'name',
      current,
    )
    expect(href).toContain('q=5284')
    expect(href).toContain('from=2026-09-13')
    expect(href).toContain('to=2026-09-19')
    expect(href).toContain('company=c1')
    expect(href).toContain('sort=name')
  })

  it('drops an empty param rather than carrying it', () => {
    expect(sortHref('/x', { q: '' }, 'name', current)).toBe('/x?sort=name')
  })
})

describe('the totals row', () => {
  it('sums only what it was handed', () => {
    const shown = applyList(ROWS, readListParams({ company: 'c1' }), SHAPE)
    expect(sumCents(shown, (row) => row.cents)).toBe(1250)
    expect(sumCents(ROWS, (row) => row.cents)).toBe(2254)
  })

  it('states the count even when nothing was filtered out', () => {
    // §7.1.2: "a filtered total and an unfiltered one must never render
    // identically". So there is no branch that omits the number.
    expect(totalsLabel('Total', 4, 'rows')).toBe('Total (4 rows)')
    expect(totalsLabel('Total', 0, 'rows')).toBe('Total (0 rows)')
  })
})
