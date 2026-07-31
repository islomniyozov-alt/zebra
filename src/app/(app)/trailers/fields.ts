import type { FieldSpec } from '@/components/forms/RecordForm'
import type { SelectOption } from '@/components/ui/Select'
import type { Translate } from '@/lib/i18n'
import {
  OWNERSHIP_TYPES,
  TRUCK_STATUSES,
  fleetStatusKey,
  ownershipKey,
} from '../trucks/fields'

// Trailers share the truck status and ownership vocabularies deliberately —
// they are the same facts about a different piece of steel, and a second set
// of enums would be a second place to keep in step.

export function trailerFields(
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
    {
      kind: 'text',
      name: 'type',
      label: t('trailers.type'),
      hint: t('trailers.typeHint'),
    },
    { kind: 'number', name: 'year', label: t('fleet.year') },
    { kind: 'text', name: 'vin', label: t('fleet.vin'), mono: true },
    { kind: 'text', name: 'plate', label: t('fleet.plate'), mono: true },
    { kind: 'text', name: 'plateState', label: t('fleet.plateState') },
    {
      kind: 'select',
      name: 'status',
      label: t('ref.status'),
      options: TRUCK_STATUSES.map((status) => ({
        value: status,
        label: t(fleetStatusKey(status)),
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
