import type { Prisma } from '@/generated/prisma/client'
import { ACTIVE_ROSTER } from './driver-roster'

// ---------------------------------------------------------------------------
// WHICH DRIVERS MAY BE GIVEN WORK.
//
// ── ONE PREDICATE, FOR THE SAME REASON `SELECTABLE_AUTHORITY` IS ONE ──────
//
// Every screen that assigns freight filtered on `deletedAt: null` and nothing
// else, which was correct while every driver row was somebody currently
// employed. The Datatruck terminated-driver import ends that: 69 people who
// last drove between 2025 and August 2026 become rows, because 4,118 loads in
// the history are theirs and a load needs a driver to point at.
//
// A TERMINATED DRIVER IS NOT A DELETED ONE. `deletedAt` means "this row was a
// mistake"; these rows are the opposite of a mistake, they are the reason the
// freight can be filed at all. So they arrive with `status: INACTIVE` and this
// predicate is what keeps them out of the places somebody picks who drives
// tomorrow.
//
// ── WHERE IT IS USED, AND WHERE IT DELIBERATELY IS NOT ────────────────────
//
// USED on the three surfaces that hand out work: the dispatch board, the
// create-load driver select, and assigning a driver to an existing load.
//
// NOT USED on the driver list, the settlement list, the compliance queue, or
// the claims and inspections forms. A terminated driver must still be findable
// (that IS where you look them up), still carry their settlements, and still
// be nameable on a roadside inspection or a claim that happened while they
// worked here. Hiding history is the failure mode on that side, exactly as it
// was for retired authorities.
// ---------------------------------------------------------------------------

/**
 * A driver who can be assigned freight today.
 *
 * Spread into a `where`, alongside whatever company scope the caller has:
 *
 *     where: { ...assignableDriver(), ...scope }
 *
 * A CALLER THAT ALREADY HOLDS A DRIVER MUST KEEP THEM IN THE OPTIONS. This
 * predicate answers "who may be GIVEN work", which is not the same question
 * as "what may this select show" — a driver who goes off duty mid-load is
 * still on that load, and a select that dropped them would unassign them on
 * the next save. See the load detail page, which ORs the current pair back
 * in.
 */
export function assignableDriver(
  now: Date = new Date(),
): Prisma.DriverWhereInput {
  return {
    deletedAt: null,
    // ON THE ROSTER AND WORKING. VACATION and INACTIVE are both people
    // nobody can send anywhere this week; only one of them is permanent,
    // and neither belongs in a picker that hands out freight.
    status: ACTIVE_ROSTER,
    // ── AND NOT OFF DUTY, AS OF NOW (owner's ruling, 2026-09-21) ──────
    //
    // A FUNCTION OF `now` RATHER THAN A CONSTANT, and that is the whole
    // reason this stopped being one. `isOffDuty: false` alone would keep a
    // driver out of every picker after their return date had passed —
    // which is the stale-flag failure item 11 wrote `offDutyUntil` to
    // prevent, reintroduced one layer down.
    OR: [{ isOffDuty: false }, { offDutyUntil: { lte: now } }],
  }
}

/**
 * A truck that can be given freight today.
 *
 * ── THE SAME SHAPE AS `ASSIGNABLE_DRIVER`, AND FOR THE SAME REASON ────────
 *
 * The all-trucks import adds 53 units that left the fleet, created
 * OUT_OF_SERVICE because `TruckStatus` has no `INACTIVE` and AVAILABLE would
 * put a sold truck on the dispatch board. Without this predicate the status
 * would be a label nothing reads: every truck picker filtered on `deletedAt`
 * alone, exactly as the driver pickers did.
 *
 * MAINTENANCE IS NOT EXCLUDED, and that is deliberate. A truck in the shop is
 * coming back this week and a dispatcher may well plan around it; a truck that
 * left the fleet is not. Only the two terminal states go.
 */
export const ASSIGNABLE_TRUCK = {
  deletedAt: null,
  status: { notIn: ['OUT_OF_SERVICE', 'SOLD'] },
} as const satisfies Prisma.TruckWhereInput
