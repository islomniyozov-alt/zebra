import type { ReactNode } from 'react'
import { TONE_STRIPE, type StatusTone } from '@/lib/status'
import Link from 'next/link'
import { cx } from '@/lib/cx'

// §7.1 — the primary interface of the application. Everything else is support.
//
//   * Sticky header, surface-2, 11px, weight 600, ink-2, uppercase, 0.04em.
//   * Hairline row separators. NO ZEBRA STRIPING, despite the name — stripes
//     fight the status stripe and halve the legibility of the soft status
//     fills. The name is a stripe that carries information; that is the joke
//     and it only works once.
//   * Alignment: text left · numbers right · dates left · status left, after
//     the stripe.
//   * Nine visible columns maximum.
//   * Truncate addresses and commodity. NEVER truncate a load number, an
//     invoice number or a money figure — those are the fields people copy.
//   * Rows never animate, on insert, sort or filter (§11).

export type ColumnAlign = 'start' | 'end'

export interface Column<Row> {
  key: string
  /** Already translated by the caller — the table does no i18n itself. */
  header: string
  align?: ColumnAlign
  /** Addresses and commodity, yes. Identifiers and money, never. */
  truncate?: boolean
  render: (row: Row) => ReactNode
  /**
   * §7.1.1 — this header becomes a link that sorts by this column.
   *
   * The SORTING ITSELF IS NOT HERE. `applyList` in `lib/list-view.ts` orders the
   * rows by the column's stored value before they reach this component; this
   * flag only says the header is operable. A column marked sortable whose key
   * has no entry in the shape's `sorts` renders a header that reorders nothing,
   * so `tests/list-view.test.ts` checks the pair for the screens in Accounting.
   */
  sortable?: boolean
  /**
   * §7.1.2 — what this column contributes to the sticky foot.
   *
   * IT IS HANDED THE FILTERED SET, NOT THE PAGE. `footRows` below, defaulting to
   * `rows` where a grid does not paginate. Corrected 2026-09-28 from the
   * artefact: Datatruck prints `1-20 of 251` beside a sum over all 251, and that
   * is the useful answer — an accountant filtering to one authority's week wants
   * what the week costs, not what its first twenty rows cost.
   *
   * Absent leaves the foot cell empty, which is the right answer for a status
   * column: a count of statuses is a number nobody asked for.
   */
  foot?: (rows: readonly Row[]) => ReactNode
}

/**
 * §7.1.1 — the current order, and where each header points.
 *
 * LINKS RATHER THAN CLIENT STATE, which is what keeps this component
 * server-rendered and what makes a sorted view a URL somebody can send (the
 * same argument §7.4 makes for filters). It also works with JavaScript off and
 * gives the keyboard and middle-click their ordinary behaviour for free.
 */
export interface TableSort {
  /** The column actually in force, after `activeSort`'s fallback. */
  key: string
  dir: 'asc' | 'desc'
  /** The URL that sorts by this column, built by the page from its own params. */
  hrefFor: (columnKey: string) => string
  /** Announced on every sortable header. Translated by the caller. */
  label: string
}

