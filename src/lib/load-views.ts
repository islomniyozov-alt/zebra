import type { LoadBillingStatus, Prisma } from '@/generated/prisma/client'
import { NOT_CLOSED_HISTORY } from './billing-status'
import { readyToInvoiceWhere } from './invoices'
import {
  localDateIn,
  MAPPED_STATES,
  statesInZone,
  ZONE_CHOICES,
  zoneMidnight,
} from './stop-time'
import { weekOf } from './settlement-week'

// ---------------------------------------------------------------------------
// NAMED VIEWS OF THE LOADS LIST. ONE PREDICATE, THREE READERS.
//
// Owner's ruling, 2026-10-01, on three dashboard rows that disagreed with their
// own links. MEASURED ON DEV BEFORE THIS EXISTED:
//
//   podMissing          counted     1   its href listed 13,500
//   noRate              counted     0   its href listed    858
//   unassignedFinished  counted   101   its href listed    858
//
// The rows filtered on closed history, cancellation and revenue; the list
// filtered on `operationalStatus` alone. So "1 delivered, waiting on a POD"
// opened a list of thirteen and a half thousand rows — `dashboard.ts`'s own
// header warning, come true: "a dashboard whose numbers are computed a second
// way is a dashboard that eventually disagrees with the screen it sends you to,
// and the person stops believing both."
//
// ── A NAME IN THE URL, NEVER A RAW FILTER ───────────────────────────────
//
// The ruling: `?view=podMissing`, resolved through the SAME function the count
// uses. Not `?status=DELIVERED&closed=false&cancelled=false`, which would put
// the predicate in the link — where it can be edited to something the count
// never meant, cannot be changed without breaking every bookmark, and has to be
// kept in step by whoever next edits either end.
//
// A NAME IS A PROMISE THAT ONE FUNCTION KEEPS. The row counts it, the list
// lists it, the SQL translates it, and `tests/integration/dashboard.test.ts`
// requires the count and the listing to be the same number per row.
//
// ── THE GENERALISATION OF SOMETHING THAT ALREADY WORKED ─────────────────
//
// `readyToInvoiceWhere` has been shared between the dashboard row, the invoice
// queue and the loads list since Phase 5 — it is the one row that never
// disagreed with its link, and it is the shape the other three now take. The
// loads list already resolved `?billing=READY_TO_INVOICE` through it; this
// turns that one special case into a registry.
//
// ── NO VIEW MEANS TODAY'S BEHAVIOUR, INCLUDING CLOSED HISTORY ───────────
//
// Ruling 3. `/loads` with no `?view=` lists what it has always listed — every
// load, archive included — because "show me everything" is a real question and
// the archive is 13,517 of the answer. Closed history is excluded only where a
// VIEW says so, and each view says so in its own predicate rather than the list
// applying a rule nobody asked for.
// ---------------------------------------------------------------------------

/**
 * Delivered, and no POD. The load cannot be billed and the clock is running.
 *
 * NOT CANCELLED AND NOT ARCHIVE. A cancelled load is not waiting for anything,
 * and a load Datatruck closed two years ago has a POD somewhere nobody here
 * needs to chase.
 */
export function podMissingWhere(): Prisma.LoadWhereInput {
  return {
    ...NOT_CLOSED_HISTORY,
    deletedAt: null,
    isCancelled: false,
    operationalStatus: 'DELIVERED',
  }
}

/**
 * POD in, no rate. Nobody can invoice it and nobody is looking at it.
 *
 * `lte: 0` RATHER THAN `equals: 0`, because a negative total is also a load
 * nobody can bill and is a data problem besides — it belongs in the queue that
 * gets looked at, not in the gap between two predicates.
 */
export function noRateWhere(): Prisma.LoadWhereInput {
  return {
    ...NOT_CLOSED_HISTORY,
    deletedAt: null,
    isCancelled: false,
    operationalStatus: 'POD_RECEIVED',
    totalRevenueCents: { lte: 0 },
  }
}

