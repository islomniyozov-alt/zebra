import { Prisma, type DriverStatus } from '@/generated/prisma/client'
import { ACTIVE_ROSTER } from './driver-roster'
import { NOT_CLOSED_HISTORY } from './billing-status'

// ---------------------------------------------------------------------------
// FOUR DISPATCH FIELDS, DERIVED. ONE FLAG, STORED.
//
// Item 11. Datatruck's exports carry `Heading to`, `Dispatch status`,
// `Last Activity` and `On Time Delivery` as columns — precomputed verdicts
// that go stale the moment the freight moves. Zebra works them out from rows
// it already has, the same posture as item 9's warnings and for the same
// reason: a copy of a fact is a fact with a shelf life, and nothing tells you
// when it expired.
//
// THE ONE EXCEPTION IS BEING OFF DUTY, and it is an exception because it is
// not derivable at all: a driver on holiday leaves no trace in the freight.
// Somebody has to say so, so `Driver.isOffDuty` is stored — and a CHECK stops
// its return date disagreeing with it.
//
// ── ONE QUERY PER LIST ───────────────────────────────────────────────────
//
// Every loader takes an array of ids and returns a Map, like item 9's. A list
// of two hundred drivers costs one round trip, and the integration suite
// counts the statements against a growing list rather than trusting this note.
// ---------------------------------------------------------------------------

type TxClient = Prisma.TransactionClient

/** A load is somebody's current work while it is none of these. */
const FINISHED = ['DELIVERED', 'POD_RECEIVED'] as const

/** …and it is actually moving once it reaches one of these. */
const MOVING = ['AT_PICKUP', 'LOADED', 'IN_TRANSIT', 'AT_DELIVERY'] as const

/**
 * Freight that is somebody's current work, as a Prisma filter.
 *
 * THE BOARD'S "AVAILABLE" COUNT IS COMPUTED FROM THIS (owner's ruling,
 * 2026-09-21), never from `Truck.status`. That column is a word somebody
 * typed: a truck hauling a load to Gastonia counted as available for as
 * long as nobody went back to the truck page to say otherwise, and the KPI
 * a dispatcher plans the week from was the most confident thing on the
 * screen and the least connected to the freight.
 *
 * Spread into a relation filter:
 *
 *     where: { ...ASSIGNABLE_TRUCK, loads: { none: ACTIVE_LOAD } }
 *
 * One statement, and it cannot go stale between page loads because there is
 * nothing to go stale.
 */
export const ACTIVE_LOAD = {
  deletedAt: null,
  isCancelled: false,
  operationalStatus: { notIn: [...FINISHED] },
} as const satisfies Prisma.LoadWhereInput

/**
 * Every load the board may read at all.
 *
 * ── CLOSED HISTORY IS NOT WORK, AND THE BILLING AXIS IS WHAT SAYS SO ──────
 *
 * Found on a production walk, 2026-10-05: the Unassigned rail was listing
 * Datatruck history. An imported load has no truck on it and was never
 * cancelled, which is the rail's entire test — so freight that finished before
 * Zebra existed queued up beside this morning's bookings.
 *
 * `NOT_CLOSED_HISTORY` is the same predicate the dashboard counts spread
 * everywhere for the same reason (`billing-status.ts`): a load closed in
 * Datatruck is closed whatever its operational status, and one that somebody
 * legitimately reopens stops being closed and starts appearing again — which
 * falls out of asking the STATUS rather than asking where the row came from.
 *
 * AND IT IS ON THE QUERY, NOT ON THE RAIL'S FILTER. The board reads the 300
 * most recently booked loads; with history in scope, that cap is spent on rows
 * nobody can work, so the rail could be wrong by omission as well as by
 * addition. Filtering after the fact would have fixed the list and left the
 * budget broken.
 */
export const BOARD_LOAD: Prisma.LoadWhereInput = {
  deletedAt: null,
  ...NOT_CLOSED_HISTORY,
}

// ── (1) heading to ───────────────────────────────────────────────────────

/**
 * Where a truck is going next: the last stop of the load it is on.
 *
 * BLANK IS AN ANSWER. A truck with no active load is not heading anywhere,
 * and "—" is the honest rendering of that. Datatruck leaves the cell empty
 * too; what it does not do is explain why, which is why this returns null
 * rather than a sentence and lets each screen phrase it.
 */
export function headingToFrom(
  stops: readonly { city: string | null; state: string | null }[],
): string | null {
  const last = stops[stops.length - 1]
  if (!last) return null
  const place = [last.city, last.state].filter(Boolean).join(', ')
  return place === '' ? null : place
}

// ── (2) dispatch status ──────────────────────────────────────────────────