interface TableProps<Row> {
  columns: ReadonlyArray<Column<Row>>
  rows: readonly Row[]
  rowKey: (row: Row) => string
  /** §2 — the 3px leading-edge bar. One meaning per screen. */
  stripeTone?: (row: Row) => StatusTone
  /** §2 — cancelled rows get the muted stripe AND 60% text opacity. */
  isCancelled?: (row: Row) => boolean
  /** Rendered in place of the body. Every table has a written empty state. */
  empty: ReactNode
  /** Announced to screen readers; the visible title lives in the page header. */
  caption: string
  /**
   * Where this row's detail lives. Makes the WHOLE row clickable.
   *
   * §7.1 HAS SPECIFIED THIS SINCE PHASE 1 AND THIS COMPONENT NEVER DID IT:
   * "The whole row is clickable via a stretched-link `::after` on a real
   * anchor — middle-click and keyboard both work. Interactive controls inside
   * the row raise `z-index` as dead zones."
   *
   * Every list instead put a link on one cell, so the target was the width of
   * a name and the other eight columns did nothing. The owner reported it as
   * "rows aren't clickable"; the design system had been saying so for five
   * phases.
   *
   * A REAL ANCHOR, not an onClick. Middle-click opens a tab, ⌘-click opens a
   * tab, the keyboard reaches it in tab order, and a screen reader announces
   * it with the row's own first cell as its name. A `<tr onClick>` gives none
   * of that and is the reason the rule specifies the mechanism.
   */
  rowHref?: (row: Row) => string | null
  /** §7.1.1. Absent means no header is operable. */
  sort?: TableSort
  /**
   * §7.1.2 — the sticky foot.
   *
   * THE LABEL SAYS HOW MANY ROWS IT TOTALLED, and the caller composes it because
   * the caller has both the count and the translator. A foot that silently
   * totalled the query while the body rendered the filter is the most expensive
   * kind of wrong on a financial screen, so the scope is stated in words rather
   * than implied by position.
   */
  totals?: { label: string }
  /**
   * The rows the foot sums — every row the filter selected, across pages.
   *
   * Omitted on a grid with no pagination, where the page IS the filtered set.
   * Passing it explicitly rather than inferring it means a paginated grid that
   * forgets is a grid whose foot sums twenty rows and says 251, which is exactly
   * the disagreement §7.1.2 exists to prevent — so
   * `tests/accounting-surface.test.ts` checks that every paginated grid passes it.
   */
  footRows?: readonly Row[]
  /**
   * Rendered INSIDE the scrolling region, immediately below the last row.
   *
   * For a continuation that belongs to the rows rather than to the page — the
   * batches grid's per-authority breakdown (§6.2). Rendered after `<Table>`
   * instead, it lands at the bottom of the window, because this component's
   * container is `flex-1` and takes every pixel the shell has: a four-row grid
   * put the breakdown five hundred pixels below the four rows it describes.
   */
  below?: ReactNode
}

