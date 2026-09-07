import type { FieldSpec } from '@/components/forms/RecordForm'
import type { SelectOption } from '@/components/ui/Select'
import type { MessageKey, Translate } from '@/lib/i18n'
import type { DriverStatus, OwnershipType } from '@/generated/prisma/client'
import { OWNERSHIP_TYPES } from '../trucks/fields'

// A DRIVER IS NOT OWNED. The enum is shared with trucks and trailers, where
// `OWNED` is the plain truth about a vehicle; on a person it read as
// "Employment: Owned", which is what Daler stopped on. Same three values, said
// the way the industry says them about people: a company driver, a lease
// operator, an owner-operator.
const employmentKey = (type: OwnershipType): MessageKey =>
  `drivers.employment.${type}` as MessageKey

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
    // ── THE ADDRESS, PREFILLED FROM THE LICENCE AND ALWAYS EDITABLE ───────
    //
    // THE HINT IS NOT DECORATION. A licence address is frequently the one the
    // driver had two moves ago — nothing forces a reissue until the card
    // expires — and the person most likely to paste it into a 1099 is the
    // person looking at this form. It says so at the point of use rather than
    // only in a comment nobody reading the screen will ever see.
    {
      kind: 'text',
      name: 'addressLine1',
      label: t('drivers.addressLine1'),
      hint: t('drivers.addressHint'),
    },
    { kind: 'text', name: 'addressCity', label: t('drivers.addressCity') },
    { kind: 'text', name: 'addressState', label: t('drivers.addressState') },
    {
      kind: 'text',
      name: 'addressPostalCode',
      label: t('drivers.addressPostalCode'),
    },
    {
      kind: 'text',
      name: 'cdlNumber',
      label: t('drivers.cdlNumber'),
      mono: true,
    },
    { kind: 'text', name: 'cdlState', label: t('drivers.cdlState') },
    { kind: 'text', name: 'cdlClass', label: t('drivers.cdlClass') },
    // EXPIRY IS ON THE FORM AND NOT ON THE DRIVER. It writes a ComplianceItem,
    // which is the table the Phase 4 alerting already watches — a
    // `Driver.cdlExpiresAt` column beside it would be a second copy of the same
    // date, free to disagree with the one that raises the warning.
    {
      kind: 'date',
      name: 'cdlExpiresAt',
      label: t('drivers.cdlExpires'),
      hint: t('drivers.cdlExpiresHint'),
    },
    {
      kind: 'select',
      name: 'employmentType',
      label: t('drivers.employment'),
      options: OWNERSHIP_TYPES.map((type) => ({
        value: type,
        label: t(employmentKey(type)),
      })),
    },
    // THE PAY PERCENTAGE, ON CREATE ONLY — the field whose absence Daler named
    // first, because it is the one that decides whether the driver can be paid
    // at all. A driver with no DriverPayRule generates an empty settlement.
    //
    // CREATE ONLY, because after that the driver detail screen owns pay: rules
    // are dated, supersede one another and are frozen onto settlements, and a
    // plain field on an edit form would silently rewrite history. See
    // `savePayRuleAction`.
    ...(mode === 'create'
      ? ([
          {
            kind: 'text',
            name: 'payPercent',
            label: t('drivers.payPercent'),
            hint: t('drivers.payPercentHint'),
          },
        ] as FieldSpec[])
      : []),
    // ── EVERYTHING BELOW IS EDIT-ONLY ────────────────────────────────────
    //
    // Thirteen fields on a create form was the complaint. These four are all
    // things a driver acquires rather than arrives with, and every one has a
    // sensible default or a screen of its own:
    //
    //   status        — defaults AVAILABLE, and a driver being hired IS
    //   hireDate        available; both are corrections rather than facts
    //                   somebody types at the moment of hiring
    //   assignedTruck — read "No truck" because no trucks are seeded, which is
    //                   a field advertising an empty table. Assignment is its
    //                   own action with its own conflict rules.
    //   notes         — never the reason a driver could not be created
    ...(mode === 'edit'
      ? ([
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
            name: 'assignedTruckId',
            label: t('drivers.assignedTruck'),
            hint: t('drivers.assignedTruckHint'),
            options: [
              { value: '', label: t('drivers.assignedTruckNone') },
              ...trucks,
            ],
          },
          { kind: 'textarea', name: 'notes', label: t('ref.notes') },
        ] as FieldSpec[])
      : []),
  ]
}
