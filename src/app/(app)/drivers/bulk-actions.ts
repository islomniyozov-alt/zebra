'use server'

import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import { setRosterStatus } from '@/lib/fleet'
import type { RosterStatus } from '@/lib/driver-roster'
import type { MessageKey } from '@/lib/i18n'
import type { RosterBulkState, RosterRefusal } from './bulk-state'

// DRIVERS: change the ROSTER status on a selection (§6.4 part 1).
//
// ── ROSTER VALUES ONLY, THROUGH THE ONE FUNCTION, PER DRIVER ──────────────
//
// Mark active · On vacation · Terminated — the three values the form offers
// (owner's ruling, 2026-09-21). Dispatched and On route are derived from the
// freight and nothing writes them; a bulk bar that could would be the stored
// copy contradicting the loads again, forty rows at a time. `setRosterStatus`
// is the writer the record uses and it refuses a removed row; this loops it and
// reimplements nothing. Nothing here touches freight, pay or compliance.
//
// ── REFUSALS BY NAME, ONE TRANSACTION PER DRIVER ──────────────────────────
//
// The same argument as payroll's bulk bar: "3 of 5 changed" does not say which
// two, and one transaction around the selection would undo rows somebody has
// already been told about.

const STATUS: Record<RosterIntent, RosterStatus> = {
  active: 'AVAILABLE',
  vacation: 'VACATION',
  terminated: 'INACTIVE',
}

const REASON: Record<string, MessageKey> = {
  not_found: 'drivers.error.notFound',
  removed: 'drivers.error.removed',
}

export type RosterIntent = 'active' | 'vacation' | 'terminated'

export async function changeRosterAction(
  intent: RosterIntent,
  _previous: RosterBulkState,
  formData: FormData,
): Promise<RosterBulkState> {
  const ids = formData.getAll('driver').map(String).filter(Boolean)
  if (ids.length === 0) return { changed: 0, refusals: [] }

  let changed = 0
  const refusals: RosterRefusal[] = []

  for (const id of ids) {
    const outcome = await withCurrentOrg('update', 'driver', (tx) =>
      setRosterStatus(tx, id, STATUS[intent]),
    )
    if (outcome.ok) changed += 1
    else
      refusals.push({
        driver: outcome.name ?? id.slice(0, 8),
        reason: REASON[outcome.reason] ?? 'drivers.error.notFound',
      })
  }

  revalidatePath('/drivers')
  return { changed, refusals }
}
