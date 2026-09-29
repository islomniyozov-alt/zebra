// ---------------------------------------------------------------------------
// SEARCH, SORT, DATE RANGE AND COMPANY, FOR EVERY LIST IN ACCOUNTING.
//
// §7.1.1, §7.1.2, §7.4.1 and §7.4.2, in one module, because five screens
// needing the same four controls is five chances to disagree about what
// "inclusive" means.
//
// ── PURE, AND IN `lib` ────────────────────────────────────────────────────
//
// Nothing here touches a database or a request. The pages read rows however
// they read them and hand them to `applyList`, which means the rules below are
// testable without standing up an org, a session or a transaction — the reason
// AGENTS.md puts domain logic here rather than in the page that renders it.
//
// IT FILTERS IN MEMORY, DELIBERATELY. Every list in this section is a page of
// at most a few hundred rows that the screen already totals, and a total has to
// be computed over the same rows the reader can see (§7.1.2). Pushing the
// predicate into SQL and the total into JavaScript is how those two come to
// disagree. Where a list outgrows that, the query gets a `take` and the screen
// says it is showing the first N — it does not quietly total a page.
// ---------------------------------------------------------------------------

/** Ascending unless something says otherwise. */
export type SortDirection = 'asc' | 'desc'

export interface ListParams {
  /** The typed query, trimmed, or null. Never an empty string — see below. */
  q: string | null
  /** A column key. Unvalidated here; `applyList` falls back if unknown. */
  sort: string | null
  dir: SortDirection
  /** Inclusive lower bound, midnight UTC of the day given. */
  from: Date | null
  /** Inclusive UPPER bound, the LAST MILLISECOND of the day given. */
  to: Date | null
  /** A company id, or null for every authority the session can see. */
  company: string | null
  /** 1-based. Out-of-range values are clamped by `paginate`, never rejected. */
  page: number
  /** Rows per page. One of `PAGE_SIZES`. */
  per: number
}

export const LIST_PARAM_KEYS = [
  'q',
  'sort',
  'dir',
  'from',
  'to',
  'company',
  'page',
  'per',
]

/**
 * §7.1.3 — 50 by default.
 *
 * NOT INFINITE SCROLL. §1's reader is comparing, and a list whose length they
 * cannot state is a list they cannot finish reading. A page size they can raise
 * is the compromise; 500 exists so "just show me all of it" has an answer that
 * is not the export.
 */
export const PAGE_SIZES = [25, 50, 100, 500] as const
export const DEFAULT_PAGE_SIZE = 50

/** What a Next.js `searchParams` hands over: one value, several, or nothing. */
export type RawParams = Record<string, string | string[] | undefined>

