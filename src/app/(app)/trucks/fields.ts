import type { FieldSpec } from '@/components/forms/RecordForm'
import type { SelectOption } from '@/components/ui/Select'
import type { Translate } from '@/lib/i18n'
import type { MessageKey } from '@/lib/i18n'
import type { OwnershipType, TruckStatus } from '@/generated/prisma/client'
import { FLEET_STATUSES, FUEL_TYPES } from '@/lib/fleet-codes'
import { TRUCK_OVERRIDES } from '@/lib/truck-list'

/**
 * What the form offers (§6.5 part 1 round two): Automatic — stored as
 * `AVAILABLE`, derived from the open loads — and the three manual overrides.
 * `DISPATCHED` and `IN_TRANSIT` are derived values now and nothing writes them.
 */
export const TRUCK_STATUS_OPTIONS: TruckStatus[] = [
  'AVAILABLE',
  ...TRUCK_OVERRIDES,
]

/**
 * The enum's six, for the TRAILERS form, which keeps the stored word: a
 * trailer carries no loads of its own to derive from. Not the trucks form's.
 */
export const TRUCK_STATUSES: TruckStatus[] = [
  'AVAILABLE',
  'DISPATCHED',
  'IN_TRANSIT',
  'MAINTENANCE',
  'OUT_OF_SERVICE',
  'SOLD',
]

export const OWNERSHIP_TYPES: OwnershipType[] = [
  'OWNED',
  'LEASED',
  'OWNER_OPERATOR',
]

/**
 * The label for a `TruckStatus`.
 *
 * RENAMED FROM `truckStatusKey` BY ITEM 12, which introduced a column
 * actually called `fleetStatus` meaning something else. Two names one
 * letter apart for two different axes is how a screen ends up showing the
 * wrong one, and the compiler cannot catch it because both are strings.
 */
export const truckStatusKey = (status: TruckStatus): MessageKey =>
  `fleet.status.${status}` as MessageKey

export const ownershipKey = (type: OwnershipType): MessageKey =>
  `fleet.ownership.${type}` as MessageKey

/**
 * §6.3 as amended: the operating authority is the FIRST field of a creation
 * form, defaulting to last-used. It is not an ambient mode decided earlier and
 * elsewhere — a truck entered under the wrong MC number is exactly the outcome
 * that section exists to prevent.
 *
 * On EDIT the authority is absent, not disabled: moving an asset between
 * authorities is a transfer that writes a period, and a select that silently
 * did it would destroy the history the transfer exists to keep.
 */
export function truckFields(
  t: Translate,
  authorities: readonly SelectOption[],
  mode: 'create' | 'edit',
): FieldSpec[] {
  const authorityField: FieldSpec[] =
    mode === 'create' && authorities.length > 0
      ? [
          {
            kind: 'select',
            name: 'companyId',
            label: t('ref.authority'),
            options: authorities,
            required: true,
            autoFocus: true,
          },
        ]
      : []

  return [
    ...authorityField,
    {
      kind: 'text',
      name: 'unitNumber',
      label: t('fleet.unitNumber'),
      required: true,
      mono: true,
      autoFocus: authorityField.length === 0,
    },
    { kind: 'text', name: 'make', label: t('trucks.make') },
    { kind: 'text', name: 'model', label: t('trucks.model') },
    { kind: 'number', name: 'year', label: t('fleet.year') },
    { kind: 'text', name: 'vin', label: t('fleet.vin'), mono: true },
    { kind: 'text', name: 'plate', label: t('fleet.plate'), mono: true },
    { kind: 'text', name: 'plateState', label: t('fleet.plateState') },
    {
      kind: 'number',
      name: 'currentOdometer',
      label: t('trucks.odometer'),
    },
    // ── ITEM 12, ALL OPTIONAL ───────────────────────────────────────
    //
    // A SECOND AXIS BESIDE `status`, which is the field below this one.
    // That one says where the freight has the unit; this says whether the
    // unit is fit to run. The blank option is first and is the default,
    // because a truck nobody has classified is the normal state of a yard
    // and a form that made somebody choose would fill the column with
    // guesses.
    {
      kind: 'select',
      name: 'fleetStatus',
      label: t('trucks.fleetStatus'),
      options: [
        { value: '', label: '—' },
        ...FLEET_STATUSES.map((value) => ({ value, label: value })),
      ],
    },
    {
      kind: 'select',
      name: 'fuelType',
      label: t('trucks.fuelType'),
      options: [
        { value: '', label: '—' },
        ...FUEL_TYPES.map((value) => ({ value, label: value })),
      ],
    },
    {
      kind: 'text',
      name: 'ownerName',
      label: t('trucks.ownerName'),
      hint: t('trucks.ownerNameHint'),
    },
    { kind: 'number', name: 'axles', label: t('trucks.axles') },
    {
      kind: 'number',
      name: 'grossWeightLbs',
      label: t('trucks.grossWeight'),
    },
    {
      kind: 'select',
      name: 'status',
      label: t('ref.status'),
      // ROUND TWO (§6.5 part 1): the stored column keeps only the manual
      // overrides. Automatic is stored as AVAILABLE and means "derive from
      // the open loads"; Dispatched and In transit are no longer words a
      // person types, because they were never true for longer than a day.
      options: TRUCK_STATUS_OPTIONS.map((status) => ({
        value: status,
        label:
          status === 'AVAILABLE'
            ? t('fleet.status.automatic')
            : t(truckStatusKey(status)),
      })),
    },
    {
      kind: 'select',
      name: 'ownershipType',
      label: t('fleet.ownership'),
      options: OWNERSHIP_TYPES.map((type) => ({
        value: type,
        label: t(ownershipKey(type)),
      })),
    },
    { kind: 'textarea', name: 'notes', label: t('ref.notes') },
  ]
}
