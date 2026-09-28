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
}

export const LIST_PARAM_KEYS = ['q', 'sort', 'dir', 'from', 'to', 'company']

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
  }
}

/** True when any of the four controls is doing something. */
export function isFiltered(params: ListParams): boolean {
  return (
    params.q !== null ||
    params.from !== null ||
    params.to !== null ||
    params.company !== null
  )
}

export type SortValue = string | number | null

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