/**
 * Finished, billable, and attached to nobody.
 *
 * MOVED HERE FROM `dashboard.ts`, where it was exported and read by no screen —
 * which is how its row came to point at `/loads?status=POD_RECEIVED` and list
 * 858 rows against a count of 101.
 *
 * EITHER HALF MISSING IS THE ALARM. Driver is the one that stops the pay; truck
 * is the owner's ruling and the evidence that a POD arrived for a movement
 * nobody witnessed.
 */
export function unassignedFinishedWhere(): Prisma.LoadWhereInput {
  return {
    ...NOT_CLOSED_HISTORY,
    deletedAt: null,
    isCancelled: false,
    operationalStatus: 'POD_RECEIVED',
    totalRevenueCents: { gt: 0 },
    OR: [{ driverId: null }, { truckId: null }],
  }
}

/**
 * Booked or available, with no truck or no driver on it.
 *
 * ITS ROW POINTS AT `/dispatch`, NOT AT THIS VIEW, and the view exists anyway:
 * the dispatch board is a different screen with its own shape, and a reader who
 * wants the same set as a LIST should be able to ask for it. The row's link is
 * unchanged by ruling — dispatch is where that work is done.
 */
export function unassignedWhere(): Prisma.LoadWhereInput {
  return {
    ...NOT_CLOSED_HISTORY,
    deletedAt: null,
    isCancelled: false,
    operationalStatus: { in: ['AVAILABLE', 'BOOKED'] },
    OR: [{ driverId: null }, { truckId: null }],
  }
}

// ---------------------------------------------------------------------------
// DATED VIEWS (TMS-DESIGN-SYSTEM.md §6.7, 2026-10-08).
//
// A stop's day is its OWN day. A date-only stop is stored at midnight in its
// zone (§8), so one UTC window would put an Eastern stop on the day before in
// Chicago. The zone is `renderStopTime`'s: the stop's state, else the load's
// authority's zone, which is every Relay stop, because Relay stops carry no
// address. So each date bound is one OR arm per zone, and every stop falls in
// exactly one arm: a mapped state goes to its zone's arm, and anything else goes
// to its authority's zone's arm.
// ---------------------------------------------------------------------------

/** What a dated view needs to know, decided once per request. */
export interface ViewContext {
  /** Today's date, `YYYY-MM-DD`, in the default authority's zone. */
  today: string
  /** Every zone a stop may be dated in: each state's, and each authority's. */
  zones: readonly string[]
  /** The `pickup` and `delivery` views' bounds, straight from the URL. */
  from?: string
  to?: string
}

/** The zone `Company.timezone` defaults to in the schema. */
export const DEFAULT_ZONE = 'America/Chicago'

/**
 * Today and the zones, from the authorities the page already read.
 *
 * TODAY IS THE DEFAULT AUTHORITY'S DATE (§6.7), else the schema default's. The
 * zones are every state zone plus each authority's own, so an authority on a
 * zone no state maps to still gets an arm for its stateless stops.
 */
export function viewContext(
  authorities: readonly { timezone: string; isDefault: boolean }[],
  now: Date,
  bounds: { from?: string; to?: string } = {},
): ViewContext {
  const home =
    authorities.find((authority) => authority.isDefault)?.timezone ??
    DEFAULT_ZONE
  return {
    today: localDateIn(now, home),
    zones: [
      ...new Set([
        ...ZONE_CHOICES,
        DEFAULT_ZONE,
        ...authorities.map((a) => a.timezone),
      ]),
    ],
    ...bounds,
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** `YYYY-MM-DD` plus `days`, by calendar day. */
export function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number) as [
    number,
    number,
    number,
  ]
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10)
}

/** A real calendar date in `YYYY-MM-DD`, not merely the shape of one. */
function isIsoDate(value: string | undefined): value is string {
  return (
    value !== undefined && ISO_DATE.test(value) && addDays(value, 0) === value
  )
}

