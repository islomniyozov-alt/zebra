'use server'

import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import {
  gridResource,
  gridRevalidate,
  isGridId,
  saveGridColumns,
} from '@/lib/grid-columns'
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
// ── AND `read` OF WHICH RESOURCE IS THE GRID'S OWN QUESTION ───────────────
//
// It used to be `settlement` for every grid, which was true of the Accounting
// tabs this was built for and false the moment §7.1.7 put a chooser on `/loads`
// and `/trucks`. `gridResource` decides, and it decides per grid: you may tidy a
// grid you may read.
//
// The grid the columns belong to is validated in `grid-columns.ts` against a
// closed list, so a forged `grid` field writes nothing — which is also what makes
// it safe to look a resource up from it.

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

  // THE ID IS CHECKED HERE TOO, before the transaction, because the permission
  // to ask about is read off it. `saveGridColumns` checks it again — it is the
  // one that must, being the thing that writes.
  if (!isGridId(grid)) return { error: 'grid.columns.errorGrid' }

  const outcome = await withCurrentOrg(
    'read',
    gridResource(grid),
    (tx, session) =>
      saveGridColumns(
        tx,
        session.organizationId,
        session.userId,
        grid,
        columns,
        // What the chooser offered, so the store can keep the set left
        // unticked (§6.7: column memory is what a person hid).
        available,
      ),
  )

  if (!outcome.ok) {
    return {
      error:
        outcome.reason === 'no_columns'
          ? 'grid.columns.errorEmpty'
          : 'grid.columns.errorGrid',
    }
  }

  // A PREFERENCE IS PER USER AND NOT PER PAGE: a column hidden on Payroll →
  // Batches must not still be showing on a tab the person had open in another
  // window. Accounting's tabs share a layout, so that is what it revalidates;
  // §7.1.7's two lists are routes of their own.
  const { path, type } = gridRevalidate(grid)
  revalidatePath(path, type)
  return { error: null }
}
