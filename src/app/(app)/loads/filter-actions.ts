'use server'

import { withCurrentOrg } from '@/lib/auth-context'
import {
  isFilterKind,
  loadFilterOptions,
  type FilterOption,
} from '@/lib/load-filter-options'
import { recentLoadNotes, type LoadNote } from '@/lib/load-notes'

/**
 * A row's notes, read when its expand opens (§6.7 item 8). Under `read load`:
 * the notes belong to a load the viewer can already see.
 */
export async function loadNotesAction(loadId: string): Promise<LoadNote[]> {
  return withCurrentOrg('read', 'load', (tx) => recentLoadNotes(tx, loadId))
}

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
