import {
  Prisma,
  type LoadBillingStatus,
  type LoadOperationalStatus,
} from '@/generated/prisma/client'
import {
  loadWarningFacts,
  loadWarnings,
  type LoadFacts,
  type Warning,
} from './warnings'
import { asDate } from './sql-json'
import { renderStopTime, stopLocalDate } from './stop-time'
import type { TxClient } from './tenancy'

// ---------------------------------------------------------------------------
// THE LOADS LIST'S ROWS, READ ONCE FOR THE PAGE AND THE EXPORT
// (TMS-DESIGN-SYSTEM.md §6.7 item 7).
//
// The page formats these for a person and the export writes them as codes, but
// both read the SAME rows through this function, so a load can never be
// described one way on screen and another way in the file that claims to be
// that screen.
// ---------------------------------------------------------------------------

export interface LoadListStop {
  type: 'PICKUP' | 'DELIVERY' | 'INTERMEDIATE'
  place: string
  /** The appointment in the stop's own zone (§8, rule 3), or null. */
  when: string | null
}

export interface LoadListRow {
  id: string
  loadNumber: string
  reference: string | null
  companyName: string
  customerId: string
  customerName: string
  /** Both seats when there are two, primary first. */
  drivers: { id: string; name: string }[]
  pickup: string
  delivery: string
  /** The final delivery's local date, `YYYY-MM-DD`, or null. */
  deliveryDay: string | null
  truckId: string | null
  truck: string | null
  operationalStatus: LoadOperationalStatus
  billingStatus: LoadBillingStatus
  linehaulCents: number
  isCancelled: boolean
  directSettled: boolean
  warnings: Warning[]
  /** Every stop in order, for the row's expand (§6.7 item 8). */
  stops: LoadListStop[]
}

/**
 * CITY AND STATE FIRST, THE STOP'S OWN NAME WHEN IT HAS NEITHER.
 *
 * The Relay board export carries no addresses at all — it names facilities and
 * clocks — so its stops land with `name` set to the facility code and
 * `city`/`state` null. The load detail has always fallen back to `stop.name`,
 * and a list that printed blank for the same stop was two screens disagreeing
 * about one row. An ABSENT stop is an em dash; a stop with nothing to print is
 * its name.
 */
export function stopPlace(
  stop:
    | { name: string | null; city: string | null; state: string | null }
    | undefined,
): string {
  if (!stop) return '—'
  const address = [stop.city, stop.state].filter(Boolean).join(', ')
  return address || stop.name || '—'
}

/**
 * The rows under `where`, newest booking first.
 *
 * ONE QUERY FOR THE ROWS AND ONE FOR THE WARNINGS, whatever the page size: a
 * fan-out here would be a round trip per row on the screen a dispatcher reloads
 * all morning.
 */
export async function readLoadRows(
  tx: TxClient,
  where: Prisma.LoadWhereInput,
  options: { skip?: number; take?: number; now: Date; locale: string },
): Promise<LoadListRow[]> {
  const loads = await tx.load.findMany({
    where,
    orderBy: { bookedAt: 'desc' },
    ...(options.skip !== undefined ? { skip: options.skip } : {}),
    ...(options.take !== undefined ? { take: options.take } : {}),
    select: {
      id: true,
      loadNumber: true,
      referenceNumber: true,
      isCancelled: true,
      directSettled: true,
      operationalStatus: true,
      billingStatus: true,
      // §7 — a field a role cannot see is absent from the payload, never
      // hidden in CSS. Rate is here because `read load` implies the board;
      // margin and driver pay are separate resources and are not selected.
      linehaulCents: true,
      // The zone dates a stop that has no state (`renderStopTime`).
      company: { select: { name: true, timezone: true } },
      customer: { select: { id: true, name: true } },
      driver: { select: { id: true, firstName: true, lastName: true } },
      coDriver: { select: { id: true, firstName: true, lastName: true } },
      truck: { select: { id: true, unitNumber: true } },
      stops: {
        orderBy: { sequence: 'asc' },
        select: {
          type: true,
          name: true,
          city: true,
          state: true,
          scheduledAt: true,
          windowStart: true,
        },
      },
    },
  })

  const warningFacts = await loadWarningFacts(
    tx,
    loads.map((load) => load.id),
  )
  return loadRowsFrom(loads, warningFacts, options)
}

/** One load as the list reads it — the shape both spellings return. */
export interface LoadRowSource {
  id: string
  loadNumber: string
  referenceNumber: string | null
  isCancelled: boolean
  directSettled: boolean
  operationalStatus: LoadOperationalStatus
  billingStatus: LoadBillingStatus
  linehaulCents: number
  company: { name: string; timezone: string }
  customer: { id: string; name: string }
  driver: { id: string; firstName: string; lastName: string } | null
  coDriver: { id: string; firstName: string; lastName: string } | null
  truck: { id: string; unitNumber: string } | null
  stops: {
    type: LoadListStop['type']
    name: string | null
    city: string | null
    state: string | null
    scheduledAt: Date | null
    windowStart: Date | null
  }[]
}