const one = (value: string | string[] | undefined): string | null => {
  // THE FIRST OF A REPEATED KEY, not the last and not a join. `?q=a&q=b` is
  // either a hand-edited URL or a bug upstream; taking the first is the only
  // choice that is stable under a reload, and joining them would search for a
  // string nobody typed.
  const first = Array.isArray(value) ? value[0] : value
  if (first === undefined) return null
  const trimmed = first.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * A DAY STRING TO AN INSTANT, or null.
 *
 * ── WHY THE BOUNDS ARE NOT SYMMETRIC ─────────────────────────────────────
 *
 * §7.4.1 says the range is INCLUSIVE at both ends. A date input gives a day,
 * not an instant, so `to=2026-09-19` has to mean "up to the last millisecond of
 * the 19th" — taken as midnight it would exclude everything that happened on
 * the day the reader asked for, and a settlement week's Saturday is exactly
 * where that lands. MONEY-DESIGN §0 is the same lesson about a week boundary:
 * a day off puts a Saturday's money in the wrong week and looks like nothing.
 *
 * REFUSED RATHER THAN GUESSED. Anything that is not `yyyy-mm-dd` is null, so a
 * truncated or hand-mangled URL opens the unfiltered list rather than a list
 * filtered by a date nobody chose.
 */
export function dayBound(
  value: string | string[] | undefined,
  edge: 'start' | 'end',
): Date | null {
  const text = one(value)
  if (text === null || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  const at = new Date(`${text}T00:00:00.000Z`)
  if (Number.isNaN(at.getTime())) return null
  // And the day has to round-trip: `2026-02-31` parses in JavaScript and comes
  // back as March 3rd, which would silently filter by a day that does not exist.
  if (at.toISOString().slice(0, 10) !== text) return null
  return edge === 'start' ? at : new Date(at.getTime() + 86_399_999)
}

export function readListParams(raw: RawParams): ListParams {
  return {
    q: one(raw.q),
    sort: one(raw.sort),
    // ANYTHING THAT IS NOT `desc` IS ASCENDING. A stale or typo'd `dir` should
    // open the list, not error and not invert it.
    dir: one(raw.dir) === 'desc' ? 'desc' : 'asc',
    from: dayBound(raw.from, 'start'),
    to: dayBound(raw.to, 'end'),
    company: one(raw.company),
    // CLAMPED, NOT REJECTED. `?page=0`, `?page=-3` and `?page=cheese` all open
    // page one — a pagination link somebody edited by hand should show them
    // something rather than an error, and the upper bound depends on how many
    // rows the filter left, which is not known here.
    page: Math.max(1, Math.trunc(Number(one(raw.page)) || 1)),
    per: PAGE_SIZES.includes(
      Number(one(raw.per)) as (typeof PAGE_SIZES)[number],
    )
      ? Number(one(raw.per))
      : DEFAULT_PAGE_SIZE,
  }
}

/** True when any of the four controls is doing something. */
export function isFiltered(params: ListParams, raw: RawParams = {}): boolean {
  return (
    params.q !== null ||
    params.from !== null ||
    params.to !== null ||
    params.company !== null ||
    Object.keys(raw).some((key) => key.startsWith('f.'))
  )
}

export type SortValue = string | number | null

/**
 * §6.2.1 — the per-column funnels, and why they are allowed.
 *
 * §7.4 objects to "dropdown menus where three chips would do" and to filters in
 * a drawer, and the objection is to HIDDEN STATE: a control whose setting the
 * reader cannot see and cannot send to somebody. A funnel that writes a query
 * parameter has none — it lands in the URL beside the chips, the filter bar
 * shows it, and Clear filters clears it.
 *
 * `f.<column>` IS THE PARAMETER. Namespaced so a column called `status` cannot
 * collide with a screen's own `status` chip, which is exactly the pair that
 * exists on the Batches grid today.
 */
export const columnFilterParam = (columnKey: string) => `f.${columnKey}`

export interface ListShape<Row> {
  /**
   * Everything the search box matches, concatenated. Case-folded here, so a
   * caller never has to remember to.
   *
   * ONE STRING RATHER THAN A FIELD LIST, because what a reader means by "search"
   * on an invoice list is "the thing I can see" — the number, the customer, the
   * status word. A field-by-field search makes them guess which box they are in.
   */
  searchText: (row: Row) => string
  /**
   * The ONE date the range filters on, and the screen says which (§7.4.1).
   *
   * Absent means this list has no range, and `from`/`to` are then ignored
   * rather than silently matching nothing.
   */
  dateOf?: (row: Row) => Date | null
  /** Absent means the company chip does not apply to this list. */
  companyIdOf?: (row: Row) => string | null
  /**
   * Sortable columns, by the key their header uses. THE STORED VALUE, never the
   * rendered one — §7.1.1: `$1,000.00` sorts above `$9.99` as text and below it
   * as money, and the rendered form is the one a reader would blame.
   */
  sorts: Readonly<Record<string, (row: Row) => SortValue>>
  /** Used when `sort` is absent or names a column this list does not have. */
  defaultSort: string
  defaultDir?: SortDirection
  /**
   * What each funnel-able column matches on, by column key.
   *
   * THE SAME TEXT THE COLUMN RENDERS, as far as possible: a reader filtering the
   * Status column types what they can see in it. Where the rendered form is a
   * translated label the stored value is used instead and the funnel says so —
   * a filter that only worked in English would be worse than none.
   */
  columnFilters?: Readonly<Record<string, (row: Row) => string | null>>
}

/**
 * Which column this list is actually sorted by, after the fallback.
 *
 * Exported because the header needs it to draw the caret and set `aria-sort`,
 * and a header that decided for itself would drift from what the rows did.
 */
export function activeSort<Row>(
  params: ListParams,
  shape: ListShape<Row>,
): { key: string; dir: SortDirection } {
  const named = params.sort !== null && params.sort in shape.sorts
  return {
    key: named ? params.sort! : shape.defaultSort,
    // A COLUMN'S OWN DEFAULT DIRECTION ONLY APPLIES WHEN NOTHING WAS ASKED.
    // Once the reader has clicked, `dir` is theirs.
    dir: params.sort === null ? (shape.defaultDir ?? 'asc') : params.dir,
  }
}

/** Filter, then sort. Returns a new array; the input is never reordered. */
export function applyList<Row>(
  rows: readonly Row[],
  params: ListParams,
  shape: ListShape<Row>,
  /** The untouched query, for the `f.<column>` keys the funnels write. */
  raw: RawParams = {},
): Row[] {
  const needle = params.q?.toLowerCase() ?? null

  const kept = rows.filter((row) => {
    if (
      needle !== null &&
      !shape.searchText(row).toLowerCase().includes(needle)
    )
      return false

    if (shape.companyIdOf && params.company !== null) {
      if (shape.companyIdOf(row) !== params.company) return false
    }

    // ── THE COLUMN FUNNELS ────────────────────────────────────────────
    //
    // Applied with everything else rather than before or after it: a funnel is
    // one more predicate over the same rows, so the totals row and the count in
    // the footer cover it without knowing it exists.
    if (shape.columnFilters) {
      for (const [key, of] of Object.entries(shape.columnFilters)) {
        const wanted = one(raw[columnFilterParam(key)])
        if (wanted === null) continue
        const value = of(row)
        if (value === null) return false
        if (!value.toLowerCase().includes(wanted.toLowerCase())) return false
      }
    }

    if (shape.dateOf && (params.from !== null || params.to !== null)) {
      const at = shape.dateOf(row)
      // A ROW WITH NO DATE IS OUT OF EVERY RANGE, not in all of them. An
      // undated invoice is not "issued in September", and keeping it would put
      // a row in a total whose bounds it does not satisfy.
      if (at === null) return false
      if (params.from !== null && at.getTime() < params.from.getTime())
        return false
      if (params.to !== null && at.getTime() > params.to.getTime()) return false
    }

    return true
  })

  const { key, dir } = activeSort(params, shape)
  const value = shape.sorts[key]
  if (!value) return kept

  const sign = dir === 'desc' ? -1 : 1
  return kept.sort((left, right) => {
    const a = value(left)
    const b = value(right)
    // NULLS LAST IN BOTH DIRECTIONS. A missing value is not the smallest value
    // — "—" at the top of a column sorted by amount reads as zero, and §8 is
    // explicit that empty and zero are different facts.
    if (a === null && b === null) return 0
    if (a === null) return 1
    if (b === null) return -1
    if (typeof a === 'number' && typeof b === 'number') {
      return (a - b) * sign
    }
    return String(a).localeCompare(String(b)) * sign
  })
}

/**
 * The URL that sorts a list by one column, keeping every other filter.
 *
 * ── CLICKING THE ACTIVE COLUMN FLIPS IT; CLICKING ANOTHER STARTS IT ──────
 *
 * Starting ascending on a new column rather than inheriting the old direction:
 * a reader who sorted amounts high-to-low and then clicks Customer means "A
 * first", not "Z first", and inheriting would make the second click feel broken.
 *
 * EVERY OTHER PARAM SURVIVES, which is the whole reason this is a function and
 * not a template string in five pages. A sort link that dropped `from` and `to`
 * would silently widen the totals row under the reader's hand — and the totals
 * row is the number they were sorting in order to read.
 */
export function sortHref(
  pathname: string,
  raw: RawParams,
  columnKey: string,
  current: { key: string; dir: SortDirection },
): string {
  const next = new URLSearchParams()
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'sort' || key === 'dir') continue
    const single = Array.isArray(value) ? value[0] : value
    if (single !== undefined && single !== '') next.set(key, single)
  }
  next.set('sort', columnKey)
  if (columnKey === current.key && current.dir === 'asc')
    next.set('dir', 'desc')
  return `${pathname}?${next}`
}

