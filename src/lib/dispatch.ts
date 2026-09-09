import type { TxClient } from './tenancy'
import type { MessageKey } from './i18n'

// ---------------------------------------------------------------------------
// DISPATCH CONFLICT RULES (§8)
//
// The human-readable layer above what the database already enforces. Postgres
// guarantees one open `AssetAssignment` per asset; it has nothing to say about
// whether putting truck 101 on this load is a good idea, and it certainly
// cannot say so in a sentence naming load 1043.
//
// Three refusals, in the design system's voice (§10 — say what happened and
// what to do, never "An error occurred"):
//
//   1. the truck or driver is already on another load whose stop window
//      overlaps this one's;
//   2. the truck or driver currently works under a DIFFERENT authority than
//      the load — offer the transfer, never move the asset silently;
//   3. the truck or driver is out of service, sold, or inactive.
//
// Rule 2 reads the open `AssetAssignment` rather than `Truck.companyId`.
// Those are two representations of one fact (flagged in Phase 2 §16.4) and the
// assignment is the one with history behind it, so it is the one to trust.
// ---------------------------------------------------------------------------

export type ConflictKind =
  | 'overlapping_load'
  | 'other_authority'
  | 'out_of_service'
  | 'not_found'

export interface DispatchConflict {
  kind: ConflictKind
  /** Which side of the assignment caused it. */
  asset: 'truck' | 'driver' | 'trailer'
  /** The message key; the interface renders it in the user's language. */
  messageKey: MessageKey
  /** Substituted into the message. Load numbers are never translated (§12). */
  values: Record<string, string>
  /** Set for `other_authority`, so the interface can offer the transfer. */
  transfer?: { assetId: string; fromCompanyId: string; toCompanyId: string }
}

export class DispatchConflictError extends Error {
  readonly conflicts: DispatchConflict[]
  constructor(conflicts: DispatchConflict[]) {
    super(conflicts.map((c) => c.kind).join(', '))
    this.name = 'DispatchConflictError'
    this.conflicts = conflicts
  }
}

const UNAVAILABLE_TRUCK = new Set(['OUT_OF_SERVICE', 'SOLD', 'MAINTENANCE'])
const UNAVAILABLE_DRIVER = new Set(['INACTIVE', 'OFF_DUTY', 'VACATION'])

export interface AssignmentIntent {
  truckId?: string | null
  driverId?: string | null
  trailerId?: string | null
}

export interface LoadWindow {
  /** The load being assigned. Excluded from the overlap search. */
  loadId?: string | null
  companyId: string
  from: Date | null
  to: Date | null
}

/**
 * The window a load occupies, from its stops.
 *
 * Null at either end means "unbounded", and an unbounded window overlaps
 * everything — which is deliberate. A load with no dates yet is exactly the
 * one a dispatcher is most likely to double-book, and refusing loudly beats
 * discovering it at 6am.
 */
export async function loadWindow(
  tx: TxClient,
  loadId: string,
): Promise<{ from: Date | null; to: Date | null }> {
  const stops = await tx.loadStop.findMany({
    where: { loadId },
    orderBy: { sequence: 'asc' },
    select: { scheduledAt: true, windowStart: true, windowEnd: true },
  })

  const points = stops.flatMap((stop) =>
    [stop.windowStart, stop.scheduledAt, stop.windowEnd].filter(
      (value): value is Date => value instanceof Date,
    ),
  )
  if (points.length === 0) return { from: null, to: null }

  const times = points.map((point) => point.getTime())
  return {
    from: new Date(Math.min(...times)),
    to: new Date(Math.max(...times)),
  }
}

function overlaps(
  a: { from: Date | null; to: Date | null },
  b: { from: Date | null; to: Date | null },
): boolean {
  // Unbounded on either side means it could be anywhere in time.
  if (a.from === null || a.to === null || b.from === null || b.to === null) {
    return true
  }
  return a.from <= b.to && b.from <= a.to
}

/**
 * Every reason this assignment should be refused, or an empty list.
 *
 * ALL of them, not the first — a dispatcher fixing one problem to be told
 * about the next is the interaction §10 exists to prevent.
 */
