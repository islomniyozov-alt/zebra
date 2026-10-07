import type { TxClient } from './tenancy'
import { ReferenceError } from './reference'

// ---------------------------------------------------------------------------
// TEAM DRIVERS (§6.4 part 3, queue item 16).
//
// A truck carries up to two drivers. The pairing is already on the driver —
// `Driver.assignedTruckId`, one row per seat — so a team is DERIVED from two
// live drivers holding one truck, the way a team LOAD is derived from
// `coDriverId` being set and a team STATEMENT from the frozen `teamWith`.
// Nothing new is stored. This module is the one place the seat count and the
// "who is my team-mate" question are answered, so the record pages, the load
// form and the pairing writer cannot drift apart on either.
//
// MEASURED ON DEV, 2026-10-07, before this was written: 90 trucks carry no
// live driver, 25 carry one, 4 carry two and none carries three; no load has
// a second seat and no statement has frozen a team-mate. The four pairs are
// each one person imported twice (GAPS, duplicate driver rows) — so the cap
// below refuses nothing today, and the suggestion the load form makes will
// name a duplicate until the accountant merges them. That is why it is a
// suggestion the dispatcher saves, not a seat the engine fills.
// ---------------------------------------------------------------------------

/** Seats on a truck. The second is the team's. */
export const TRUCK_SEATS = 2

/** Pure: may one more driver take this truck, given how many hold it now? */
export function seatIsFree(occupied: number): boolean {
  return occupied < TRUCK_SEATS
}

export interface CrewMember {
  id: string
  firstName: string
  lastName: string
  kind: string
}

/**
 * Pure: the team-mate is the OTHER person on the crew. A referral payee in a
 * seat is not a team-mate (the statement's own rule, `referralWith`), and a
 * crew of one has none.
 */
export function teamMateOf<T extends { id: string; kind: string }>(
  crew: readonly T[],
  selfId: string,
): T | null {
  return (
    crew.find((member) => member.id !== selfId && member.kind !== 'PAYEE') ??
    null
  )
}

/**
 * Who holds this truck: live drivers (not removed, not terminated) whose
 * `assignedTruckId` is it, oldest pairing first so the first seat is stable.
 * VACATION and OFF_DUTY still hold their seat — a truck is not re-crewed
 * because its driver took a week off.
 */
export async function crewOfTruck(
  tx: TxClient,
  truckId: string,
  exceptDriverId: string | null = null,
): Promise<CrewMember[]> {
  return tx.driver.findMany({
    where: {
      assignedTruckId: truckId,
      deletedAt: null,
      status: { not: 'INACTIVE' },
      ...(exceptDriverId ? { id: { not: exceptDriverId } } : {}),
    },
    orderBy: { updatedAt: 'asc' },
    take: TRUCK_SEATS + 1,
    select: { id: true, firstName: true, lastName: true, kind: true },
  })
}

export interface TeamMate {
  id: string
  firstName: string
  lastName: string
  truckUnit: string
}

/** This driver's team-mate, if another live person holds the same truck. */
export async function teamMateFor(
  tx: TxClient,
  driverId: string,
): Promise<TeamMate | null> {
  const self = await tx.driver.findUnique({
    where: { id: driverId },
    select: {
      assignedTruckId: true,
      assignedTruck: { select: { unitNumber: true } },
    },
  })
  if (!self?.assignedTruckId || !self.assignedTruck) return null
  const mate = teamMateOf(await crewOfTruck(tx, self.assignedTruckId), driverId)
  return mate
    ? {
        id: mate.id,
        firstName: mate.firstName,
        lastName: mate.lastName,
        truckUnit: self.assignedTruck.unitNumber,
      }
    : null
}

/**
 * The cap, applied where the pairing is written. `exceptDriverId` is the
 * driver being saved, so a driver keeping the truck they already hold is not
 * counted against themselves.
 */
export async function assertSeatFree(
  tx: TxClient,
  truckId: string,
  exceptDriverId: string | null,
): Promise<void> {
  const crew = await crewOfTruck(tx, truckId, exceptDriverId)
  if (!seatIsFree(crew.length)) {
    throw new ReferenceError('truck_full', { field: 'assignedTruckId' })
  }
}