/** The stops `zoneForState` would date in `zone`. */
function stopsInZone(zone: string): Prisma.LoadStopWhereInput {
  const states = statesInZone(zone)
  return {
    OR: [
      ...(states.length > 0 ? [{ state: { in: states } }] : []),
      {
        AND: [
          { OR: [{ state: null }, { state: { notIn: [...MAPPED_STATES] } }] },
          { load: { company: { timezone: zone } } },
        ],
      },
    ],
  }
}

/**
 * Stops whose local day falls in [`from`, `before`). Either bound may be absent.
 *
 * THE DATE IS `scheduledAt`, ELSE `windowStart`. A stop with neither matches
 * nothing, whatever the bounds.
 */
function stopDayWhere(
  zones: readonly string[],
  bounds: { from?: string; before?: string },
): Prisma.LoadStopWhereInput {
  return {
    OR: zones.map((zone) => {
      const range = {
        ...(bounds.from ? { gte: zoneMidnight(bounds.from, zone) } : {}),
        ...(bounds.before ? { lt: zoneMidnight(bounds.before, zone) } : {}),
      }
      return {
        AND: [
          stopsInZone(zone),
          {
            OR: [
              { scheduledAt: range },
              { scheduledAt: null, windowStart: range },
            ],
          },
        ],
      }
    }),
  }
}

/**
 * The FIRST pickup's day is in [`from`, `to`], both inclusive.
 *
 * "First" is the earliest dated pickup: one in the range, and none before it.
 * That is the stop the Pickup column prints.
 */
export function firstPickupBetween(
  zones: readonly string[],
  from: string,
  to: string,
): Prisma.LoadWhereInput {
  return {
    AND: [
      {
        stops: {
          some: {
            type: 'PICKUP',
            ...stopDayWhere(zones, { from, before: addDays(to, 1) }),
          },
        },
      },
      {
        stops: {
          none: { type: 'PICKUP', ...stopDayWhere(zones, { before: from }) },
        },
      },
    ],
  }
}

/**
 * The FINAL delivery's day is in [`from`, `to`], both inclusive.
 *
 * One delivery in the range and none after it, which is the stop the Delivery
 * and DEL date columns print.
 */
export function finalDeliveryBetween(
  zones: readonly string[],
  from: string,
  to: string,
): Prisma.LoadWhereInput {
  const after = addDays(to, 1)
  return {
    AND: [
      {
        stops: {
          some: {
            type: 'DELIVERY',
            ...stopDayWhere(zones, { from, before: after }),
          },
        },
      },
      {
        stops: {
          none: { type: 'DELIVERY', ...stopDayWhere(zones, { from: after }) },
        },
      },
    ],
  }
}

/** A queue leaves out the dead and the archive. A range filter does not. */
const QUEUE = {
  deletedAt: null,
  isCancelled: false,
} as const

/** The first pickup is today, in the default authority's date. */
export function picksUpTodayWhere(ctx: ViewContext): Prisma.LoadWhereInput {
  return {
    ...QUEUE,
    ...NOT_CLOSED_HISTORY,
    ...firstPickupBetween(ctx.zones, ctx.today, ctx.today),
  }
}

/** The final delivery is in this settlement week, Sunday to Saturday. */
export function deliversThisWeekWhere(ctx: ViewContext): Prisma.LoadWhereInput {
  const week = weekOf(new Date(`${ctx.today}T00:00:00Z`))
  return {
    ...QUEUE,
    ...NOT_CLOSED_HISTORY,
    ...finalDeliveryBetween(
      ctx.zones,
      week.start.toISOString().slice(0, 10),
      week.end.toISOString().slice(0, 10),
    ),
  }
}

/**
 * The URL's `from`–`to`, or null when `from` is missing or malformed or `to` is
 * before it. `from` alone is that one day.
 */
export function rangeOf(
  ctx: Pick<ViewContext, 'from' | 'to'>,
): { from: string; to: string } | null {
  if (!isIsoDate(ctx.from)) return null
  const to = ctx.to === undefined || ctx.to === '' ? ctx.from : ctx.to
  if (!isIsoDate(to) || to < ctx.from) return null
  return { from: ctx.from, to }
}

