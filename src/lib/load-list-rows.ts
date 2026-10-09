import type {
  LoadBillingStatus,
  LoadOperationalStatus,
  Prisma,
} from '@/generated/prisma/client'
import { loadWarningFacts, loadWarnings, type Warning } from './warnings'
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
