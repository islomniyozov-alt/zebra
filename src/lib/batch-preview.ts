import type { Prisma } from '@/generated/prisma/client'
import { SETTLEABLE_LOAD } from './settlements'
import { ruleInForce } from './driver-pay'

type TxClient = Prisma.TransactionClient

// ---------------------------------------------------------------------------
// WHAT WOULD AND WOULD NOT GO INTO A BATCH, BEFORE ONE IS OPENED.
//
// Owner's ruling, 2026-09-29: authority and a date range, an available grid,
// and everything else grouped BY REASON.
//
// ── WHY THE UNAVAILABLE LIST IS THE POINT ─────────────────────────────────
//
// `openBatch` already refuses nothing — it opens, drafts, and whatever the
// engine could not price is simply absent. The Tuesday strip then names the
// blocked drivers, after the fact. So the question "what am I about to leave
// out" had no screen, and the answer arrived as an absence somebody had to
// notice.
//
// EVERY LOAD IN THE WINDOW LANDS IN EXACTLY ONE BUCKET. Not a filter chain
// where a load can quietly match two rules and be counted once — the order
// below is the precedence and it is stated, so a load with no driver AND no POD
// is reported under one reason rather than disappearing between two passes.
//
// ── IT CLASSIFIES IN THE WORKER, DELIBERATELY ─────────────────────────────
//
// One read of the window, then a per-row decision. This is not the aggregation
// `by-company.ts` pushes into SQL: there is no SUM here, the row count is a
// week's freight rather than a corpus, and each reason needs a different join
// to express as a predicate — five queries returning five disjoint sets that
// have to add up to the whole, which is five chances for a load to fall through
// the gap between them.
// ---------------------------------------------------------------------------

export const UNAVAILABLE_REASONS = [
  'inTransit',
  'outsideRange',
  'alreadyInBatch',
  'noDriver',
  'noRule',
] as const

export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number]

export interface PreviewTrip {
  loadId: string
  loadNumber: string
  companyId: string
  companyName: string
  driverName: string | null
  /** When the POD landed, which is the date a week is decided by. */
  podAt: Date | null
  deliveredAt: Date | null
  grossCents: number
  /** Null on an available trip; the bucket otherwise. */
  reason: UnavailableReason | null
}

export interface BatchPreview {
  available: PreviewTrip[]
  unavailable: Record<UnavailableReason, PreviewTrip[]>
  /** Every load looked at, so a reader can check the buckets add up. */
  considered: number
}

/**
 * Classify a window's freight.
 *
 * `from`/`to` BOUND THE POD, not the delivery stop. A week is decided by when
 * the POD landed (MONEY-DESIGN §0), and a load delivered on Saturday whose POD
 * arrives Monday belongs to the following week — which is precisely the case
 * `outsideRange` exists to show rather than silently drop.
 */
export async function previewBatch(
  tx: TxClient,
  input: {
    from: Date
    to: Date
    /** Narrows the grid only. The batch itself is org-wide — see the page. */
    companyId: string | null
  },
): Promise<BatchPreview> {
  // A WINDOW WIDER THAN THE RANGE, so `outsideRange` has something to report.
  // Asking only for the range would make that bucket permanently empty and the
  // screen would claim there is nothing just outside it.
  const margin = 14 * 86_400_000
  const loads = await tx.load.findMany({
    where: {
      // `SETTLEABLE_LOAD` IS THE SHARED BASE — deleted, cancelled and closed
      // history, in one place. Restating those three here would be a fourth
      // copy of what freight is even a candidate.
      ...SETTLEABLE_LOAD,
      ...(input.companyId ? { companyId: input.companyId } : {}),
      stops: {
        some: {
          type: 'DELIVERY',
          scheduledAt: {
            gte: new Date(input.from.getTime() - margin),
            lte: new Date(input.to.getTime() + margin),
          },
        },
      },
    },
    orderBy: { loadNumber: 'asc' },
    take: 2000,
    select: {
      id: true,
      loadNumber: true,
      companyId: true,
      driverId: true,
      totalRevenueCents: true,
      company: { select: { name: true } },
      driver: {
        select: {
          firstName: true,
          lastName: true,
          // THE WHOLE RULE, because `ruleInForce` takes a `PayRule` and
          // deciding here which of its fields it "really" needs would be this
          // file knowing how pay rules work.
          payRules: true,
        },
      },
      stops: {
        where: { type: 'DELIVERY' },
        orderBy: { sequence: 'desc' },
        take: 1,
        select: { scheduledAt: true },
      },
      statusEvents: {
        where: {
          axis: 'OPERATIONAL',
          toStatus: 'POD_RECEIVED',
          outcome: 'APPLIED',
        },
        orderBy: { occurredAt: 'asc' },
        take: 1,
        select: { occurredAt: true },
      },
      settlementLoadLines: { select: { id: true }, take: 1 },
    },
  })

  const unavailable: Record<UnavailableReason, PreviewTrip[]> = {
    inTransit: [],
    outsideRange: [],
    alreadyInBatch: [],
    noDriver: [],
    noRule: [],
  }
  const available: PreviewTrip[] = []

  for (const load of loads) {
    const podAt = load.statusEvents[0]?.occurredAt ?? null
    const trip: PreviewTrip = {
      loadId: load.id,
      loadNumber: load.loadNumber,
      companyId: load.companyId,
      companyName: load.company.name,
      driverName: load.driver
        ? `${load.driver.firstName} ${load.driver.lastName}`
        : null,
      podAt,
      deliveredAt: load.stops[0]?.scheduledAt ?? null,
      grossCents: load.totalRevenueCents,
      reason: null,
    }

    // ── THE PRECEDENCE, STATED ────────────────────────────────────────
    //
    // Most-settled first: a load already on a statement is reported as such
    // whatever else is true of it, because "it is done" is the answer that
    // stops somebody looking. Then the two facts about the freight itself,
    // then the two about who would be paid — a load with no POD and no driver
    // is in transit first, because that is the earlier problem.
    const reason: UnavailableReason | null =
      load.settlementLoadLines.length > 0
        ? 'alreadyInBatch'
        : podAt === null
          ? 'inTransit'
          : podAt < input.from || podAt > input.to
            ? 'outsideRange'
            : load.driverId === null
              ? 'noDriver'
              : ruleInForce(load.driver?.payRules ?? [], input.to) === null
                ? 'noRule'
                : null

    if (reason === null) available.push(trip)
    else unavailable[reason].push({ ...trip, reason })
  }

  return { available, unavailable, considered: loads.length }
}
