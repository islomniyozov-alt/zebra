import type { Role } from '@/generated/prisma/client'
import { teamMateOf, type CrewMember } from './team'

// ---------------------------------------------------------------------------
// THE DRIVER RECORD'S MAIN TAB, DECIDED WITHOUT A DATABASE (§6.4 part 2,
// v11.22).
//
// Datatruck's Main tab shows a photo, a tenure, an assigned dispatcher and a
// team block. Zebra stores none of the derived ones and must not start: a
// tenure stored is a tenure that goes stale the next morning, and a team stored
// beside the truck pairing is a second answer to "who is my team-mate" (part 3,
// and the owner's ruling of 2026-11-17, "keep derived"). So each is a pure
// function here, read by the page and pinned by tests.
// ---------------------------------------------------------------------------

/**
 * Who may be a driver's assigned dispatcher: the office roles that dispatch.
 *
 * ACCOUNTING does not dispatch, and DRIVER is the person being dispatched.
 * `fleet.ts` refuses any other member by name, and the record's picker offers
 * exactly these — one list, so the select cannot offer what the writer refuses.
 */
export const DISPATCHER_ROLES = [
  'OWNER',
  'ADMIN',
  'MANAGER',
  'DISPATCHER',
] as const satisfies readonly Role[]

export function isDispatcherRole(role: string): boolean {
  return (DISPATCHER_ROLES as readonly string[]).includes(role)
}

/** Whole years and remaining whole months. */
export interface Tenure {
  years: number
  months: number
}

/**
 * How long a driver has been with the carrier — from the hire date to the
 * termination date, or to today while they are still here.
 *
 * NULL WITHOUT A HIRE DATE: a tenure of nothing is not a tenure of zero, and
 * the record says "—" rather than "0 months" for a date nobody typed. A
 * termination before the hire date is a data error, read as zero rather than
 * a negative length.
 *
 * WHOLE CALENDAR MONTHS, counted in UTC because both dates are stored as
 * midnight UTC (§8): hired 15 March, today 14 April is 0 months; 15 April is 1.
 */
export function tenureOf(
  hireDate: Date | null,
  terminationDate: Date | null,
  now: Date,
): Tenure | null {
  if (hireDate === null) return null
  const end = terminationDate ?? now
  let months =
    (end.getUTCFullYear() - hireDate.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - hireDate.getUTCMonth())
  if (end.getUTCDate() < hireDate.getUTCDate()) months -= 1
  months = Math.max(0, months)
  return { years: Math.floor(months / 12), months: months % 12 }
}

/**
 * The driver's photo: their newest live `PHOTO` document.
 *
 * `PHOTO` is already a document type, so the photo is a document like any
 * other — uploaded, audited and removable through the same pipeline — and not
 * a column that would need a second upload path. The caller passes live
 * documents only.
 */
export function photoOf<
  D extends { id: string; type: string; uploadedAt: Date },
>(documents: readonly D[]): D | null {
  let newest: D | null = null
  for (const document of documents) {
    if (document.type !== 'PHOTO') continue
    if (newest === null || document.uploadedAt > newest.uploadedAt) {
      newest = document
    }
  }
  return newest
}

/**
 * Each listed driver's team-mate, for `/drivers`' Team column (§6.4 part 3).
 *
 * THE SAME RULE AS THE RECORD'S HEADER: the crews come from
 * `crewOfTrucksSql` — `team.ts`' own seat definition — and the mate is
 * `teamMateOf`, so the column and the record cannot disagree about who is on
 * a truck. A driver not holding a seat themselves (removed, terminated, or
 * no truck) has no team-mate, whoever else is on the truck.
 */
export function teamMatesFor(
  drivers: readonly { id: string; truckId: string | null }[],
  crews: ReadonlyMap<string, readonly CrewMember[]>,
): Map<string, CrewMember | null> {
  const out = new Map<string, CrewMember | null>()
  for (const driver of drivers) {
    const crew = driver.truckId ? (crews.get(driver.truckId) ?? []) : []
    const seated = crew.some((member) => member.id === driver.id)
    out.set(driver.id, seated ? teamMateOf(crew, driver.id) : null)
  }
  return out
}