/**
 * One page of a filtered list, and the numbers the footer says out loud.
 *
 * ── THE FOOTER SAYS WHICH PAGE, AND THAT IS THE WHOLE POINT ───────────────
 *
 * §7.1.3: the footer totals the rows ON THE PAGE and states `12 of 340`. A
 * footer that silently summed all 340 while showing 12 is §7.1.2's filter bug one
 * control further out, and pagination is exactly where it would appear — so both
 * numbers come out of here together and the screen cannot have one without the
 * other.
 *
 * `page` IS CLAMPED TO WHAT EXISTS. Deleting rows, or narrowing a filter while
 * on page 7, leaves a page number with nothing behind it; showing the last page
 * is the only answer that is not an empty grid the reader has to diagnose.
 */
export interface Paged<Row> {
  rows: Row[]
  /** After clamping. What the pagination control should show as current. */
  page: number
  pages: number
  /** Every row the filter selected, across all pages. */
  total: number
  /** 1-based index of the first row shown, or 0 when there are none. */
  firstRow: number
  lastRow: number
}

export function paginate<Row>(
  rows: readonly Row[],
  params: ListParams,
): Paged<Row> {
  const total = rows.length
  const pages = Math.max(1, Math.ceil(total / params.per))
  const page = Math.min(params.page, pages)
  const start = (page - 1) * params.per
  const slice = rows.slice(start, start + params.per)
  return {
    rows: slice,
    page,
    pages,
    total,
    firstRow: total === 0 ? 0 : start + 1,
    lastRow: start + slice.length,
  }
}

