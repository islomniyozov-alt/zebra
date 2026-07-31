import type { TxClient } from './tenancy'
import type { CustomerStatus, CustomerType } from '@/generated/prisma/client'
import {
  ReferenceError,
  optionalText,
  requiredText,
  stateCode,
} from './reference'

// ---------------------------------------------------------------------------
// BROKERS — `Customer` in the schema, "broker" everywhere a person can see.
//
// §10: name things as the user names them. These are almost always freight
// brokers; the model covers shippers and direct customers too, which is why
// the table is not called Broker, and the interface says broker because that
// is the word used on the phone.
//
// UNLIKE THE FLEET, A BROKER HAS NO AUTHORITY. It belongs to the organization,
// not to a Company — the same broker gives freight to every authority in the
// group, and duplicating them per authority would split the payment history of
// one relationship into three. That is why the create form here has no
// authority field while every fleet form does.
// ---------------------------------------------------------------------------

export interface BrokerInput {
  name: string
  type?: CustomerType
  mcNumber?: unknown
  dotNumber?: unknown
  addressLine1?: unknown
  city?: unknown
  state?: unknown
  postalCode?: unknown
  phone?: unknown
  email?: unknown
  billingEmail?: unknown
  paymentTermsDays?: unknown
  status?: CustomerStatus
  blockedReason?: unknown
  notes?: unknown
}

function paymentTerms(value: unknown): number {
  const text = optionalText(value)
  if (text === null) return 30
  const days = Number(text)
  if (!Number.isInteger(days) || days < 0 || days > 365) {
    throw new ReferenceError('invalid_year', { field: 'paymentTermsDays' })
  }
  return days
}

/**
 * Blocking a broker is a first-class state with a reason attached.
 *
 * BIG M II is why. A broker that stopped paying was recorded as a note in a
 * field nobody reads, and the operation kept hauling for them. If the status
 * is BLOCKED or ON_HOLD, the reason is required — an unexplained block is one
 * a dispatcher will override at 6am.
 */
function blockedReasonFor(
  status: CustomerStatus,
  value: unknown,
): string | null {
  const reason = optionalText(value)
  if ((status === 'BLOCKED' || status === 'ON_HOLD') && reason === null) {
    throw new ReferenceError('required', { field: 'blockedReason' })
  }
  return status === 'BLOCKED' || status === 'ON_HOLD' ? reason : null
}

export async function createBroker(
  tx: TxClient,
  organizationId: string,
  input: BrokerInput,
) {
  const status = input.status ?? 'ACTIVE'
  return tx.customer.create({
    data: {
      organizationId,
      name: requiredText(input.name, 'name'),
      type: input.type ?? 'BROKER',
      mcNumber: optionalText(input.mcNumber),
      dotNumber: optionalText(input.dotNumber),
      addressLine1: optionalText(input.addressLine1),
      city: optionalText(input.city),
      state: stateCode(input.state),
      postalCode: optionalText(input.postalCode),
      phone: optionalText(input.phone),
      email: optionalText(input.email),
      billingEmail: optionalText(input.billingEmail),
      paymentTermsDays: paymentTerms(input.paymentTermsDays),
      status,
      blockedReason: blockedReasonFor(status, input.blockedReason),
      notes: optionalText(input.notes),
    },
  })
}

export async function updateBroker(
  tx: TxClient,
  id: string,
  input: BrokerInput,
) {
  const current = await tx.customer.findUnique({
    where: { id },
    select: { status: true },
  })
  if (!current) throw new ReferenceError('not_found')

  const status = input.status ?? current.status
  return tx.customer.update({
    where: { id },
    data: {
      name: requiredText(input.name, 'name'),
      ...(input.type ? { type: input.type } : {}),
      mcNumber: optionalText(input.mcNumber),
      dotNumber: optionalText(input.dotNumber),
      addressLine1: optionalText(input.addressLine1),
      city: optionalText(input.city),
      state: stateCode(input.state),
      postalCode: optionalText(input.postalCode),
      phone: optionalText(input.phone),
      email: optionalText(input.email),
      billingEmail: optionalText(input.billingEmail),
      paymentTermsDays: paymentTerms(input.paymentTermsDays),
      status,
      blockedReason: blockedReasonFor(status, input.blockedReason),
      notes: optionalText(input.notes),
    },
  })
}

/** Soft delete. A broker with invoice history is never actually removed. */
export async function retireBroker(tx: TxClient, id: string): Promise<void> {
  await tx.customer.update({
    where: { id },
    data: { deletedAt: new Date() },
  })
}

export async function restoreBroker(tx: TxClient, id: string): Promise<void> {
  await tx.customer.update({ where: { id }, data: { deletedAt: null } })
}

/**
 * The tone for a broker's row stripe.
 *
 * §2 says one meaning per screen, stated in the header. On this screen the
 * stripe means "can you book freight for them right now".
 */
export function brokerTone(
  status: CustomerStatus,
): 'neutral' | 'danger' | 'warning' | 'muted' {
  switch (status) {
    case 'ACTIVE':
      return 'neutral'
    case 'ON_HOLD':
      return 'warning'
    case 'BLOCKED':
      return 'danger'
    case 'INACTIVE':
      return 'muted'
  }
}
