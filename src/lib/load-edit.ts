import { createLoad, updateLoad, type StopInput } from './loads'
import { resolveBroker, resolveLocation } from './locations'
import {
  editedStops,
  plannedStop,
  stopDate,
  stopMoment,
  type FormStop,
  type StoredStop,
} from './load-form'
import { ReferenceError } from './reference'
import type { TxClient } from './tenancy'

// ---------------------------------------------------------------------------
// EDIT LOAD AND DUPLICATE LOAD (TMS §7.14 part 7, v11.60).
//
// Each is ONE function an action calls (AGENTS.md: domain logic lives in
// src/lib/). Both write through the load's own writers, `updateLoad` and
// `createLoad`, so an edit is refused, conflict-checked and dispatched
// exactly as the assignment panel's save is, and a copy is booked exactly as
// Add load books one: number allocated, Booked, the opening status event.
// ---------------------------------------------------------------------------

/** The columns of a stop the edit and the duplicate read. */
export const STORED_STOP_SELECT = {
  id: true,
  type: true,
  locationId: true,
  name: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  postalCode: true,
  appointmentType: true,
  scheduledAt: true,
  windowStart: true,
  windowEnd: true,
  arrivedAt: true,
  departedAt: true,
  legMiles: true,
  legEmpty: true,
  referenceNumber: true,
  contactName: true,
  contactPhone: true,
  instructions: true,
  location: { select: { timezone: true, state: true } },
} as const

/** What the edit form posted, read by the action and nothing more. */
export interface LoadEditInput {
  broker: string
  truckId: string | null
  driverId: string | null
  stops: FormStop[]
  bolNumber: string | null
  poNumber: string | null
  referenceNumber: string | null
  miles: string | null
  /** Absent for a role that may not set a rate: the column is not touched. */
  linehaulCents?: number
}

/**
 * Did the edit leave every stop exactly as stored, in the same order?
 *
 * Then the stops are not rewritten at all. `writeStops` replaces the rows,
 * so a save that only fixed a PO would otherwise mint new stop ids and put
 * a stop rewrite in the audit trail that nobody made.
 */
function stopsUnchanged(
  edited: ReturnType<typeof editedStops>,
  stored: readonly StoredStop[],
): boolean {
  if (edited.length !== stored.length) return false
  return edited.every((stop, index) => {
    if (stop.kind !== 'kept') return false
    const was = stored[index]!
    const at = (value: Date | null | undefined) => value?.getTime() ?? null
    return (
      stop.input.locationId === was.locationId &&
      stop.input.type === was.type &&
      at(stop.input.scheduledAt) === at(was.scheduledAt) &&
      at(stop.input.windowStart) === at(was.windowStart) &&
      at(stop.input.windowEnd) === at(was.windowEnd)
    )
  })
}

/**
 * Save Edit load.
 *
 * Every stop needs a place, as on Add load; the error names the first empty
 * row. A kept stop keeps everything it carries (`editedStops`); a moved one
 * resolves its place as Add load does. The authority is not in the input:
 * `updateLoad` refuses to move a load between number series.
 */
export async function saveLoadEdit(
  tx: TxClient,
  organizationId: string,
  loadId: string,
  input: LoadEditInput,
  options: { byUserId: string | null },
) {
  const emptyAt = input.stops.findIndex((stop) => stop.place === '')
  if (input.stops.length < 2 || emptyAt !== -1) {
    throw new ReferenceError('required', {
      field: `stops[${emptyAt === -1 ? input.stops.length : emptyAt}].place`,
    })
  }

  const current = await tx.load.findUnique({
    where: { id: loadId },
    select: {
      customer: { select: { id: true, name: true } },
      stops: { orderBy: { sequence: 'asc' }, select: STORED_STOP_SELECT },
    },
  })
  if (!current) throw new ReferenceError('not_found')
  const stored = current.stops
  // THE CUSTOMER IT ALREADY HAS, when the name came back as shown. Resolving
  // the name again could land on a different customer of the same name and
  // move the load's billing to them without anybody choosing it.
  const customerId =
    input.broker.trim().toLowerCase() ===
    current.customer.name.trim().toLowerCase()
      ? current.customer.id
      : await resolveBroker(tx, organizationId, input.broker)

  const edited = editedStops(input.stops, stored)
  let stops: StopInput[] | undefined
  if (!stopsUnchanged(edited, stored)) {
    stops = []
    for (const stop of edited) {
      if (stop.kind === 'kept') {
        stops.push(stop.input)
        continue
      }
      const { posted } = stop
      const place = await resolveLocation(tx, organizationId, posted.place)
      stops.push({
        type: posted.type,
        locationId: place.locationId,
        name: posted.place,
        city: place.city,
        state: place.state,
        scheduledAt: stopDate(posted.date, place, posted.from),
        windowStart: stopMoment(posted.date, posted.from, place),
        windowEnd: stopMoment(posted.date, posted.to, place),
      })
    }
  }

  return updateLoad(
    tx,
    loadId,
    {
      customerId,
      truckId: input.truckId,
      driverId: input.driverId,
      bolNumber: input.bolNumber,
      poNumber: input.poNumber,
      referenceNumber: input.referenceNumber,
      dispatchedMiles: input.miles ?? '',
      ...(input.linehaulCents === undefined
        ? {}
        : { linehaulCents: input.linehaulCents }),
      ...(stops ? { stops } : {}),
    },
    options,
  )
}

/**
 * Duplicate load: a new load from this one's commercial facts.
 *
 * Same authority, customer, planned stops (`plannedStop`), line haul and fuel
 * surcharge, broker reference, BOL and PO, payment type, equipment,
 * commodity, weight and miles. `createLoad` gives it a new number and starts
 * it Booked; no truck, driver or trailer is passed, no document or
 * accessorial line is copied. A blocked customer is refused there, as on Add
 * load.
 */
export async function duplicateLoad(
  tx: TxClient,
  organizationId: string,
  loadId: string,
  options: { byUserId: string | null },
) {
  const load = await tx.load.findUnique({
    where: { id: loadId },
    include: {
      stops: { orderBy: { sequence: 'asc' }, select: STORED_STOP_SELECT },
    },
  })
  if (!load) throw new ReferenceError('not_found')

  const text = (value: number | null) => (value === null ? null : String(value))
  return createLoad(
    tx,
    organizationId,
    {
      companyId: load.companyId,
      customerId: load.customerId,
      referenceNumber: load.referenceNumber,
      bolNumber: load.bolNumber,
      poNumber: load.poNumber,
      paymentType: load.paymentType,
      equipmentType: load.equipmentType,
      commodity: load.commodity,
      weightLbs: text(load.weightLbs),
      dispatchedMiles: text(load.dispatchedMiles),
      linehaulCents: load.linehaulCents,
      fuelSurchargeCents: load.fuelSurchargeCents,
      stops: load.stops.map(plannedStop),
    },
    options,
  )
}
