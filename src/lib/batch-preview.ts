import { Prisma } from '@/generated/prisma/client'
import {
  DELIVERED_STATUSES,
  SETTLEABLE_LOAD,
  deliveryDateOf,
} from './settlements'
import {
  payFor,
  ruleInForce,
  type PayFailure,
  type PayRule,
} from './driver-pay'
import { asDate } from './sql-json'

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
  // DELIVERED, AND NO DELIVERY DATE TO PLACE IT BY (MONEY-DESIGN §6, owner's
  // ruling 2026-11-17): no delivery stop departure and no applied event to
  // Delivered. Said by name rather than read as "in transit", which it is not.
  'noDeliveryDate',
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
  /**
   * WHO IS PAID, which is not always the driver's own name (§6.2.10).
   * `Driver.payToName` is the name on the statement when one is set — a leasing
   * company, a spouse, an owner-operator's LLC — and the driver's name otherwise.
   * The trip picker shows the payee because that is the row the office is
   * deciding about.
   */
  payeeName: string | null
  /**
   * Company driver or owner-operator, from `Driver.driverType`.
   *
   * THE SCREEN SHOWS IT BECAUSE THE PAY RULE USUALLY FOLLOWS IT, and a batch
   * with one owner-operator in the wrong week is the kind of mistake that is
   * obvious on the row and invisible in the total.
   */
  driverType: string | null
  /** The broker's own reference for the trip. Datatruck's "Load ref". */
  referenceNumber: string | null
  /** DELIVERED or POD_RECEIVED — the operational axis, as the office reads it. */
  status: string
  /**
   * THE DELIVERY DATE — `deliveryDateOf`, the date a period is decided by
   * since 2026-11-17 (MONEY-DESIGN §6): the last drop's actual departure, else
   * when the status reached Delivered. Null when neither is recorded.
   */
  deliveryAt: Date | null
  /** The Delivery cell: the delivery date, else the last drop's plan. */
  deliveredAt: Date | null
  pickupAt: Date | null
  /** `Chicago, IL → Dallas, TX`. One cell, because it is read as one fact. */
  locations: string | null
  /**
   * THE LOAD'S REVENUE — what the percentage is taken OF, not the driver's cut.
   *
   * NAMED `grossCents` ON PURPOSE and not "load pay": `Settlement.grossCents`
   * is the same quantity, and the agreement test for this screen is that the
   * ticked trips sum to the BATCH's gross. A column called pay that held revenue
   * is the error this project has already made once, in `topDriversByGross`.
   */
  grossCents: number
  /**
   * THE DRIVER'S CUT FOR THIS TRIP, under the rule in force — the office's own
   * "load pay" (owner's ruling, 2026-10-05).
   *
   * COMPUTED BY `payFor`, THE FUNCTION THAT WILL SETTLE IT. Not a percentage
   * applied here: a second implementation of pay would agree with the engine
   * until the day it did not, and the day it did not would be a Friday.
   *
   * NULL MEANS THE PAY CANNOT BE COMPUTED YET — a CUSTOM rule, or a percentage
   * rule with no percentage on it. Those rows say so in words and cannot be
   * ticked (§6.2.10): a trip whose pay nobody can state must not go into a batch
   * on the strength of a blank cell.
   */
  loadPayCents: number | null
  /**
   * Why `loadPayCents` is null, for the words on the row.
   *
   * `PayFailure` ITSELF, not a hand-written copy of it. The first version listed
   * three of the four and the compiler named the fourth — `no_miles`, a per-mile
   * rule on a load nobody put miles on. A row saying "no rule" about that would
   * send somebody to the wrong screen.
   */
  payProblem: PayFailure | null
  /** Null on an available trip; the bucket otherwise. */
  reason: UnavailableReason | null
  /**
   * DELIVERED BEFORE THE RANGE AND NOT YET PAID — the catch-up group (owner's
   * ruling 2026-11-17, MONEY-DESIGN §6). An available trip either way; the
   * screen lists these as their own group, "Delivered earlier, not yet paid",
   * ticked by default. False on every unavailable trip.
   */
  earlier: boolean
  /**
   * On the batch screen (§6.2.10 part 2b): this batch has declined the trip, so
   * its box starts UNTICKED. Always false on the picker, which has no batch yet.
   */
  excluded: boolean
}

