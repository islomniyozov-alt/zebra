import Link from 'next/link'
import { cx } from '@/lib/cx'

interface PaginationProps {
  page: number
  pages: number
  hrefFor: (page: number) => string
  /** Where a page-size choice points. Omit to hide the size control. */
  sizeHrefFor?: (size: number) => string
  sizes?: readonly number[]
  per?: number
  labels: {
    /** "12–50 of 340" — composed by the caller, which has the translator. */
    range: string
    previous: string
    next: string
    perPage: string
  }
}

/**
 * §7.1.3 — a page number and a page size, both in the URL.
 *
 * ── IT SAYS THE RANGE AND THE TOTAL, IN WORDS ─────────────────────────────
 *
 * `12–50 of 340`. The footer's sum is over the rows on the page, so the reader
 * has to be able to see that the page is a page — a sum with no scope beside it
 * is the number people quote by accident.
 *
 * ── LINKS, AND DISABLED IS AN ABSENT LINK ─────────────────────────────────
 *
 * On page one there is no previous page, so there is no anchor: a disabled
 * `<a href>` is still focusable and still looks clickable. The word stays, greyed,
 * so the control does not change width as somebody pages through it — §11's
 * reason, applied to a layout rather than to motion.
 *
 * NO PAGE-NUMBER LADDER. First, previous, next and last is the whole control:
 * a row of numbers is nine links to the wrong page and one to the right one, and
 * §14 already rejects that density of choice where three would do.
 */
export function Pagination({
  page,
  pages,
  hrefFor,
  sizeHrefFor,
  sizes,
  per,
  labels,
}: PaginationProps) {
  const step = (target: number, text: string, enabled: boolean) =>
    enabled ? (
      <Link
        href={hrefFor(target)}
        scroll={false}
        className={cx(
          'h-control-compact rounded-control border border-border-strong bg-surface px-z2',
          'inline-flex items-center text-xs font-medium text-ink-2',
          'transition-colors duration-120 ease-out hover:bg-surface-3 hover:text-ink',
        )}
      >
        {text}
      </Link>
    ) : (
      <span
        aria-disabled="true"
        className="inline-flex h-control-compact items-center rounded-control border border-border px-z2 text-xs font-medium text-ink-3"
      >
        {text}
      </span>
    )

  return (
    <div className="flex flex-wrap items-center gap-z2 border-t border-border bg-surface px-gutter py-z2">
      <span className="font-mono text-xs tabular-nums text-ink-2" dir="ltr">
        {labels.range}
      </span>

      <div className="ms-auto flex items-center gap-z1">
        {sizeHrefFor && sizes ? (
          <>
            <span className="text-xs text-ink-3">{labels.perPage}</span>
            {sizes.map((size) => (
              <Link
                key={size}
                href={sizeHrefFor(size)}
                scroll={false}
                aria-current={size === per ? 'true' : undefined}
                className={cx(
                  'h-control-compact rounded-control border px-z2',
                  'inline-flex items-center font-mono text-xs tabular-nums',
                  'transition-colors duration-120 ease-out',
                  size === per
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-border-strong bg-surface text-ink-2 hover:bg-surface-3',
                )}
              >
                {size}
              </Link>
            ))}
          </>
        ) : null}

        {step(1, '«', page > 1)}
        {step(page - 1, labels.previous, page > 1)}
        <span className="font-mono text-xs tabular-nums text-ink" dir="ltr">
          {page} / {pages}
        </span>
        {step(page + 1, labels.next, page < pages)}
        {step(pages, '»', page < pages)}
      </div>
    </div>
  )
}
