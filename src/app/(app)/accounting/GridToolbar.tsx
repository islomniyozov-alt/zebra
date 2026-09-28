import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { ColumnsChooser } from './ColumnsChooser'

interface Props {
  /** The grid id, for the column preference and the export. */
  grid: string
  /** Every column this grid has, in the table's own order. */
  columns: readonly { key: string; header: string }[]
  visible: readonly string[]
  /** Current URL params, so Export carries the same filter the screen has. */
  search: URLSearchParams
  labels: {
    export: string
    columns: string
    apply: string
    cancel: string
    firstLocked: string
  }
  errors: Record<string, string>
  /** Anything this tab adds — an Add button, usually. */
  children?: React.ReactNode
}

/**
 * The right-hand end of a grid's controls: Export CSV and the columns chooser.
 *
 * ── EXPORT CARRIES THE SCREEN'S FILTER, AND NOT ITS PAGE ──────────────────
 *
 * Every param goes through except `page` and `per` (§7.1.5: the export is every
 * page of the filtered set). Dropping them here rather than in the route means
 * the link a person can see, copy and paste is the one that behaves as described
 * — the route discards them too, belt and braces, because a hand-edited URL
 * should not be able to truncate somebody's export to fifty rows.
 *
 * ── A PLAIN ANCHOR, NOT A BUTTON ──────────────────────────────────────────
 *
 * A download is a navigation. An anchor gets middle-click, "save link as", and
 * the browser's own download UI for free; a fetch-and-blob would reimplement all
 * three worse and break with JavaScript off.
 */
export function GridToolbar({
  grid,
  columns,
  visible,
  search,
  labels,
  errors,
  children,
}: Props) {
  const exportParams = new URLSearchParams(search)
  exportParams.delete('page')
  exportParams.delete('per')
  exportParams.set('grid', grid)

  return (
    <div className="flex items-center gap-z2">
      {children}
      <Link href={`/accounting/export?${exportParams}`} prefetch={false}>
        <Button variant="secondary" size="compact">
          {labels.export}
        </Button>
      </Link>
      <ColumnsChooser
        grid={grid}
        columns={columns}
        visible={visible}
        labels={{
          open: labels.columns,
          apply: labels.apply,
          cancel: labels.cancel,
          firstLocked: labels.firstLocked,
        }}
        errors={errors}
      />
    </div>
  )
}
