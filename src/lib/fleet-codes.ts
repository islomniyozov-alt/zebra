import { ReferenceError } from './reference'
import type { TxClient } from './tenancy'

// ---------------------------------------------------------------------------
// TWO SMALL VOCABULARIES FOR THE FLEET — IN A LIST, NOT AN ENUM.
//
// Item 12. The owner's ruling on payment type, applied twice more: TEXT
// validated against a code list, never a Postgres enum and never a CHECK
// constraint. A fourth fuel type is then an edit somebody can read and review
// rather than a migration, a deploy and a conversation about locking a table
// the whole fleet points at.
//
// ── FLEET STATUS IS A SECOND AXIS, NOT A REPLACEMENT ─────────────────────
//
// `Truck.status` (the `TruckStatus` enum) is where the FREIGHT has the unit:
// AVAILABLE, DISPATCHED, IN_TRANSIT. `fleetStatus` is whether the unit is fit
// to run at all. They can disagree — In shop and DISPATCHED on the same
// afternoon — and NOTHING FORBIDS THAT, deliberately. That pair is precisely
// the row a dispatcher needs to find, and a constraint that refused it would
// make the system unable to describe the situation it exists to surface.
//
// MAINTENANCE and OUT_OF_SERVICE already exist in `TruckStatus`, which looks
// like the same thing and is not: those take a truck out of `ASSIGNABLE_TRUCK`
// and off every picker. `fleetStatus` is a yard's own note about the unit and
// changes nothing about what may be dispatched. Whether the two should be
// merged is a ruling nobody has made; until then this file says which is which
// so a reader does not have to guess.
//
// ── SPELLED AS THEY ARE SHOWN ────────────────────────────────────────────
//
// Like `PAYMENT_TYPES`, these are display strings and are NOT translated. A
// code list whose members are message keys is a third vocabulary to keep in
// step with the other two, and the stored value would still be English.
// ---------------------------------------------------------------------------

/** Whether the unit is fit to run. Three values, spelled as they are shown. */
export const FLEET_STATUSES = [
  'In service',
  'Out of service',
  'In shop',
] as const

export type FleetStatus = (typeof FLEET_STATUSES)[number]

export const FUEL_TYPES = ['Diesel', 'Gas', 'Electric', 'Other'] as const

export type FuelType = (typeof FUEL_TYPES)[number]

export function isFleetStatus(value: string): value is FleetStatus {
  return (FLEET_STATUSES as readonly string[]).includes(value)
}

export function isFuelType(value: string): value is FuelType {
  return (FUEL_TYPES as readonly string[]).includes(value)
}

/**
 * Read a code-list value off a form.
 *
 * ABSENT IS NULL AND IS NOT AN ERROR — every field in item 12 is optional, and
 * a truck nobody has classified yet is the normal state of an import.
 *
 * PRESENT AND WRONG IS A REFUSAL, by name. Case is NOT normalised, for the
 * reason `readPaymentType` gives: "in shop" arriving where "In shop" is
 * expected means something upstream is not using this list, and quietly
 * title-casing it hides the thing worth knowing.
 */
function readCode<T extends string>(
  value: unknown,
  members: readonly T[],
  field: string,
): T | null {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  if (text === '') return null
  if (!(members as readonly string[]).includes(text)) {
    throw new ReferenceError('not_in_code_list', { field })
  }
  return text as T
}

export function readFleetStatus(value: unknown): FleetStatus | null {
  return readCode(value, FLEET_STATUSES, 'fleetStatus')
}

export function readFuelType(value: unknown): FuelType | null {
  return readCode(value, FUEL_TYPES, 'fuelType')
}

/**
 * How long the unit has been in its current `fleetStatus`, in whole days.
 *
 * ── DERIVED, AND THE SOURCE IS THE AUDIT LOG ─────────────────────────────
 *
 * Datatruck stores an Aging column. A stored age is wrong every day after the
 * day it was written unless something recalculates it, and the thing that
 * recalculates it is the thing that would actually be broken when the number
 * looked wrong. `AuditLog.changes` already carries `{ field: { from, to } }`
 * for every write, so the date of the last `fleetStatus` change is a fact the
 * system has rather than one it has to keep.
 *
 * ── NULL IS NOT ZERO ─────────────────────────────────────────────────────
 *
 * A truck whose status nobody has ever changed has no age: the audit log
 * cannot say when it entered a state it has always been in, and `createdAt`
 * would answer with the day of the Datatruck import for 49 units that were on
 * the road years before it. Zero days would read as "changed today", which is
 * the one thing it definitely does not mean.
 */
export function agingDaysFrom(
  changedAt: Date | null,
  now: Date,
): number | null {
  if (changedAt === null) return null
  const days = Math.floor((now.getTime() - changedAt.getTime()) / 86_400_000)
  return days < 0 ? 0 : days
}

/**
 * When each truck last had its `fleetStatus` changed, in ONE statement.
 *
 * ── THE AUDIT LOG IS THE SOURCE, AND THAT IS THE WHOLE POINT ─────────────
 *
 * Datatruck's trucks export carries an `Aging days` column — a number that
 * was true on the day it was written and has been wrong every day since
 * unless something recalculated it. `AuditLog.changes` already holds
 * `{ field: { from, to } }` for every write in this system, so the date of
 * the last change is a fact we HAVE rather than one we would have to keep.
 *
 * ONLY `UPDATE` ROWS COUNT. A CREATE is audited as a diff from null in
 * which every column appears, so an unfiltered query would report that every
 * truck ever entered changed its fleet status on the day it was entered —
 * the stored-aging failure arriving by a different road.
 *
 * `jsonb_exists` rather than the `?` operator, which is the same thing
 * spelled in a way no driver can mistake for a bind parameter.
 *
 * ONE STATEMENT FOR THE LIST, like every other loader on a list page. The
 * integration suite counts them against twenty trucks.
 */
export async function fleetStatusChangedForTrucks(
  tx: TxClient,
  truckIds: readonly string[],
): Promise<Map<string, Date | null>> {
  const out = new Map<string, Date | null>()
  for (const id of truckIds) out.set(id, null)
  if (truckIds.length === 0) return out

  const rows = await tx.$queryRaw<{ id: string; at: Date | null }[]>`
    SELECT a."entityId" AS id, MAX(a."createdAt") AS at
      FROM "AuditLog" a
     WHERE a."entityType" = 'Truck'
       AND a."entityId" = ANY(${[...truckIds]})
       -- A CREATE IS NOT A CHANGE OF STATUS, and the audit log records one as
       -- a diff from null in which EVERY column appears. Without this the
       -- number would read "0 d" for every truck ever entered, which is the
       -- stored-aging failure with extra steps. The integration suite caught
       -- it on the first run.
       AND a."action" = 'UPDATE'
       AND jsonb_exists(a."changes", 'fleetStatus')
     GROUP BY a."entityId"
  `

  for (const row of rows) out.set(row.id, row.at)
  return out
}
