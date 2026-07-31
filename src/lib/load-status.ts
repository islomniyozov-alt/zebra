import type { TxClient } from './tenancy'
import type {
  LoadOperationalStatus,
  StatusSource,
} from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE STATUS ENGINE (§7)
//
// One function writes `LoadStatusEvent`, and one function moves
// `Load.operationalStatus`. Not two, not a helper per screen. The event log is
// the source of truth and the audit answer, and a second writer is a second
// story about what happened.
//
// The UI exposes four states of the schema's nine:
//
//   Booked ──(assign truck+driver)──▶ Dispatched ──(manual)──▶ Delivered
//                                                    ──(POD confirmed)──▶ POD received
//
// The other five stay valid storage for later phases. Nothing here rejects
// them; they simply have no transition into them yet.
//
// IDEMPOTENT AND ORDER-TOLERANT, and this is not defensive programming — it is
// the shape of the problem. Every automatic transition is triggered by
// something that can happen twice or out of order:
//
//   * a document confirm retried after a timeout fires POD_RECEIVED twice;
//   * a driver marks Delivered while a POD upload from ten minutes ago is
//     still landing, so POD_RECEIVED arrives BEFORE DELIVERED;
//   * an assignment saved twice by a double-click fires DISPATCHED twice.
//
// So: transitioning to the status a load already holds writes nothing and
// returns `unchanged`. And a transition that would move a load BACKWARDS along
// the operational ladder is refused as `stale` rather than applied — a late
// DELIVERED must not undo a POD that already landed.
// ---------------------------------------------------------------------------

/**
 * Rank on the operational ladder. Higher is further along.
 *
 * `AVAILABLE` sits below `BOOKED` because it means "not yet ours". Cancelled
 * is not on this scale at all — it is an orthogonal flag (§7), which is why
 * cancelling is a different function.
 */
const RANK: Record<LoadOperationalStatus, number> = {
  AVAILABLE: 0,
  BOOKED: 1,
  DISPATCHED: 2,
  AT_PICKUP: 3,
  LOADED: 4,
  IN_TRANSIT: 5,
  AT_DELIVERY: 6,
  DELIVERED: 7,
  POD_RECEIVED: 8,
}

export type TransitionOutcome =
  /** Applied: the load moved and one event was written. */
  | { result: 'moved'; from: LoadOperationalStatus; to: LoadOperationalStatus }
  /** Already there. Nothing written — the caller fired twice. */
  | { result: 'unchanged'; at: LoadOperationalStatus }
  /** Would move backwards. Nothing written — the caller arrived late. */
  | {
      result: 'stale'
      at: LoadOperationalStatus
      attempted: LoadOperationalStatus
    }
  /** The load is cancelled. Cancelled loads do not advance. */
  | { result: 'cancelled'; at: LoadOperationalStatus }

export interface TransitionOptions {
  source: StatusSource
  userId?: string | null
  note?: string | null
  /**
   * Allow a backwards move. Exactly one caller passes this — unassignment
   * reverting DISPATCHED to BOOKED (§7) — and it is deliberately awkward to
   * type so that nothing else acquires the habit.
   */
  allowRewind?: boolean
  occurredAt?: Date
}

/**
 * Move a load along the operational axis, or decline to, and say which.
 *
 * The return value is a fact about what happened, not a boolean. A caller that
 * needs to know whether it was the one that moved the load — to send a
 * notification, say — can tell; a caller that just wants the load to end up in
 * a state can ignore it.
 */
export async function transitionOperational(
  tx: TxClient,
  loadId: string,
  to: LoadOperationalStatus,
  options: TransitionOptions,
): Promise<TransitionOutcome> {
  const load = await tx.load.findUnique({
    where: { id: loadId },
    select: {
      operationalStatus: true,
      isCancelled: true,
      organizationId: true,
    },
  })
  if (!load) throw new UnknownLoadError(loadId)

  const from = load.operationalStatus

  if (load.isCancelled) return { result: 'cancelled', at: from }
  if (from === to) return { result: 'unchanged', at: from }

  if (RANK[to] < RANK[from] && !options.allowRewind) {
    return { result: 'stale', at: from, attempted: to }
  }

  await tx.load.update({
    where: { id: loadId },
    data: { operationalStatus: to },
  })

  await tx.loadStatusEvent.create({
    data: {
      loadId,
      organizationId: load.organizationId,
      axis: 'OPERATIONAL',
      fromStatus: from,
      toStatus: to,
      source: options.source,
      changedByUserId: options.userId ?? null,
      note: options.note ?? null,
      ...(options.occurredAt ? { occurredAt: options.occurredAt } : {}),
    },
  })

  return { result: 'moved', from, to }
}

export class UnknownLoadError extends Error {
  constructor(loadId: string) {
    super(`No such load: ${loadId}`)
    this.name = 'UnknownLoadError'
  }
}

/**
 * The status an assignment implies.
 *
 * §7: Dispatched is set automatically when an assignment (truck AND driver) is
 * made, and reverts automatically if the assignment is removed **before any
 * later state**. Both halves are here so the rule is in one place rather than
 * split across the two call sites that would each get half of it right.
 */
export function statusForAssignment(
  current: LoadOperationalStatus,
  assigned: {
    truckId: string | null
    driverId: string | null
  },
): { to: LoadOperationalStatus; rewind: boolean } | null {
  const complete = assigned.truckId !== null && assigned.driverId !== null

  if (complete) {
    // Only from BOOKED. A load already in transit does not go back to
    // Dispatched because somebody corrected the trailer number.
    return current === 'BOOKED' ? { to: 'DISPATCHED', rewind: false } : null
  }

  // Incomplete assignment. Revert only from DISPATCHED itself — "before any
  // later state" is the whole condition, and it is why this is a rewind.
  return current === 'DISPATCHED' ? { to: 'BOOKED', rewind: true } : null
}
