import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DENSITY,
  DENSITIES,
  MAX_SAVED_VIEWS,
  parseDensity,
  parseSavedViews,
  slugify,
} from '@/lib/preferences'

// The preference column is `Json` and the row is per user, so anything can end
// up in it — a future API, a hand-edited row, a shape from before a rename.
// The Loads screen is the most-used surface in the product and it does not
// fail to render because somebody's preference JSON is odd.

describe('reading saved views tolerates anything', () => {
  it('reads a well-formed list', () => {
    expect(
      parseSavedViews([
        { slug: 'mine', name: 'My trucks today', query: 'status=BOOKED' },
      ]),
    ).toEqual([
      { slug: 'mine', name: 'My trucks today', query: 'status=BOOKED' },
    ])
  })

  it.each([
    ['null', null],
    ['a string', 'view.loads'],
    ['an object', { slug: 'mine' }],
    ['a number', 42],
  ])('returns nothing for %s', (_label, value) => {
    expect(parseSavedViews(value)).toEqual([])
  })

  it('drops the malformed entries and keeps the rest', () => {
    // A partially-bad row loses one chip, not the whole bar.
    expect(
      parseSavedViews([
        { slug: 'ok', name: 'Fine', query: 'status=BOOKED' },
        { slug: '', name: 'No slug', query: '' },
        { name: 'No slug at all', query: '' },
        null,
        'nonsense',
        { slug: 'ok2', name: 'Also fine', query: '' },
      ]).map((view) => view.slug),
    ).toEqual(['ok', 'ok2'])
  })

  it('normalises the query through the parser that will read it', () => {
    // What is stored has to be something this application can put in a URL.
    // A leading `?` is stripped, which is what makes the round trip safe: the
    // chip builds `${pathname}?${query}` and a stored `?` would double it.
    expect(
      parseSavedViews([
        { slug: 'x', name: 'X', query: '?status=BOOKED&status=DELIVERED' },
      ])[0]?.query,
    ).toBe('status=BOOKED&status=DELIVERED')
  })

  it('caps on READ as well as on write', () => {
    // A row written before the cap existed should not render forty chips.
    const many = Array.from({ length: 50 }, (_, index) => ({
      slug: `v${index}`,
      name: `View ${index}`,
      query: '',
    }))
    expect(parseSavedViews(many)).toHaveLength(MAX_SAVED_VIEWS)
  })

  it('lets the last write win on a duplicate slug', () => {
    const views = parseSavedViews([
      { slug: 'mine', name: 'Old', query: 'a=1' },
      { slug: 'mine', name: 'New', query: 'b=2' },
    ])
    expect(views).toHaveLength(1)
    expect(views[0]?.name).toBe('New')
  })

  it('truncates a name long enough to break the chip row', () => {
    expect(
      parseSavedViews([{ slug: 'x', name: 'n'.repeat(300), query: '' }])[0]
        ?.name,
    ).toHaveLength(60)
  })
})

describe('density (§5.1)', () => {
  // The value ends up in a `data-density` attribute, so this parser is also
  // the thing that stops a preference row putting arbitrary text in the DOM.

  it.each(DENSITIES)('accepts %s', (mode) => {
    expect(parseDensity(mode)).toBe(mode)
  })

  it.each([
    ['nothing set', null],
    ['a mode that was renamed away', 'cosy'],
    ['a number', 3],
    ['an object', { mode: 'compact' }],
    ['markup', '"><script>'],
  ])('falls back to Standard for %s', (_label, value) => {
    expect(parseDensity(value)).toBe(DEFAULT_DENSITY)
    expect(parseDensity(value)).toBe('standard')
  })

  it('offers exactly the three modes the design system defines', () => {
    expect(DENSITIES).toEqual(['compact', 'standard', 'comfortable'])
  })
})

describe('slugify', () => {
  it.each([
    ['My trucks today', 'my-trucks-today'],
    ['  Spaced  Out  ', 'spaced-out'],
    ['Reefer / TX → IL', 'reefer-tx-il'],
    ['Грузы сегодня', ''],
  ])('%s → %s', (name, expected) => {
    expect(slugify(name)).toBe(expected)
  })

  it('is empty for a name with nothing sluggable in it', () => {
    // Which the caller treats as "no name" and refuses — better than saving a
    // view nobody can tell apart from the next one.
    expect(slugify('!!!')).toBe('')
    expect(slugify('   ')).toBe('')
  })
})