export async function findAssignmentConflicts(
  tx: TxClient,
  intent: AssignmentIntent,
  window: LoadWindow,
): Promise<DispatchConflict[]> {
  const conflicts: DispatchConflict[] = []
  const ids = [intent.truckId, intent.driverId].filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  )
  if (ids.length === 0) return conflicts

  // ONE query per concern, not one per asset. Every query here runs inside an
  // interactive transaction with a 5 second ceiling and costs a full round
  // trip; checking a truck and a driver separately doubled that for no reason.
  const [openPeriods, otherLoads] = await Promise.all([
    tx.assetAssignment.findMany({
      where: {
        effectiveTo: null,
        OR: [{ truckId: { in: ids } }, { driverId: { in: ids } }],
      },
      select: {
        truckId: true,
        driverId: true,
        companyId: true,
        company: { select: { name: true } },
      },
    }),
    tx.load.findMany({
      where: {
        deletedAt: null,
        isCancelled: false,
        ...(window.loadId ? { id: { not: window.loadId } } : {}),
        OR: [{ truckId: { in: ids } }, { driverId: { in: ids } }],
        // A finished load is not a conflict: the truck is free again.
        operationalStatus: { notIn: ['DELIVERED', 'POD_RECEIVED'] },
      },
      // ── BOUNDED, THOUGH IT IS ALREADY NARROW ────────────────────────────
      //
      // The only load query on a listing path that had no `take`. It is
      // narrowed twice already — to the specific trucks and drivers in this
      // dispatch window, and to loads that have not finished — so the
      // Datatruck history cannot reach it: all 14,345 imported loads are
      // DELIVERED. That is safety by coincidence rather than by rule, and the
      // coincidence stops holding the first time somebody reopens one.
      //
      // A conflict check that returned 500 rows would be unreadable anyway;
      // the cap is a bound on a query, not a page size.
      take: 200,
      select: {
        id: true,
        loadNumber: true,
        truckId: true,
        driverId: true,
        stops: {
          select: { scheduledAt: true, windowStart: true, windowEnd: true },
        },
      },
    }),
  ])

  const check = async (
    asset: 'truck' | 'driver',
    id: string,
  ): Promise<void> => {
    const row =
      asset === 'truck'
        ? await tx.truck.findFirst({
            where: { id, deletedAt: null },
            select: { id: true, unitNumber: true, status: true },
          })
        : await tx.driver.findFirst({
            where: { id, deletedAt: null },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              status: true,
            },
          })

    if (!row) {
      conflicts.push({
        kind: 'not_found',
        asset,
        messageKey: 'dispatch.conflict.notFound',
        values: {},
      })
      return
    }

    const label =
      'unitNumber' in row
        ? row.unitNumber
        : `${row.firstName} ${row.lastName}`.trim()

    // 3. Out of service.
    const unavailable =
      asset === 'truck'
        ? UNAVAILABLE_TRUCK.has(row.status)
        : UNAVAILABLE_DRIVER.has(row.status)
    if (unavailable) {
      conflicts.push({
        kind: 'out_of_service',
        asset,
        messageKey: 'dispatch.conflict.outOfService',
        values: { asset: label, status: row.status },
      })
    }

    // 2. Working under another authority. The open period is authoritative —
    // NOT `Truck.companyId`. They are two representations of one fact and the
    // period is the one with history behind it (Phase 2 §16.4).
    const open = openPeriods.find((period) =>
      asset === 'truck' ? period.truckId === id : period.driverId === id,
    )
    if (open && open.companyId !== window.companyId) {
      conflicts.push({
        kind: 'other_authority',
        asset,
        messageKey: 'dispatch.conflict.otherAuthority',
        values: { asset: label, authority: open.company.name },
        transfer: {
          assetId: id,
          fromCompanyId: open.companyId,
          toCompanyId: window.companyId,
        },
      })
    }

    // 1. Already on an overlapping load.
    const others = otherLoads.filter((load) =>
      asset === 'truck' ? load.truckId === id : load.driverId === id,
    )

    for (const other of others) {
      const points = other.stops.flatMap((stop) =>
        [stop.windowStart, stop.scheduledAt, stop.windowEnd].filter(
          (value): value is Date => value instanceof Date,
        ),
      )
      const times = points.map((point) => point.getTime())
      const otherWindow =
        times.length === 0
          ? { from: null, to: null }
          : {
              from: new Date(Math.min(...times)),
              to: new Date(Math.max(...times)),
            }

      if (overlaps(window, otherWindow)) {
        conflicts.push({
          kind: 'overlapping_load',
          asset,
          messageKey: 'dispatch.conflict.overlappingLoad',
          // The load NUMBER, not its id. "This truck is already assigned to
          // load 1042 on these dates" is §10's own example of a good error.
          values: { asset: label, loadNumber: other.loadNumber },
        })
        break
      }
    }
  }

  if (intent.truckId) await check('truck', intent.truckId)
  if (intent.driverId) await check('driver', intent.driverId)

  return conflicts
}

/** Throw if there is anything to refuse. */
export async function assertAssignable(
  tx: TxClient,
  intent: AssignmentIntent,
  window: LoadWindow,
): Promise<void> {
  const conflicts = await findAssignmentConflicts(tx, intent, window)
  if (conflicts.length > 0) throw new DispatchConflictError(conflicts)
}
