import type { FieldSpec } from '@/components/forms/RecordForm'
import type { MessageKey, Translate } from '@/lib/i18n'
import type { CustomerStatus, CustomerType } from '@/generated/prisma/client'

export const BROKER_STATUSES: CustomerStatus[] = [
  'ACTIVE',
  'ON_HOLD',
  'BLOCKED',
  'INACTIVE',
]

export const BROKER_TYPES: CustomerType[] = [
  'BROKER',
  'SHIPPER',
  'DIRECT_CUSTOMER',
]

export const brokerStatusKey = (status: CustomerStatus): MessageKey =>
  `brokers.status.${status}` as MessageKey

export const brokerTypeKey = (type: CustomerType): MessageKey =>
  `brokers.type.${type}` as MessageKey

/**
 * No authority field, and that is the point.
 *
 * A broker belongs to the organization, not to an operating authority: the
 * same broker gives freight to every MC number in the group, and duplicating
 * them per authority would split one payment relationship into three. Every
 * fleet form starts with an authority; this one does not, and the schema is
 * what says so — `Customer` has no `companyId`.
 */
export function brokerFields(t: Translate): FieldSpec[] {
  return [
    {
      kind: 'text',
      name: 'name',
      label: t('brokers.name'),
      required: true,
      autoFocus: true,
    },
    {
      kind: 'select',
      name: 'type',
      label: t('brokers.type'),
      options: BROKER_TYPES.map((type) => ({
        value: type,
        label: t(brokerTypeKey(type)),
      })),
    },
    { kind: 'text', name: 'mcNumber', label: t('brokers.mc'), mono: true },
    { kind: 'text', name: 'dotNumber', label: t('brokers.dot'), mono: true },
    { kind: 'text', name: 'addressLine1', label: t('brokers.address') },
    { kind: 'text', name: 'city', label: t('brokers.city') },
    { kind: 'text', name: 'state', label: t('brokers.state') },
    { kind: 'text', name: 'postalCode', label: t('brokers.postal') },
    { kind: 'tel', name: 'phone', label: t('brokers.phone') },
    { kind: 'email', name: 'email', label: t('brokers.email') },
    { kind: 'email', name: 'billingEmail', label: t('brokers.billingEmail') },
    {
      kind: 'number',
      name: 'paymentTermsDays',
      label: t('brokers.terms'),
      hint: t('brokers.termsHint'),
    },
    {
      kind: 'select',
      name: 'status',
      label: t('ref.status'),
      options: BROKER_STATUSES.map((status) => ({
        value: status,
        label: t(brokerStatusKey(status)),
      })),
    },
    {
      kind: 'text',
      name: 'blockedReason',
      label: t('brokers.blockedReason'),
      hint: t('brokers.blockedReasonHint'),
    },
    { kind: 'textarea', name: 'notes', label: t('ref.notes') },
  ]
}
