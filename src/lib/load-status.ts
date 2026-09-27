import type { TxClient } from './tenancy'
import { refreshBillingStatus } from './billing-status'
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
      directSettled: true,
      organizationId: true,
    },
  })
  if (!load) throw new UnknownLoadError(loadId)

  const from = load.operationalStatus

  if (load.isCancelled) return { result: 'cancelled', at: from }

  // Nothing written. The caller fired twice and the second one is not news —
  // a row per retry would fill the timeline with the retry logic's noise.
  if (from === to) return { result: 'unchanged', at: from }

  if (RANK[to] < RANK[from] && !options.allowRewind) {
    // WRITTEN, unlike `unchanged`. Somebody with a reason tried to move this
    // load and was declined, and the timeline is the audit answer: "a
    // Delivered click arrived on Tuesday, after the POD had already landed"
    // is exactly what a dispute turns on. `fromStatus` is where the load
    // stayed; `toStatus` is what was asked for.
    await tx.loadStatusEvent.create({
      data: {
        loadId,
        organizationId: load.organizationId,
        axis: 'OPERATIONAL',
        fromStatus: from,
        toStatus: to,
        outcome: 'REFUSED_STALE',
        source: options.source,
        changedByUserId: options.userId ?? null,
        note: options.note ?? null,
        ...(options.occurredAt ? { occurredAt: options.occurredAt } : {}),
      },
    })
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

  // AND ON A DIRECT-SETTLED LOAD, DELIVERED CARRIES THE POD WITH IT.
  //
  // THE RULING (2026-09-03), and it is a money rule rather than a display one.
  // Amazon loads lose their Documents panel: drivers upload everything into
  // Relay, so a Rate con / POD / BOL prompt on this screen is asking for
  // paperwork that by agreement lives somewhere else. But `podConfirmed` fired
  // from exactly one place — a POD document attaching — and TWO things select
  // on `POD_RECEIVED`:
  //
  //   * `settleableWhere` — a driver is paid for freight that reached POD, in
  //     the period the POD landed. No POD, no settlement line, and the driver
  //     is never paid for that load by any period, ever.
  //   * `directSettledAwaiting` — the queue that matches loads against Amazon's
  //     weekly ACH statement. No POD, and the load never appears to reconcile.
  //
  // So removing the panel without this would have stopped driver pay for every
  // Amazon load, silently, with the loads looking finished on every screen.
  //
  // THE RELAY EXPORT IS THE PROOF. Amazon holds the signed paperwork and pays
  // against its own record; the Completed export is the carrier's copy of it.
  // "Finished means the paperwork landed" still holds — the paperwork just
  // lands in Relay, and `directSettled` is precisely the flag for freight that
  // works that way.
  //
  // ONE PLACE, NOT TWO. The alternative was teaching `settleableWhere` and
  // `directSettledAwaiting` to accept DELIVERED when the load is direct-settled
  // — which splits the definition of "finished" across two modules that must
  // then agree forever. Flags 88 and 89 are both that shape and neither was
  // cheap.
  //
  // `AUTOMATIC`, not by hand: §7 says POD_RECEIVED is never set by a click, and
  // this is not one. `podConfirmed` re-enters this function, where `from === to`
  // and the rank guard make a second call harmless.
  if (to === 'DELIVERED' && load.directSettled) {
    // ── AND AT THE SAME INSTANT, WHICH IS THE WHOLE OF IT ──────────────────
    //
    // Owner's ruling, 2026-09-26, and this line is where it lands.
    //
    // `options.occurredAt` used not to be passed here, and `LoadStatusEvent.
    // occurredAt` carries `@default(now())` — so a POD carried in by a DATED
    // delivery was itself stamped at the moment of the write. The two events
    // sat on one load disagreeing about when the freight finished.
    //
    // THAT IS A MONEY BUG, not an audit blemish. `settleableWhere` selects on
    // an APPLIED POD_RECEIVED event INSIDE the period — the POD event's date is
    // the pay week. So a bulk trips file uploaded on the 26th for freight
    // delivered on the 19th settled that driver in the week of the 26th, after
    // the statement for the right week had gone out, while the DELIVERED event
    // beside it carried the correct date and made every screen look right.
    //
    // A CLICK IS UNAFFECTED. A dispatcher pressing Delivered passes no
    // `occurredAt`, so both events default to now() exactly as before; this
    // changes behaviour only where a caller said when, which is precisely where
    // the old behaviour was wrong.
    await podConfirmed(
      tx,
      loadId,
      options.userId ?? null,
      options.occurredAt ?? null,
    )
  }

  // THE OTHER AXIS FOLLOWS. The two statuses move independently (schema
  // convention 4) but they are not unrelated: a POD landing is what makes a
  // load ready to bill. Recomputed rather than set, so the rule for what
  // "ready" means lives in exactly one place — see billing-status.ts.
  await refreshBillingStatus(tx, [loadId])

  return { result: 'moved', from, to }
}

export class UnknownLoadError extends Error {
  constructor(loadId: string) {
    super(`No such load: ${loadId}`)
    this.name = 'UnknownLoadError'
  }
}

/**
 * POD received — never set by hand (§7).
 *
 * Called from `confirmUpload` when a Document of type POD attaches to a load.
 * It lives here rather than in the load service so that documents.ts can reach
 * the one transition it needs without importing the whole load module.
 *
 * The confirm is retried on timeout and can land before the manual Delivered
 * click; the engine's idempotence and its refusal to rewind are what make both
 * safe, and neither is re-implemented at the call site.
 */
export async function podConfirmed(
  tx: TxClient,
  loadId: string,
  userId: string | null,
  /**
   * WHEN the POD landed, when the caller knows.
   *
   * Null means now(), which is right for a document attaching — the upload IS
   * the event. It is wrong for a delivery imported from a file, and the date is
   * the pay week: see the call inside `transitionOperational` above.
   */
  occurredAt: Date | null = null,
): Promise<TransitionOutcome> {
  return transitionOperational(tx, loadId, 'POD_RECEIVED', {
    source: 'AUTOMATIC',
    userId,
    ...(occurredAt ? { occurredAt } : {}),
    // A KEY, not a sentence. The note is rendered by the timeline, which
    // knows the reader's locale; a string written here does not. See
    // isMessageKey in src/lib/i18n.ts.
    note: 'status.note.podConfirmed',
  })
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