export type DispatchStatus =
  | 'available'
  | 'assigned'
  | 'in_transit'
  | 'off_duty'

export interface DispatchFacts {
  /**
   * What the ROSTER says — on the books, on holiday, or gone.
   *
   * Required rather than optional on purpose: a caller that forgot it
   * would report a driver on vacation as Available, and an optional field
   * with a sensible default is exactly how that goes unnoticed.
   */
  rosterStatus: DriverStatus
  isOffDuty: boolean
  offDutyUntil: Date | null
  /** Operational statuses of every load this driver is crew on, unfinished. */
  activeStatuses: readonly string[]
}

/**
 * What a dispatcher can do with this driver right now.
 *
 * ── OFF DUTY WINS, AND IT EXPIRES ────────────────────────────────────────
 *
 * A driver marked off duty until Friday is off duty until Friday — and on
 * Saturday the flag is stale, so the RETURN DATE is honoured over it. That is
 * the whole reason the date exists: without it somebody has to remember to
 * clear a boolean, and the one nobody clears is the one that matters.
 *
 * A null `offDutyUntil` is indefinite and never expires.
 *
 * ── AND OTHERWISE THE FREIGHT DECIDES ────────────────────────────────────
 *
 * Moving beats assigned: a driver with one load at the dock and another
 * booked for Thursday is in transit, because that is what a dispatcher needs
 * to know before offering them anything.
 */
/**
 * Is this driver off duty AS OF NOW?
 *
 * EXPORTED BECAUSE TWO THINGS ASK IT. The list derives a status from it,
 * and `assertAssignable` refuses an assignment because of it — and a
 * picker that hides a driver the engine would still accept is half a rule.
 *
 * EXPIRED IS NOT OFF DUTY. The flag was true about last week; the return
 * date is what stops anybody having to remember to clear it.
 */
export function isOffDutyNow(
  facts: { isOffDuty: boolean; offDutyUntil: Date | null },
  now: Date,
): boolean {
  if (!facts.isOffDuty) return false
  const back = facts.offDutyUntil
  return back === null || back.getTime() > now.getTime()
}

export function dispatchStatusFrom(
  facts: DispatchFacts,
  now: Date,
): DispatchStatus {
  // THE ROSTER FIRST, because a person on holiday or no longer employed is
  // off duty whatever the freight says — and unlike the flag, nobody has to
  // set two things to say so. The list shows the roster badge in this case,
  // which is strictly more specific than "Off duty".
  if (facts.rosterStatus !== ACTIVE_ROSTER) return 'off_duty'
  if (isOffDutyNow(facts, now)) return 'off_duty'

  const moving = facts.activeStatuses.some((status) =>
    (MOVING as readonly string[]).includes(status),
  )
  if (moving) return 'in_transit'
  return facts.activeStatuses.length > 0 ? 'assigned' : 'available'
}

// ── (4) on-time delivery ─────────────────────────────────────────────────

export type OnTime = 'on_time' | 'late' | 'unknown'

export interface DeliveryFacts {
  /** When the truck actually checked in at the last delivery stop. */
  arrivedAt: Date | null
  /** The end of the promised window, or the appointment when there is no window. */
  windowEnd: Date | null
  scheduledAt: Date | null
}

/**
 * Did this load deliver on time?
 *
 * ── `unknown` IS NOT `late`, AND IT IS NOT `on_time` EITHER ──────────────
 *
 * A load with no check-in recorded tells us nothing about when it arrived.
 * Counting it as on time flatters the number; counting it as late punishes a
 * driver for a dispatcher who did not tick a box. It is EXCLUDED from the
 * rate entirely — the ruling, and the reason the rate reports how many loads
 * it is actually over.
 *
 * The promise is the WINDOW END when there is a window, and the appointment
 * when there is not. Arriving early is on time; nobody has ever complained
 * about a truck being ready.
 */
export function onTimeFrom(facts: DeliveryFacts): OnTime {
  const promised = facts.windowEnd ?? facts.scheduledAt
  if (facts.arrivedAt === null || promised === null) return 'unknown'
  return facts.arrivedAt.getTime() <= promised.getTime() ? 'on_time' : 'late'
}

/**
 * The same delivery facts, from stops ALREADY IN MEMORY.
 *
 * The load detail page holds every stop it needs; asking the database
 * again for a row it is rendering would be a round trip to learn nothing.
 * `deliveryFactsForLoads` is the list form of this and the two agree by
 * construction — the same last-DELIVERY-stop rule, written once here and
 * once as an ORDER BY there, which is why both are tested against the same
 * fixtures.
 *
 * NULL WHEN THERE IS NO DELIVERY STOP AT ALL. That is a malformed load
 * rather than an early one, and it is not the same fact as `unknown`.
 */