/** The rows as the page and the export take them — pure. */
export function loadRowsFrom(
  loads: readonly LoadRowSource[],
  warningFacts: ReadonlyMap<string, LoadFacts>,
  options: { now: Date; locale: string },
): LoadListRow[] {
  return loads.map((load) => {
    const zone = load.company.timezone
    const finalDelivery = [...load.stops]
      .reverse()
      .find((stop) => stop.type === 'DELIVERY')
    return {
      id: load.id,
      loadNumber: load.loadNumber,
      reference: load.referenceNumber,
      companyName: load.company.name,
      customerId: load.customer.id,
      customerName: load.customer.name,
      drivers: [load.driver, load.coDriver]
        .filter((seat) => seat !== null)
        .map((seat) => ({
          id: seat.id,
          name: `${seat.firstName} ${seat.lastName}`.trim(),
        })),
      pickup: stopPlace(load.stops.find((stop) => stop.type === 'PICKUP')),
      delivery: stopPlace(finalDelivery),
      // THE DAY THE DATE VIEWS READ: the stop's own local date, so a row never
      // sits in a view its own DEL date contradicts.
      deliveryDay: finalDelivery
        ? stopLocalDate(
            finalDelivery.scheduledAt ?? finalDelivery.windowStart,
            finalDelivery.state,
            zone,
          )
        : null,
      truckId: load.truck?.id ?? null,
      truck: load.truck?.unitNumber ?? null,
      operationalStatus: load.operationalStatus,
      billingStatus: load.billingStatus,
      linehaulCents: load.linehaulCents,
      isCancelled: load.isCancelled,
      directSettled: load.directSettled,
      warnings: warningFacts.has(load.id)
        ? loadWarnings(warningFacts.get(load.id)!, options.now)
        : [],
      stops: load.stops.map((stop) => ({
        type: stop.type,
        place: stopPlace(stop),
        when:
          renderStopTime(stop.scheduledAt ?? stop.windowStart, stop.state, {
            fallbackZone: zone,
            locale: options.locale,
          })?.text ?? null,
      })),
    }
  })
}

// ---------------------------------------------------------------------------
// THE ROWS AS SQL, for the list's one call (§6.7 v11.10). A SECOND SPELLING of
// `readLoadRows`' `load.findMany` — its select, newest booking first, the page's
// skip and take — under a `where` already in SQL (`loadListRowsWhereSql`).
// `tests/integration/load-list-body.test.ts` holds `loadRowSourcesFrom` of
// this equal to the `findMany`, row for row and filter by filter. Ties on
// `bookedAt` are broken by id here, where `findMany` states no order.
// ---------------------------------------------------------------------------

export function loadRowsSql(
  where: Prisma.Sql,
  page: { skip: number; take: number },
): Prisma.Sql {
  return Prisma.sql`
    SELECT l.id, l."loadNumber", l."referenceNumber", l."isCancelled",
           l."directSettled", l."operationalStatus"::text AS "operationalStatus",
           l."billingStatus"::text AS "billingStatus", l."linehaulCents",
           l."bookedAt",
           c.name AS company_name, c.timezone AS company_timezone,
           cu.id AS customer_id, cu.name AS customer_name,
           (SELECT json_build_object('id', d.id, 'firstName', d."firstName",
                     'lastName', d."lastName")
              FROM "Driver" d WHERE d.id = l."driverId") AS driver,
           (SELECT json_build_object('id', d.id, 'firstName', d."firstName",
                     'lastName', d."lastName")
              FROM "Driver" d WHERE d.id = l."coDriverId") AS co_driver,
           (SELECT json_build_object('id', t.id, 'unitNumber', t."unitNumber")
              FROM "Truck" t WHERE t.id = l."truckId") AS truck,
           (SELECT COALESCE(json_agg(json_build_object(
                     'type', st.type::text, 'name', st.name, 'city', st.city,
                     'state', st.state, 'scheduledAt', st."scheduledAt",
                     'windowStart', st."windowStart") ORDER BY st.sequence),
                   '[]'::json)
              FROM "LoadStop" st WHERE st."loadId" = l.id) AS stops
      FROM "Load" l
      JOIN "Company" c ON c."id" = l."companyId"
      JOIN "Customer" cu ON cu.id = l."customerId"
     WHERE ${where}
     ORDER BY l."bookedAt" DESC, l.id
     OFFSET ${page.skip} LIMIT ${page.take}`
}

type Stamp = string | Date
type Seat = { id: string; firstName: string; lastName: string }

export interface LoadRowSqlRow {
  id: string
  loadNumber: string
  referenceNumber: string | null
  isCancelled: boolean
  directSettled: boolean
  operationalStatus: string
  billingStatus: string
  linehaulCents: number
  company_name: string
  company_timezone: string
  customer_id: string
  customer_name: string
  driver: Seat | null
  co_driver: Seat | null
  truck: { id: string; unitNumber: string } | null
  stops: {
    type: string
    name: string | null
    city: string | null
    state: string | null
    scheduledAt: Stamp | null
    windowStart: Stamp | null
  }[]
}

/** `loadRowsSql`'s rows as `loadRowsFrom` takes them, from either transport. */
export function loadRowSourcesFrom(
  rows: readonly LoadRowSqlRow[],
): LoadRowSource[] {
  return rows.map((row) => ({
    id: row.id,
    loadNumber: row.loadNumber,
    referenceNumber: row.referenceNumber,
    isCancelled: row.isCancelled,
    directSettled: row.directSettled,
    operationalStatus: row.operationalStatus as LoadOperationalStatus,
    billingStatus: row.billingStatus as LoadBillingStatus,
    linehaulCents: row.linehaulCents,
    company: { name: row.company_name, timezone: row.company_timezone },
    customer: { id: row.customer_id, name: row.customer_name },
    driver: row.driver,
    coDriver: row.co_driver,
    truck: row.truck,
    stops: row.stops.map((stop) => ({
      type: stop.type as LoadListStop['type'],
      name: stop.name,
      city: stop.city,
      state: stop.state,
      scheduledAt: asDate(stop.scheduledAt),
      windowStart: asDate(stop.windowStart),
    })),
  }))
}
