'use server'

import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import { saveGridColumns } from '@/lib/grid-columns'
import type { ColumnsState } from './columns-state'

// THE FORM READS, ONE LIB FUNCTION DECIDES, THE PAGE REVALIDATES.
//
// ── THE PERMISSION IS `read`, AND THAT IS NOT A MISTAKE ───────────────────
//
// Hiding a column is not a financial act. It writes a `UserPreference` row
// belonging to the person who pressed it and changes nothing anybody else can
// see — so gating it on a write permission would mean a MANAGER could read a grid
// and not tidy it. The row is scoped to `userId` by `writePreference`, so "their
// own preference" is enforced by the key rather than by this check.
//
// The grid the columns belong to is validated in `grid-columns.ts` against a
// closed list, so a forged `grid` field writes nothing.

export async function saveColumnsAction(
  grid: string,
  available: readonly string[],
  _previous: ColumnsState,
  formData: FormData,
): Promise<ColumnsState> {
  // CHECKBOXES POST ONLY WHAT IS TICKED, which is exactly the set to store. An
  // unticked box sends nothing at all, so "hidden" is the absence of a field
  // rather than a value — and the first column is always kept regardless, because
  // it carries the row's link and its accessible name.
  const ticked = formData.getAll('column').map(String)
  const first = available[0]
  const columns =
    first !== undefined && !ticked.includes(first) ? [first, ...ticked] : ticked

  const outcome = await withCurrentOrg('read', 'settlement', (tx, session) =>
    saveGridColumns(tx, session.organizationId, session.userId, grid, columns),
  )

  if (!outcome.ok) {
    return {
      error:
        outcome.reason === 'no_columns'
          ? 'grid.columns.errorEmpty'
          : 'grid.columns.errorGrid',
    }
  }

  // EVERY ACCOUNTING PATH, because a preference is per user and not per page: a
  // column hidden on Payroll → Batches must not still be showing on a tab the
  // person had open in another window.
  revalidatePath('/accounting', 'layout')
  return { error: null }
}