/**
 * The first pickup is in the URL's range. Archive and cancelled loads stay in:
 * "what picked up in March" is a question about the archive too.
 */
export function pickupRangeWhere(ctx: ViewContext): Prisma.LoadWhereInput {
  const range = rangeOf(ctx)
  if (range === null) return {}
  return {
    deletedAt: null,
    ...firstPickupBetween(ctx.zones, range.from, range.to),
  }
}

/** The final delivery is in the URL's range, archive included. */
export function deliveryRangeWhere(ctx: ViewContext): Prisma.LoadWhereInput {
  const range = rangeOf(ctx)
  if (range === null) return {}
  return {
    deletedAt: null,
    ...finalDeliveryBetween(ctx.zones, range.from, range.to),
  }
}

/**
 * Booked, and the first pickup is between today and seven days from today,
 * both inclusive. A booked load whose pickup has passed is late, not upcoming.
 */
export function upcomingWhere(ctx: ViewContext): Prisma.LoadWhereInput {
  return {
    ...QUEUE,
    operationalStatus: 'BOOKED',
    ...NOT_CLOSED_HISTORY,
    ...firstPickupBetween(ctx.zones, ctx.today, addDays(ctx.today, 7)),
  }
}

/**
 * The billing states that are still owed. AN INCLUDE-LIST: `WRITTEN_OFF` and
 * closed history are decisions, not debts, and a state added later stays out
 * until somebody decides it is a debt.
 */
export const UNPAID_BILLING = [
  'UNINVOICED',
  'READY_TO_INVOICE',
  'INVOICED',
  'PARTIALLY_PAID',
  'DISPUTED',
] as const satisfies readonly LoadBillingStatus[]

/** Delivered or POD in, and not paid. */
export function unpaidWhere(): Prisma.LoadWhereInput {
  return {
    ...QUEUE,
    operationalStatus: { in: ['DELIVERED', 'POD_RECEIVED'] },
    billingStatus: { in: [...UNPAID_BILLING] },
  }
}

/**
 * Every named view, by the name that appears in `?view=`.
 *
 * THE KEYS ARE THE DASHBOARD ROW KEYS, deliberately: the row's href is its own
 * name, so a reader comparing `dash.action.podMissing` to `?view=podMissing`
 * sees one word. A separate URL vocabulary would be a second name for one set,
 * which is the thing this module exists to stop.
 *
 * Every entry takes the request's `ViewContext`; the five undated ones ignore it.
 */
export const LOAD_VIEWS = {
  podMissing: podMissingWhere,
  noRate: noRateWhere,
  unassignedFinished: unassignedFinishedWhere,
  unassigned: unassignedWhere,
  readyToInvoice: readyToInvoiceWhere,
  picksUpToday: picksUpTodayWhere,
  deliversThisWeek: deliversThisWeekWhere,
  pickup: pickupRangeWhere,
  delivery: deliveryRangeWhere,
  upcoming: upcomingWhere,
  unpaid: unpaidWhere,
} satisfies Record<string, (ctx: ViewContext) => Prisma.LoadWhereInput>

export type LoadViewName = keyof typeof LOAD_VIEWS

export function isLoadViewName(value: string): value is LoadViewName {
  return Object.hasOwn(LOAD_VIEWS, value)
}

/**
 * The predicate for a `?view=` parameter, or `{}` for anything else.
 *
 * AN UNKNOWN NAME NARROWS NOTHING rather than matching nothing. A typo'd view
 * that returned an impossible predicate would render an empty list, which reads
 * as "no loads are in this state" — a confident answer to a question nobody
 * asked. An unfiltered list is obviously not what was meant.
 */
export function viewWhere(
  value: string | undefined,
  ctx: ViewContext,
): Prisma.LoadWhereInput {
  if (value === undefined || !isLoadViewName(value)) return {}
  return LOAD_VIEWS[value](ctx)
}