export function Table<Row>({
  columns,
  rows,
  rowKey,
  stripeTone,
  isCancelled,
  empty,
  caption,
  rowHref,
  sort,
  totals,
  footRows,
  below,
}: TableProps<Row>) {
  if (totals && columns[0]?.foot) {
    // The first foot cell carries the label, so a `foot` there would be
    // overwritten. Loud in development rather than silently dropped — the
    // leading column of a financial list is an identifier and is never summable
    // anyway, so this is a mistake rather than a limitation.
    throw new Error(
      `The first column ("${columns[0].key}") cannot have a foot: that cell ` +
        'carries the totals label. Move the sum to a money column.',
    )
  }
  if (columns.length > 9) {
    // §7.1. Anything beyond nine goes behind a column chooser. Failing loudly
    // in development beats discovering it on a 1080p screen at 6am.
    throw new Error(
      `A table may show nine columns at most; this one has ${columns.length}. ` +
        'Put the rest behind a column chooser.',
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-surface">
      <table className="w-full border-collapse text-start">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {/* The stripe column. No header text; it is not a data column. */}
            {stripeTone ? <th className="w-[3px] p-0" aria-hidden /> : null}
            {columns.map((column) => {
              const active = sort?.key === column.key
              return (
                <th
                  key={column.key}
                  scope="col"
                  // §7.1.1 — the caret is not the only signal. `aria-sort` says
                  // it to a screen reader, and the active header sits in `ink`
                  // where the others are `ink-2`.
                  aria-sort={
                    active
                      ? sort.dir === 'desc'
                        ? 'descending'
                        : 'ascending'
                      : undefined
                  }
                  className={cx(
                    'sticky top-0 z-10 border-b border-border bg-surface-2 px-z3 py-z2',
                    'text-xs font-semibold uppercase tracking-[0.04em]',
                    active ? 'text-ink' : 'text-ink-2',
                    column.align === 'end' ? 'text-end' : 'text-start',
                  )}
                >
                  {sort && column.sortable ? (
                    <Link
                      href={sort.hrefFor(column.key)}
                      scroll={false}
                      aria-label={`${column.header} — ${sort.label}`}
                      className={cx(
                        'inline-flex items-center gap-z1 uppercase tracking-[0.04em]',
                        'transition-colors duration-120 ease-out hover:text-accent',
                        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
                        column.align === 'end' && 'flex-row-reverse',
                      )}
                    >
                      {column.header}
                      {/* A caret only on the active column. An indicator on
                       * every sortable header is nine arrows competing with the
                       * one that means something. */}
                      <span aria-hidden className="text-ink-3">
                        {active ? (sort.dir === 'desc' ? '▾' : '▴') : ''}
                      </span>
                    </Link>
                  ) : (
                    column.header
                  )}
                </th>
              )
            })}
          </tr>
        </thead>

        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length + (stripeTone ? 1 : 0)}
                className="p-0"
              >
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const cancelled = isCancelled?.(row) ?? false
              const href = rowHref?.(row) ?? null
              return (
                <tr
                  key={rowKey(row)}
                  className={cx(
                    'group h-[var(--z-row-height)] border-b border-border',
                    'hover:bg-surface-3',
                    // `relative` is what the stretched link stretches to, and
                    // `focus-within` is how a keyboard shows where it is: the
                    // anchor's own outline would only wrap the name, which on
                    // a nine-column row is not where the eye goes.
                    href && 'relative cursor-pointer focus-within:bg-surface-3',
                    // Nothing else in the system reduces text opacity (§2).
                    cancelled && 'opacity-60',
                  )}
                >
                  {stripeTone ? (
                    <td
                      aria-hidden
                      className={cx(
                        'w-[3px] p-0',
                        TONE_STRIPE[cancelled ? 'muted' : stripeTone(row)],
                      )}
                    />
                  ) : null}
                  {columns.map((column, index) => (
                    <td
                      key={column.key}
                      className={cx(
                        // §5 table cell padding, and radius 0 on cells.
                        // §5.1: the body size follows the density, so
                        // Comfortable is 13px and the other two are 12px.
                        'px-z3 py-[var(--z-cell-pad-y)] text-[length:var(--z-body-size)]/[var(--z-body-line)] text-ink',
                        column.align === 'end' ? 'text-end' : 'text-start',
                        column.truncate && 'max-w-[1px] truncate',
                      )}
                    >
                      {/* THE FIRST CELL CARRIES THE ANCHOR, so the row's
                       * accessible name is the thing that identifies it —
                       * the load number, the broker's name — rather than a
                       * bare "open". Its `::after` covers the whole row. */}
                      {href && index === 0 ? (
                        <Link
                          href={href}
                          className="font-medium text-ink after:absolute after:inset-0 after:content-[''] hover:text-accent"
                        >
                          {column.render(row)}
                        </Link>
                      ) : (
                        column.render(row)
                      )}
                    </td>
                  ))}
                </tr>
              )
            })
          )}
        </tbody>

        {/* §7.1.2 — sticky foot, surface-2, a border-strong top rule, weight
         * 600, aligned to its columns. Suppressed on an empty body: "Total (0
         * rows) $0.00" under a written empty state is two answers to the same
         * question, and §10 says the empty state is the one that invites an
         * action. */}
        {totals && rows.length > 0 ? (
          <tfoot>
            <tr className="sticky bottom-0 z-10 bg-surface-2">
              {stripeTone ? (
                <td
                  aria-hidden
                  className="w-[3px] border-t border-border-strong p-0"
                />
              ) : null}
              {columns.map((column, index) => (
                <td
                  key={column.key}
                  className={cx(
                    'border-t border-border-strong px-z3 py-z2',
                    'text-[length:var(--z-body-size)]/[var(--z-body-line)] font-semibold text-ink',
                    column.align === 'end' ? 'text-end' : 'text-start',
                  )}
                >
                  {index === 0 ? (
                    <span className="text-xs uppercase tracking-[0.04em] text-ink-2">
                      {totals.label}
                    </span>
                  ) : (
                    (column.foot?.(footRows ?? rows) ?? null)
                  )}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
      {below}
    </div>
  )
}