export function deliveryFactsFromStops(
  stops: readonly {
    type: string
    sequence: number
    arrivedAt: Date | null
    windowEnd: Date | null
    scheduledAt: Date | null
  }[],
): DeliveryFacts | null {
  const deliveries = stops.filter((stop) => stop.type === 'DELIVERY')
  if (deliveries.length === 0) return null
  const last = deliveries.reduce((a, b) => (b.sequence >= a.sequence ? b : a))
  return {
    arrivedAt: last.arrivedAt,
    windowEnd: last.windowEnd,
    scheduledAt: last.scheduledAt,
  }
}

export interface OnTimeRate {
  /** Loads that could be judged — both times present. */
  counted: number
  onTime: number
  /** Null when nothing could be judged, never zero. */
  percent: number | null
}

/**
 * A driver's record over the loads that can be judged.
 *
 * PERCENT IS NULL WHEN NOTHING COUNTS. Zero per cent and "no data" print the
 * same under a naive renderer and mean opposite things — one is a driver who
 * is always late, the other a driver nobody has recorded arrivals for.
 */
export function onTimeRateFrom(outcomes: readonly OnTime[]): OnTimeRate {
  const judged = outcomes.filter((outcome) => outcome !== 'unknown')
  const onTime = judged.filter((outcome) => outcome === 'on_time').length
  return {
    counted: judged.length,
    onTime,
    percent:
      judged.length === 0 ? null : Math.round((onTime / judged.length) * 100),
  }
}

// ── the loaders, one query each ──────────────────────────────────────────

/**
 * Where each truck is heading, in ONE statement.
 *
 * The truck's current load is its unfinished one; its destination is that
 * load's last stop by sequence. A lateral join rather than a query per truck.
 */