/** One load as the preview reads it — the shape both spellings return. */
export interface PreviewLoad {
  id: string
  loadNumber: string
  referenceNumber: string | null
  operationalStatus: string
  companyId: string
  driverId: string | null
  linehaulCents: number
  fuelSurchargeCents: number
  accessorialsCents: number
  totalRevenueCents: number
  actualMiles: number | null
  dispatchedMiles: number | null
  company: { name: string }
  driver: {
    firstName: string
    lastName: string
    payToName: string | null
    driverType: string
    payRules: PayRule[]
  } | null
  stops: {
    type: string
    scheduledAt: Date | null
    /** The actual departure — the first source of the delivery date. */
    departedAt: Date | null
    city: string | null
    state: string | null
    name: string | null
  }[]
  /** At most one: the earliest applied event to Delivered or POD received. */
  statusEvents: { occurredAt: Date }[]
  settlementLoadLines: { settlement: { batchId: string | null } }[]
}

export interface BatchPreview {
  available: PreviewTrip[]
  unavailable: Record<UnavailableReason, PreviewTrip[]>
  /** Every load looked at, so a reader can check the buckets add up. */
  considered: number
}

/**
 * The catch-up candidates the picker reads besides its window (owner's ruling
 * 2026-11-17, MONEY-DESIGN §6): Delivered, with a driver, on no statement —
 * or, on the batch screen, on that batch's own. No date bound: "regardless of
 * date" is the ruling. `previewLoadsSql` spells the same clause in SQL.
 */
export function catchUpWhere(forBatchId: string | null): Prisma.LoadWhereInput {
  return {
    operationalStatus: { in: [...DELIVERED_STATUSES] },
    driverId: { not: null },
    settlementLines: { none: {} },
    OR: [
      { settlementLoadLines: { none: {} } },
      ...(forBatchId
        ? [
            {
              settlementLoadLines: {
                some: { settlement: { batchId: forBatchId } },
              },
            },
          ]
        : []),
    ],
  }
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
    /**
     * THE BATCH SCREEN'S OWN BATCH (§6.2.10 part 2b). A trip on this batch's
     * statements is available and ticked; a trip this batch excluded is
     * available and unticked; a trip on ANOTHER batch's statement is still
     * "already on a statement". Null on the picker.
     */
    forBatchId?: string | null
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
      OR: [
        // THE WINDOW: delivery planned within a fortnight of the range.
        {
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
        // AND THE CATCH-UP, HOWEVER OLD (owner's ruling 2026-11-17): every
        // Delivered trip with a driver that is on no statement — or on THIS
        // batch's, on the batch screen — so a trip the batch will draft is a
        // trip the screen lists by name. Classified below like any other.
        catchUpWhere(input.forBatchId ?? null),
      ],
    },
    orderBy: { loadNumber: 'asc' },
    take: 2000,
    select: {
      id: true,
      loadNumber: true,
      referenceNumber: true,
      operationalStatus: true,
      companyId: true,
      driverId: true,
      // THE WHOLE MONEY SHAPE `payFor` TAKES. Six scalars rather than the one
      // this query used to read, because a percentage rule works off the
      // linehaul and a per-mile rule off the miles — deciding here which of them
      // "really" matters would be this file knowing how pay rules work, which is
      // the same argument the comment on `payRules` below already makes.
      linehaulCents: true,
      fuelSurchargeCents: true,
      accessorialsCents: true,
      totalRevenueCents: true,
      actualMiles: true,
      dispatchedMiles: true,
      company: { select: { name: true } },
      driver: {
        select: {
          firstName: true,
          lastName: true,
          // THE PAYEE AND THE EMPLOYMENT, for the trip picker's columns
          // (§6.2.10). Two scalars on a relation this query already reads.
          payToName: true,
          driverType: true,
          // THE WHOLE RULE, because `ruleInForce` takes a `PayRule` and
          // deciding here which of its fields it "really" needs would be this
          // file knowing how pay rules work.
          payRules: true,
        },
      },
      // ── BOTH ENDS NOW, NOT ONLY THE DELIVERY ──────────────────────────
      //
      // The picker shows pickup, delivery and the pair of places, so the filter
      // on `type` is gone and the derivation below picks the ends out. Two or
      // three rows per load against a `take: 2000` cap, on a screen that is read
      // once a week.
      stops: {
        orderBy: { sequence: 'asc' },
        select: {
          type: true,
          scheduledAt: true,
          departedAt: true,
          city: true,
          state: true,
          name: true,
        },
      },
      // THE STATUS REACHING DELIVERED — the delivery date's second source
      // (MONEY-DESIGN §6, 2026-11-17). It was the POD event.
      statusEvents: {
        where: {
          axis: 'OPERATIONAL',
          toStatus: { in: [...DELIVERED_STATUSES] },
          outcome: 'APPLIED',
        },
        orderBy: { occurredAt: 'asc' },
        take: 1,
        select: { occurredAt: true },
      },
      // WHOSE statement, not merely whether: the batch screen has to tell its
      // own batch's lines from another batch's (§6.2.10 part 2b).
      settlementLoadLines: {
        select: { settlement: { select: { batchId: true } } },
        take: 1,
      },
    },
  })

  // THE TICKS, FROM THE ONLY PLACE THEY LIVE. Empty on the picker.
  const excludedHere = new Set(
    input.forBatchId
      ? (
          await tx.settlementBatchExclusion.findMany({
            where: { batchId: input.forBatchId },
            select: { loadId: true },
          })
        ).map((row) => row.loadId)
      : [],
  )

  return previewFrom(loads, excludedHere, input)
}

