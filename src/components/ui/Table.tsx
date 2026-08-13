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
}: TableProps<Row>) {
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
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cx(
                  'sticky top-0 z-10 border-b border-border bg-surface-2 px-z3 py-z2',
                  'text-xs font-semibold uppercase tracking-[0.04em] text-ink-2',
                  column.align === 'end' ? 'text-end' : 'text-start',
                )}
              >
                {column.header}
              </th>
            ))}
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
      </table>
    </div>
  )
}
