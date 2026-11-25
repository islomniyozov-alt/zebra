import type { Truck } from '@/generated/prisma/client'
import { truckOverrideOf } from './truck-list'

// ---------------------------------------------------------------------------
// THE TRUCK RECORD'S FORM, ONE READER FOR EVERY FIELD IT SHOWS (TMS v11.36
// §6.5 part 2, owner 2026-11-19).
//
// Owner name, fleet status, fuel type, axles and gross weight were on the
// edit form and written by Save, but the page built the form's values by hand
// and left those five out — so the record reloaded blank and the next Save
// wrote the blanks over what was stored. The values now come from here, and
// `tests/truck-form.test.ts` holds that every field the form offers has one.
//
// THE TWO TABS. Main carries identity on the left and status on the right;
// Details carries the five item-12 facts. Each tab posts only its own fields,
// and `updateTruck` leaves a field it was not sent as it is.
// ---------------------------------------------------------------------------

/** Main, left: what the truck IS. */
export const TRUCK_IDENTITY_FIELDS = [
  'unitNumber',
  'vin',
  'plate',
  'plateState',
  'make',
  'model',
  'year',
] as const

/** Main, right: where it stands. */
export const TRUCK_STATUS_FIELDS = ['status', 'ownershipType', 'notes'] as const

/**
 * Details: the odometer and the item-12 facts — what Add truck does not ask
 * (§6.5 part 3, v11.54, which moved the odometer here from Main).
 */
export const TRUCK_DETAIL_FIELDS = [
  'currentOdometer',
  'fuelType',
  'fleetStatus',
  'ownerName',
  'lessorName',
  'grossWeightLbs',
  'axles',
] as const

/** Every field the edit form offers, across both tabs. */
export const TRUCK_FORM_FIELDS = [
  ...TRUCK_IDENTITY_FIELDS,
  ...TRUCK_STATUS_FIELDS,
  ...TRUCK_DETAIL_FIELDS,
] as const

export type TruckFormField = (typeof TRUCK_FORM_FIELDS)[number]

export type TruckFormRow = Pick<
  Truck,
  | 'unitNumber'
  | 'vin'
  | 'plate'
  | 'plateState'
  | 'make'
  | 'model'
  | 'year'
  | 'status'
  | 'ownershipType'
  | 'currentOdometer'
  | 'notes'
  | 'fuelType'
  | 'fleetStatus'
  | 'ownerName'
  | 'lessorName'
  | 'grossWeightLbs'
  | 'axles'
>

const text = (value: string | null) => value ?? ''
const whole = (value: number | null) => (value === null ? '' : String(value))

/** The stored truck as the form's values — every field, both tabs. */
export function truckFormValues(
  truck: TruckFormRow,
): Record<TruckFormField, string> {
  return {
    unitNumber: truck.unitNumber,
    vin: text(truck.vin),
    plate: text(truck.plate),
    plateState: text(truck.plateState),
    make: text(truck.make),
    model: text(truck.model),
    year: whole(truck.year),
    // Round two (§6.5 part 1): Automatic and the three overrides, so a
    // stored DISPATCHED or IN_TRANSIT reads as Automatic (AVAILABLE).
    status: truckOverrideOf(truck.status) ?? 'AVAILABLE',
    ownershipType: truck.ownershipType,
    currentOdometer: whole(truck.currentOdometer),
    notes: text(truck.notes),
    fuelType: text(truck.fuelType),
    fleetStatus: text(truck.fleetStatus),
    ownerName: text(truck.ownerName),
    lessorName: text(truck.lessorName),
    grossWeightLbs: whole(truck.grossWeightLbs),
    axles: whole(truck.axles),
  }
}
