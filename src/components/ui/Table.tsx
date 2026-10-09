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
   * §6.2.1 — this header gets a filter funnel writing `f.<key>`.
   *
   * THE MATCHING LIVES IN `ListShape.columnFilters`, not here: a column marked
   * filterable whose key has no entry there renders a control that narrows
   * nothing, which `tests/accounting-surface.test.ts` checks the pair for.
   */
  filterable?: boolean
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
  /**
   * A control after the cell's content, OUTSIDE the row's link (§6.7 item 4).
   *
   * The first cell's content is wrapped in the row's named anchor, and a button
   * inside an anchor is invalid HTML that opens the row instead of acting. This
   * renders after the anchor, raised above the cell's overlay (`relative z-10`,
   * §7.1), so it can be clicked without opening the row.
   */
  trailing?: (row: Row) => ReactNode
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
   * §6.2.1 — renders a funnel on each `filterable` column.
   *
   * A RENDER PROP, because the funnel is a client component and this one is not.
   * The page passes a factory so `Table` stays server-rendered: a client island
   * per header, rather than a client boundary around the whole grid.
   */
  funnelFor?: (columnKey: string, header: string) => ReactNode
  /**
   * §6.2.1 — a leading checkbox column, posting `name` per row.
   *
   * THE FORM IS THE CALLER'S. This renders inputs and nothing else: what the
   * selection DOES is a money question, and a component that rendered its own
   * action would be deciding it.
   */
  selection?: {
    name: string
    label: string
    /**
     * Start ticked (§6.2.10's trip picker).
     *
     * THE DEFAULT IS STILL UNTICKED, because a bulk bar acts on what somebody
     * chose. A picker is the other shape: everything settleable in the week is in
     * the batch unless the office takes it out, so its boxes start ticked and
     * unticking is the decision.
     */
    defaultChecked?: boolean
    /**
     * Start ticked PER ROW — the batch screen's grid, where a tick is "not
     * excluded" and the exclusions are persisted (§6.2.10 part 2). Wins over
     * `defaultChecked` when given.
     */
    defaultCheckedFor?: (row: Row) => boolean
    /**
     * Also post every row's key under this name, ticked or not.
     *
     * WHAT WAS ON THE SCREEN, WHICH IS NOT WHAT WAS TICKED. A picker that posted
     * only ticks makes the caller recompute the full set to find the difference —
     * and a trip that arrived between the render and the submit would then look
     * unticked rather than new. Posting the shown set makes the complement exact
     * and the race impossible.
     */
    alsoPost?: string
    /**
     * Rows that are shown but not offered. Default: every row is offered.
     *
     * NO CHECKBOX AND NO HIDDEN INPUT, which is the important half. A row that
     * posted its id without a tick would be read as a DECISION to leave it out —
     * on §6.2.10's picker that writes an exclusion, and an exclusion is never
     * un-done by a refresh, so a trip the system could not price today would stay
     * out of the batch after somebody fixed the pay rule. Offering nothing leaves
     * it pending instead, and it joins the moment it can be priced.
     */
    offerFor?: (row: Row) => boolean
  }
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
  /**
   * §6.2 — a continuation row rendered directly beneath its parent.
   *
   * THE BATCHES GRID'S PER-AUTHORITY BREAKDOWN, and the reason `below` was not
   * enough: rendered after the table it sat under the FOOT, so four batches and
   * their ten authority rows were two lists a reader had to match up by batch
   * number. §6.2 asks for "an indented continuation of its parent row", because
   * somebody comparing four authorities' shares of one week is comparing rows
   * that have to be adjacent (rule 1).
   *
   * IT IS A `<tr>`, NOT A NESTED TABLE. One table means one set of column
   * widths, so an authority's amount lines up under the batch's amount — which
   * is the entire point of putting it there.
   */
  rowDetail?: (row: Row) => ReactNode
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
  funnelFor,
  selection,
  totals,
  footRows,
  below,
  rowDetail,
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
            {selection ? (
              <th
                scope="col"
                className="sticky top-0 z-10 w-[32px] border-b border-border bg-surface-2 px-z2 py-z2"
              >
                <span className="sr-only">{selection.label}</span>
              </th>
            ) : null}
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
                  {column.filterable && funnelFor
                    ? funnelFor(column.key, column.header)
                    : null}
                </th>
              )
            })}
          </tr>
        </thead>

        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={
                  columns.length + (stripeTone ? 1 : 0) + (selection ? 1 : 0)
                }
                className="p-0"
              >
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const cancelled = isCancelled?.(row) ?? false
              const href = rowHref?.(row) ?? null
              const detail = rowDetail?.(row) ?? null
              return [
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
                  {selection ? (
                    // `relative z-10` — §7.1: an interactive control inside a
                    // row raises its stacking so the stretched link does not
                    // swallow the click. A checkbox under the row's anchor
                    // would open the row instead of ticking.
                    <td className="relative z-10 w-[32px] px-z2">
                      {(selection.offerFor ?? (() => true))(row) ? (
                        <>
                          <input
                            type="checkbox"
                            name={selection.name}
                            value={rowKey(row)}
                            defaultChecked={
                              selection.defaultCheckedFor
                                ? selection.defaultCheckedFor(row)
                                : (selection.defaultChecked ?? false)
                            }
                            aria-label={`${selection.label}: ${rowKey(row)}`}
                            className="size-[14px] accent-[var(--color-accent)]"
                          />
                          {selection.alsoPost ? (
                            <input
                              type="hidden"
                              name={selection.alsoPost}
                              value={rowKey(row)}
                            />
                          ) : null}
                        </>
                      ) : null}
                    </td>
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
                        // THE CELL IS THE CONTAINING BLOCK (§7.1, amended
                        // 2026-10-07). Chromium does not let a positioned
                        // <tr> contain the anchor's ::after, so a stretch
                        // "over the row" covered 97px of a 1,056px row on
                        // dev and the office reported rows that did not
                        // link. Each cell stretches its own anchor instead.
                        href && 'relative',
                      )}
                    >
                      {/* THE FIRST CELL CARRIES THE NAMED ANCHOR, so the row's
                       * accessible name is the thing that identifies it —
                       * the load number, the broker's name — rather than a
                       * bare "open". Its `::after` covers its cell. */}
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
                      {column.trailing ? (
                        <span className="relative z-10 ms-z1 inline-flex align-middle">
                          {column.trailing(row)}
                        </span>
                      ) : null}
                      {/* EVERY OTHER CELL CARRIES AN OVERLAY to the same
                       * href — hidden from the accessibility tree and out of
                       * the tab order, so the keyboard and the screen reader
                       * meet ONE link per row while the mouse gets the whole
                       * row. Controls inside the cell sit above it on z-10. */}
                      {href && index > 0 ? (
                        <Link
                          href={href}
                          aria-hidden
                          tabIndex={-1}
                          className="absolute inset-0"
                        />
                      ) : null}
                    </td>
                  ))}
                </tr>,
                // THE CONTINUATION, IMMEDIATELY BENEATH. A second `<tr>` in the
                // same table body, spanning every column, so it inherits the
                // grid's widths and sits against the row it describes.
                detail === null ? null : (
                  <tr
                    key={`${rowKey(row)}-detail`}
                    className="border-b border-border bg-surface-2"
                  >
                    {stripeTone ? (
                      <td aria-hidden className="w-[3px] p-0" />
                    ) : null}
                    {selection ? <td aria-hidden className="w-[32px]" /> : null}
                    <td
                      colSpan={columns.length}
                      className="px-z3 py-z1 ps-z6 text-xs text-ink-2"
                    >
                      {detail}
                    </td>
                  </tr>
                ),
              ]
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
              {selection ? (
                <td aria-hidden className="border-t border-border-strong" />
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