/**
 * The classification, over loads already read — pure, so the batch screen can
 * read its window in its one call (§6.2.10 part 2b, v11.08) and classify it
 * here, through the same precedence the picker uses.
 */
export function previewFrom(
  loads: readonly PreviewLoad[],
  excludedHere: ReadonlySet<string>,
  input: { from: Date; to: Date; forBatchId?: string | null },
): BatchPreview {
  const unavailable: Record<UnavailableReason, PreviewTrip[]> = {
    inTransit: [],
    noDeliveryDate: [],
    outsideRange: [],
    alreadyInBatch: [],
    noDriver: [],
    noRule: [],
  }
  const available: PreviewTrip[] = []

  // `Chicago, IL`, or the facility name when a Relay import left no city — the
  // same fallback the loads list uses, for the same reason.
  const place = (stop: {
    city: string | null
    state: string | null
    name: string | null
  }) => {
    const city = [stop.city, stop.state].filter(Boolean).join(', ')
    return city === '' ? (stop.name ?? null) : city
  }

  // THE LAST DAY COUNTS WHOLE: `to` is a midnight, and a delivery at 2 pm on
  // it is inside the range — the same end the engine reads
  // (`settleableForBatch` pushes it to the last millisecond).
  const lastInstant = input.to.getTime() + 86_399_999
  for (const load of loads) {
    const deliveryAt = deliveryDateOf({
      stops: load.stops,
      finishedAt: load.statusEvents[0]?.occurredAt ?? null,
    })
    const delivered = (DELIVERED_STATUSES as readonly string[]).includes(
      load.operationalStatus,
    )
    const pickup = load.stops.find((stop) => stop.type === 'PICKUP') ?? null
    const deliveries = load.stops.filter((stop) => stop.type === 'DELIVERY')
    const delivery = deliveries[deliveries.length - 1] ?? null
    const ends = [pickup, delivery]
      .map((stop) => (stop ? place(stop) : null))
      .filter((text): text is string => text !== null)

    const trip: PreviewTrip = {
      loadId: load.id,
      loadNumber: load.loadNumber,
      companyId: load.companyId,
      companyName: load.company.name,
      driverName: load.driver
        ? `${load.driver.firstName} ${load.driver.lastName}`
        : null,
      // THE PAYEE FALLS BACK TO THE DRIVER'S OWN NAME, because `payToName` is
      // optional precisely so that it is not a second copy of a name already
      // on the row (see the schema's comment on it).
      payeeName:
        load.driver?.payToName?.trim() ||
        (load.driver
          ? `${load.driver.firstName} ${load.driver.lastName}`
          : null),
      driverType: load.driver?.driverType ?? null,
      referenceNumber: load.referenceNumber,
      status: load.operationalStatus,
      deliveryAt,
      deliveredAt: deliveryAt ?? delivery?.scheduledAt ?? null,
      pickupAt: pickup?.scheduledAt ?? null,
      locations: ends.length === 0 ? null : ends.join(' → '),
      grossCents: load.totalRevenueCents,
      // ── THE DRIVER'S CUT, FROM THE ENGINE ──────────────────────────────
      //
      // `input.to` is the date the rule is looked up on, which is the same date
      // the `noRule` bucket below uses — one reading of "which rule applies", so
      // the grid cannot offer a trip whose rule it then disagrees about.
      ...(() => {
        const rule = ruleInForce(load.driver?.payRules ?? [], input.to)
        if (rule === null) {
          return { loadPayCents: null, payProblem: 'no_rule' as const }
        }
        const pay = payFor(
          {
            id: load.id,
            loadNumber: load.loadNumber,
            linehaulCents: load.linehaulCents,
            fuelSurchargeCents: load.fuelSurchargeCents,
            accessorialsCents: load.accessorialsCents,
            totalRevenueCents: load.totalRevenueCents,
            actualMiles: load.actualMiles,
            dispatchedMiles: load.dispatchedMiles,
          },
          rule,
        )
        return pay.ok
          ? { loadPayCents: pay.amountCents, payProblem: null }
          : { loadPayCents: null, payProblem: pay.reason }
      })(),
      reason: null,
      earlier: false,
      excluded: excludedHere.has(load.id),
    }

    // ON A STATEMENT — BUT WHOSE? On the picker any statement line settles it.
    // On the batch screen this batch's own lines are the batch's trips, which
    // is the whole point of the screen; only ANOTHER batch's line puts a trip
    // in the "already on a statement" bucket.
    const line = load.settlementLoadLines[0] ?? null
    const onAnotherStatement =
      line !== null &&
      (input.forBatchId == null || line.settlement.batchId !== input.forBatchId)

    // ── THE PRECEDENCE, STATED ────────────────────────────────────────
    //
    // Most-settled first: a load already on a statement is reported as such
    // whatever else is true of it, because "it is done" is the answer that
    // stops somebody looking. Then the two facts about the freight itself,
    // then the two about who would be paid — a load with no POD and no driver
    // is in transit first, because that is the earlier problem.
    const reason: UnavailableReason | null = onAnotherStatement
      ? 'alreadyInBatch'
      : !delivered
        ? 'inTransit'
        : deliveryAt === null
          ? 'noDeliveryDate'
          : // AFTER THE RANGE ONLY. Before it is the catch-up: eligible for this
            // batch however long ago (owner's ruling 2026-11-17).
            deliveryAt.getTime() > lastInstant
            ? 'outsideRange'
            : load.driverId === null
              ? 'noDriver'
              : ruleInForce(load.driver?.payRules ?? [], input.to) === null
                ? 'noRule'
                : null

    if (reason === null) {
      available.push({
        ...trip,
        earlier: deliveryAt !== null && deliveryAt < input.from,
      })
    } else unavailable[reason].push({ ...trip, reason })
  }

  return { available, unavailable, considered: loads.length }
}