export async function headingToForTrucks(
  tx: TxClient,
  truckIds: readonly string[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  for (const id of truckIds) out.set(id, null)
  if (truckIds.length === 0) return out

  const rows = await tx.$queryRaw<
    { truck_id: string; city: string | null; state: string | null }[]
  >`
    SELECT l."truckId" AS truck_id, s."city", s."state"
      FROM "Load" l
      CROSS JOIN LATERAL (
        SELECT st."city", st."state"
          FROM "LoadStop" st
         WHERE st."loadId" = l."id"
         ORDER BY st."sequence" DESC
         LIMIT 1
      ) s
     WHERE l."truckId" = ANY(${[...truckIds]})
       AND l."deletedAt" IS NULL
       AND l."isCancelled" = false
       AND l."operationalStatus" <> ALL(${[...FINISHED]}::text[]::"LoadOperationalStatus"[])
     ORDER BY l."bookedAt" DESC
  `

  // The most recent unfinished load wins; the ORDER BY above puts it first,
  // and a truck with two open loads is a dispatch problem rather than a
  // rendering one.
  for (const row of rows) {
    if (out.get(row.truck_id)) continue
    out.set(row.truck_id, headingToFrom([{ city: row.city, state: row.state }]))
  }
  return out
}

/** Dispatch facts for many drivers, in ONE statement. */
export async function dispatchFactsForDrivers(
  tx: TxClient,
  driverIds: readonly string[],
): Promise<Map<string, DispatchFacts>> {
  const out = new Map<string, DispatchFacts>()
  if (driverIds.length === 0) return out

  const ids = [...driverIds]
  const rows = await tx.$queryRaw<
    {
      id: string
      roster_status: DriverStatus
      is_off_duty: boolean
      off_duty_until: Date | null
      statuses: string[] | null
    }[]
  >`
    SELECT d."id",
           d."status" AS roster_status,
           d."isOffDuty" AS is_off_duty,
           d."offDutyUntil" AS off_duty_until,
           ARRAY(
             SELECT l."operationalStatus"::text
               FROM "Load" l
              WHERE (l."driverId" = d."id" OR l."coDriverId" = d."id")
                AND l."deletedAt" IS NULL
                AND l."isCancelled" = false
                AND l."operationalStatus" <> ALL(${[...FINISHED]}::text[]::"LoadOperationalStatus"[])
           ) AS statuses
      FROM "Driver" d
     WHERE d."id" = ANY(${ids})
  `

  for (const row of rows) {
    out.set(row.id, {
      rosterStatus: row.roster_status,
      isOffDuty: row.is_off_duty,
      offDutyUntil: row.off_duty_until,
      activeStatuses: row.statuses ?? [],
    })
  }
  return out
}

/**
 * When each driver was last involved in anything, in ONE statement.
 *
 * THREE SOURCES, UNIONED: a status event on freight they are crew on, a
 * document filed against them, an assignment naming them. A `UNION ALL` fed
 * into one `max` rather than three queries — and a fourth source later is a
 * fourth arm, not a fourth round trip.
 */
export async function lastActivityForDrivers(
  tx: TxClient,
  driverIds: readonly string[],
): Promise<Map<string, Date | null>> {
  const out = new Map<string, Date | null>()
  for (const id of driverIds) out.set(id, null)
  if (driverIds.length === 0) return out

  const ids = [...driverIds]
  const rows = await tx.$queryRaw<{ id: string; at: Date | null }[]>`
    SELECT id, MAX(at) AS at FROM (
      SELECT COALESCE(l."driverId", l."coDriverId") AS id, e."occurredAt" AS at
        FROM "LoadStatusEvent" e
        JOIN "Load" l ON l."id" = e."loadId"
       WHERE (l."driverId" = ANY(${ids}) OR l."coDriverId" = ANY(${ids}))
      UNION ALL
      -- uploadedAt, not createdAt: Document has no createdAt, and when the
      -- file arrived is the fact that matters anyway.
      SELECT doc."driverId" AS id, doc."uploadedAt" AS at
        FROM "Document" doc
       WHERE doc."driverId" = ANY(${ids}) AND doc."deletedAt" IS NULL
      UNION ALL
      SELECT a."driverId" AS id, a."assignedAt" AS at
        FROM "LoadAssignment" a
       WHERE a."driverId" = ANY(${ids})
    ) touched
    WHERE id IS NOT NULL
    GROUP BY id
  `

  for (const row of rows) out.set(row.id, row.at)
  return out
}

/**
 * One driver's on-time record, in ONE statement.
 *
 * BOTH SEATS COUNT. A team driver was on the load whichever seat they sat
 * in, and item 8 made `coDriverId` a real assignment rather than a note —
 * so a co-driver whose loads all arrived late has a late record, and a
 * rate that read `driverId` alone would show them a record that isn't
 * theirs.
 *
 * ONLY FINISHED FREIGHT IS JUDGED. A load still in transit has not failed
 * to arrive; it has not arrived yet, and counting it as `unknown` would be
 * harmless to the percentage but would inflate the count the screen prints
 * beside it.
 */
export async function onTimeRateForDriver(
  tx: TxClient,
  driverId: string,
): Promise<OnTimeRate> {
  const rows = await tx.$queryRaw<
    {
      arrived_at: Date | null
      window_end: Date | null
      scheduled_at: Date | null
    }[]
  >`
    SELECT s."arrivedAt" AS arrived_at,
           s."windowEnd" AS window_end, s."scheduledAt" AS scheduled_at
      FROM "Load" l
      CROSS JOIN LATERAL (
        SELECT st."arrivedAt", st."windowEnd", st."scheduledAt"
          FROM "LoadStop" st
         WHERE st."loadId" = l."id" AND st."type" = 'DELIVERY'
         ORDER BY st."sequence" DESC
         LIMIT 1
      ) s
     WHERE (l."driverId" = ${driverId} OR l."coDriverId" = ${driverId})
       AND l."deletedAt" IS NULL
       AND l."isCancelled" = false
       AND l."operationalStatus" = ANY(${[...FINISHED]}::text[]::"LoadOperationalStatus"[])
  `

  return onTimeRateFrom(
    rows.map((row) =>
      onTimeFrom({
        arrivedAt: row.arrived_at,
        windowEnd: row.window_end,
        scheduledAt: row.scheduled_at,
      }),
    ),
  )
}

/** Delivery facts for many loads, in ONE statement. */
export async function deliveryFactsForLoads(
  tx: TxClient,
  loadIds: readonly string[],
): Promise<Map<string, DeliveryFacts>> {
  const out = new Map<string, DeliveryFacts>()
  if (loadIds.length === 0) return out

  const rows = await tx.$queryRaw<
    {
      load_id: string
      arrived_at: Date | null
      window_end: Date | null
      scheduled_at: Date | null
    }[]
  >`
    SELECT l."id" AS load_id, s."arrivedAt" AS arrived_at,
           s."windowEnd" AS window_end, s."scheduledAt" AS scheduled_at
      FROM "Load" l
      CROSS JOIN LATERAL (
        SELECT st."arrivedAt", st."windowEnd", st."scheduledAt"
          FROM "LoadStop" st
         WHERE st."loadId" = l."id" AND st."type" = 'DELIVERY'
         ORDER BY st."sequence" DESC
         LIMIT 1
      ) s
     WHERE l."id" = ANY(${[...loadIds]}) AND l."deletedAt" IS NULL
  `

  for (const row of rows) {
    out.set(row.load_id, {
      arrivedAt: row.arrived_at,
      windowEnd: row.window_end,
      scheduledAt: row.scheduled_at,
    })
  }
  return out
}
