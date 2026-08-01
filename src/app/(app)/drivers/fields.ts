import type { FieldSpec } from '@/components/forms/RecordForm'
import type { SelectOption } from '@/components/ui/Select'
import type { MessageKey, Translate } from '@/lib/i18n'
import type { DriverStatus } from '@/generated/prisma/client'
import { OWNERSHIP_TYPES, ownershipKey } from '../trucks/fields'

export const DRIVER_STATUSES: DriverStatus[] = [
  'AVAILABLE',
  'DISPATCHED',
  'ON_ROUTE',
  'OFF_DUTY',
  'VACATION',
  'INACTIVE',
]

export const driverStatusKey = (status: DriverStatus): MessageKey =>
  `drivers.status.${status}` as MessageKey

// A driver has no unique index — two people genuinely can share a name, and a
// CDL number is not always known on the day of hire. Nothing here pretends
// otherwise by making a field required that the business does not require.

export function driverFields(
  t: Translate,
  authorities: readonly SelectOption[],
  mode: 'create' | 'edit',
  /**
   * Every truck the user may see, labelled with its authority.
   *
   * NOT pre-filtered to the chosen authority. On create the authority is a
   * field in this same form, so filtering would mean either client-side
   * javascript keeping two selects in step, or a list that is wrong until the
   * form is submitted once. Showing all of them and refusing the mismatch in
   * words is the honest version, and the label already says which authority
   * each truck runs under — see `pairedTruck` in src/lib/fleet.ts.
   */
  trucks: readonly SelectOption[] = [],
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
      name: 'firstName',
      label: t('drivers.firstName'),
      required: true,
      autoFocus: authorityField.length === 0,
    },
    {
      kind: 'text',
      name: 'lastName',
      label: t('drivers.lastName'),
      required: true,
    },
    { kind: 'tel', name: 'phone', label: t('drivers.phone') },
    { kind: 'email', name: 'email', label: t('drivers.email') },
    {
      kind: 'text',
      name: 'cdlNumber',
      label: t('drivers.cdlNumber'),
      mono: true,
    },
    { kind: 'text', name: 'cdlState', label: t('drivers.cdlState') },
    { kind: 'text', name: 'cdlClass', label: t('drivers.cdlClass') },
    { kind: 'date', name: 'hireDate', label: t('drivers.hireDate') },
    {
      kind: 'select',
      name: 'status',
      label: t('ref.status'),
      options: DRIVER_STATUSES.map((status) => ({
        value: status,
        label: t(driverStatusKey(status)),
      })),
    },
    {
      kind: 'select',
      name: 'employmentType',
      label: t('drivers.employment'),
      options: OWNERSHIP_TYPES.map((type) => ({
        value: type,
        label: t(ownershipKey(type)),
      })),
    },
    {
      kind: 'select',
      name: 'assignedTruckId',
      label: t('drivers.assignedTruck'),
      hint: t('drivers.assignedTruckHint'),
      options: [
        { value: '', label: t('drivers.assignedTruckNone') },
        ...trucks,
      ],
    },
    { kind: 'textarea', name: 'notes', label: t('ref.notes') },
  ]
}