// ---------------------------------------------------------------------------
// THE SAME WINDOW AS SQL, for a page that reads it inside its one call
// (§6.2.10 part 2b v11.08: the batch screen). A SECOND SPELLING of
// `previewBatch`'s `load.findMany` — SETTLEABLE_LOAD, the authority, a
// delivery stop within fourteen days of the range, ordered by load number,
// capped at 2,000 — so the enforcer is named:
// `tests/integration/batch-page-head.test.ts` holds `previewLoadsFrom` of this
// equal to the `findMany`, row for row, on a window with a load on both sides
// of every filter.
//
// The range and the authority are SQL EXPRESSIONS, because on the batch screen
// they are the batch's own columns, read in the same statement.
//
// A load carries at most one statement line per driver; where a team load
// has two, `findMany`'s `take: 1` picks one in no stated order, and this
// picks the lowest id.
// ---------------------------------------------------------------------------

export function previewLoadsSql(window: {
  from: Prisma.Sql
  to: Prisma.Sql
  companyId: Prisma.Sql
  /** The batch screen's own batch, whose lined trips count as catch-up. */
  forBatchId?: Prisma.Sql
}): Prisma.Sql {
  const forBatchId = window.forBatchId ?? Prisma.sql`NULL`
  return Prisma.sql`
    SELECT l.id, l."loadNumber", l."referenceNumber",
           l."operationalStatus"::text AS "operationalStatus",
           l."companyId", l."driverId",
           l."linehaulCents", l."fuelSurchargeCents", l."accessorialsCents",
           l."totalRevenueCents", l."actualMiles", l."dispatchedMiles",
           c.name AS company_name,
           CASE WHEN d.id IS NULL THEN NULL ELSE json_build_object(
             'firstName', d."firstName", 'lastName', d."lastName",
             'payToName', d."payToName", 'driverType', d."driverType"::text,
             'payRules', (
               SELECT COALESCE(json_agg(json_build_object(
                        'id', r.id, 'type', r.type::text,
                        'percentBps', r."percentBps",
                        'perMileCents', r."perMileCents",
                        'flatCents', r."flatCents",
                        'effectiveFrom', r."effectiveFrom",
                        'effectiveTo', r."effectiveTo") ORDER BY r.id), '[]'::json)
                 FROM "DriverPayRule" r WHERE r."driverId" = d.id)
           ) END AS driver,
           (SELECT COALESCE(json_agg(json_build_object(
                     'type', st.type::text, 'scheduledAt', st."scheduledAt",
                     'departedAt', st."departedAt",
                     'city', st.city, 'state', st.state, 'name', st.name)
                   ORDER BY st.sequence), '[]'::json)
              FROM "LoadStop" st WHERE st."loadId" = l.id) AS stops,
           -- THE STATUS REACHING DELIVERED (MONEY-DESIGN §6, 2026-11-17): the
           -- earliest applied event to Delivered or POD received. It was the
           -- POD event alone. \`deliveryDateOf\` decides from this and the stops.
           (SELECT e."occurredAt" FROM "LoadStatusEvent" e
             WHERE e."loadId" = l.id AND e.axis::text = 'OPERATIONAL'
               AND e."toStatus" IN ('DELIVERED', 'POD_RECEIVED')
               AND e.outcome::text = 'APPLIED'
             ORDER BY e."occurredAt" LIMIT 1) AS finished_at,
           (SELECT s."batchId" FROM "SettlementLoadLine" ll
              JOIN "Settlement" s ON s.id = ll."settlementId"
             WHERE ll."loadId" = l.id ORDER BY ll.id LIMIT 1) AS line_batch_id,
           EXISTS (SELECT 1 FROM "SettlementLoadLine" ll
                    WHERE ll."loadId" = l.id) AS on_statement
      FROM "Load" l
      JOIN "Company" c ON c.id = l."companyId"
      LEFT JOIN "Driver" d ON d.id = l."driverId"
     WHERE l."deletedAt" IS NULL AND l."isCancelled" = false
       AND l."billingStatus"::text <> 'CLOSED_IN_DATATRUCK'
       AND (${window.companyId} IS NULL OR l."companyId" = ${window.companyId})
       AND (EXISTS (
         SELECT 1 FROM "LoadStop" st
          WHERE st."loadId" = l.id AND st.type::text = 'DELIVERY'
            AND st."scheduledAt" >= ${window.from} - interval '14 days'
            AND st."scheduledAt" <= ${window.to} + interval '14 days')
         -- THE CATCH-UP, HOWEVER OLD (owner's ruling 2026-11-17): \`catchUpWhere\`.
         OR (l."operationalStatus"::text IN ('DELIVERED', 'POD_RECEIVED')
             AND l."driverId" IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM "SettlementLine" sl
                              WHERE sl."loadId" = l.id)
             AND (NOT EXISTS (SELECT 1 FROM "SettlementLoadLine" ll
                               WHERE ll."loadId" = l.id)
                  OR EXISTS (SELECT 1 FROM "SettlementLoadLine" ll
                               JOIN "Settlement" s ON s.id = ll."settlementId"
                              WHERE ll."loadId" = l.id
                                AND s."batchId" = ${forBatchId}))))
     ORDER BY l."loadNumber"
     LIMIT 2000`
}