/** The URL for one page, keeping every filter. See `sortHref`'s reasoning. */
export function pageHref(
  pathname: string,
  raw: RawParams,
  page: number,
): string {
  const next = new URLSearchParams()
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'page') continue
    const single = Array.isArray(value) ? value[0] : value
    if (single !== undefined && single !== '') next.set(key, single)
  }
  if (page > 1) next.set('page', String(page))
  return next.size > 0 ? `${pathname}?${next}` : pathname
}

// ---------------------------------------------------------------------------
// COLUMNS (§7.1.4)
// ---------------------------------------------------------------------------

/**
 * Which columns a stored preference leaves visible.
 *
 * ── AN UNKNOWN STORED COLUMN IS IGNORED, NOT FATAL ────────────────────────
 *
 * A preference row outlives every deploy. Renaming a column must not empty
 * somebody's grid, and an unrecognised name in the list must not throw on a
 * screen they open every morning — so the stored list is INTERSECTED with what
 * the table actually has.
 *
 * AND AN EMPTY RESULT FALLS BACK TO EVERYTHING. A stored list that happens to
 * name nothing this table still has would otherwise render a grid with no
 * columns, which looks like a broken page rather than a stale preference.
 */
export function visibleColumns(
  available: readonly string[],
  stored: unknown,
): string[] {
  if (!Array.isArray(stored)) return [...available]
  const wanted = new Set(stored.filter((name) => typeof name === 'string'))
  const kept = available.filter((name) => wanted.has(name))
  return kept.length === 0 ? [...available] : kept
}

// ---------------------------------------------------------------------------
// EXPORT (§7.1.5)
// ---------------------------------------------------------------------------

/**
 * One CSV cell, quoted only where it has to be.
 *
 * A LEADING `=`, `+`, `-` OR `@` IS PREFIXED WITH AN APOSTROPHE. Excel and
 * Sheets treat those as the start of a formula, so a note reading
 * `=1+1` becomes a computed cell and a broker named `-Acme` becomes an error
 * value. This is the one transformation the export makes to a value, it is
 * applied to text only, and it is here rather than at a call site because every
 * column would otherwise need to remember.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return String(value)
  const guarded = /^[=+\-@]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded
}

/** Cents as arithmetic input: `1234.56`. No symbol, no separator (§7.1.5). */
export function csvMoney(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const absolute = Math.abs(cents)
  return `${sign}${Math.trunc(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`
}

/** A date as `yyyy-mm-dd`, or empty. Never a locale format — §12. */
export function csvDay(value: Date | null | undefined): string {
  return value ? value.toISOString().slice(0, 10) : ''
}

/**
 * A CSV document, with CRLF endings and a BOM.
 *
 * THE BOM IS NOT DECORATION. Excel on Windows reads a UTF-8 file without one as
 * the system codepage, so a Russian driver's name arrives as mojibake in the one
 * application this file exists to be opened in. CRLF for the same reason.
 */
export function toCsv(
  header: readonly string[],
  rows: readonly (readonly (string | number | null | undefined)[])[],
): string {
  const lines = [header.map(csvCell).join(',')]
  for (const row of rows) lines.push(row.map(csvCell).join(','))
  return `﻿${lines.join('\r\n')}\r\n`
}

/**
 * Sum one money column over the rows SHOWN (§7.1.2).
 *
 * Trivial, and here rather than inline in five pages so that "the rows shown"
 * is the only thing it can be handed. The hazard this exists against is a foot
 * that totals the query while the body renders the filter.
 */
export function sumCents<Row>(
  rows: readonly Row[],
  of: (row: Row) => number,
): number {
  return rows.reduce((total, row) => total + of(row), 0)
}

/**
 * The foot's leading cell: `Total (12 rows)`.
 *
 * §7.1.2 REQUIRES THE COUNT, and requires it even when the filter removed
 * nothing — "a filtered total and an unfiltered one must never render
 * identically". So there is no branch here that omits it.
 *
 * Composed rather than interpolated because `t` takes a key and returns a
 * string, with no placeholders: the two words arrive already translated and the
 * number goes between them.
 */
export function totalsLabel(
  total: string,
  count: number,
  rows: string,
): string {
  return `${total} (${count} ${rows})`
}
