import { Pagination } from '@/components/ui/Pagination'
import { PAGE_SIZES, type Paged } from '@/lib/list-view'

interface Props {
  paged: Paged<unknown>
  per: number
  path: string
  search: URLSearchParams
  hrefForPage: (page: number) => string
  labels: { of: string; previous: string; next: string; perPage: string }
}

/**
 * The pagination bar, with the page-size links built from the current URL.
 *
 * Every grid needs this and every grid needs it identically, including the part
 * that is easy to get wrong: CHANGING THE PAGE SIZE RESETS THE PAGE. Page 7 of 50
 * does not exist at 500 per page, and `paginate` would clamp it to the last page
 * rather than the first — so the reader would ask for more rows and land at the
 * bottom of the list.
 */
export function GridFooterNav({
  paged,
  per,
  path,
  search,
  hrefForPage,
  labels,
}: Props) {
  return (
    <Pagination
      page={paged.page}
      pages={paged.pages}
      hrefFor={hrefForPage}
      sizeHrefFor={(size) => {
        const next = new URLSearchParams(search)
        next.set('per', String(size))
        next.delete('page')
        return `${path}?${next}`
      }}
      sizes={PAGE_SIZES}
      per={per}
      labels={{
        range: `${paged.firstRow}–${paged.lastRow} ${labels.of} ${paged.total}`,
        previous: labels.previous,
        next: labels.next,
        perPage: labels.perPage,
      }}
    />
  )
}