type Stamp = string | Date

export interface PreviewLoadSqlRow {
  id: string
  loadNumber: string
  referenceNumber: string | null
  operationalStatus: string
  companyId: string
  driverId: string | null
  linehaulCents: number
  fuelSurchargeCents: number
  accessorialsCents: number
  totalRevenueCents: number
  actualMiles: number | null
  dispatchedMiles: number | null
  company_name: string
  driver: {
    firstName: string
    lastName: string
    payToName: string | null
    driverType: string
    payRules: (Omit<PayRule, 'effectiveFrom' | 'effectiveTo'> & {
      effectiveFrom: Stamp
      effectiveTo: Stamp | null
    })[]
  } | null
  stops: {
    type: string
    scheduledAt: Stamp | null
    departedAt: Stamp | null
    city: string | null
    state: string | null
    name: string | null
  }[]
  finished_at: Stamp | null
  line_batch_id: string | null
  on_statement: boolean
}

/** `previewLoadsSql`'s rows as `previewFrom` takes them, from either transport. */
export function previewLoadsFrom(
  rows: readonly PreviewLoadSqlRow[],
): PreviewLoad[] {
  return rows.map((row) => ({
    id: row.id,
    loadNumber: row.loadNumber,
    referenceNumber: row.referenceNumber,
    operationalStatus: row.operationalStatus,
    companyId: row.companyId,
    driverId: row.driverId,
    linehaulCents: row.linehaulCents,
    fuelSurchargeCents: row.fuelSurchargeCents,
    accessorialsCents: row.accessorialsCents,
    totalRevenueCents: row.totalRevenueCents,
    actualMiles: row.actualMiles,
    dispatchedMiles: row.dispatchedMiles,
    company: { name: row.company_name },
    driver: row.driver && {
      firstName: row.driver.firstName,
      lastName: row.driver.lastName,
      payToName: row.driver.payToName,
      driverType: row.driver.driverType,
      payRules: row.driver.payRules.map((rule) => ({
        ...rule,
        effectiveFrom: asDate(rule.effectiveFrom) ?? new Date(NaN),
        effectiveTo: asDate(rule.effectiveTo),
      })),
    },
    stops: row.stops.map((stop) => ({
      ...stop,
      scheduledAt: asDate(stop.scheduledAt),
      departedAt: asDate(stop.departedAt),
    })),
    statusEvents:
      row.finished_at === null
        ? []
        : [{ occurredAt: asDate(row.finished_at) ?? new Date(NaN) }],
    settlementLoadLines: row.on_statement
      ? [{ settlement: { batchId: row.line_batch_id } }]
      : [],
  }))
}
