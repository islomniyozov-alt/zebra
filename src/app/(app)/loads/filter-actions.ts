'use server'

import { withCurrentOrg } from '@/lib/auth-context'
import {
  isFilterKind,
  loadFilterOptions,
  type FilterOption,
} from '@/lib/load-filter-options'

/**
 * The typeahead's options, read on first focus (§6.7 item 2).
 *
 * Under `read load`: anybody who can see the list already sees these names in
 * its cells.
 */
export async function loadFilterOptionsAction(
  kind: string,
): Promise<FilterOption[]> {
  if (!isFilterKind(kind)) return []
  return withCurrentOrg('read', 'load', (tx, session) =>
    loadFilterOptions(tx, kind, session.companyScopes),
  )
}
