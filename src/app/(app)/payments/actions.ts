'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import { applyToInvoice, applyToLoads, recordPayment } from '@/lib/payments'
import { MoneyFormatError, parseMoneyToCents } from '@/lib/money'
import { normalizeTypedDate, utcMidnight } from '@/lib/typed-date'
import { PAYMENT_INITIAL, type PaymentState } from './payment-state'
import type { PaymentMethod } from '@/generated/prisma/client'
import type { MessageKey } from '@/lib/i18n'

// The three writes the payment screens make. All three are `payment` writes,
// which OWNER, ADMIN and ACCOUNTING hold and nobody else does — including the
// two that end up changing an invoice or a load, because the thing the person
// is doing is applying money.

const ERRORS: Record<string, MessageKey> = {
  no_company: 'payments.error.noCompany',
  bad_amount: 'payments.error.badAmount',
  no_date: 'payments.error.noDate',
  customer_not_found: 'payments.error.customerNotFound',
  payment_not_found: 'payments.error.paymentNotFound',
  invoice_not_found: 'payments.error.invoiceNotFound',
  load_not_found: 'payments.error.loadNotFound',
  no_loads: 'payments.error.noLoads',
  exceeds_unapplied: 'payments.error.exceedsUnapplied',
  exceeds_balance: 'payments.error.exceedsBalance',
  exceeds_load_balance: 'payments.error.exceedsLoadBalance',
  wrong_carrier: 'payments.error.wrongCarrier',
  not_direct_settled: 'payments.error.notDirectSettled',
  factored_invoice: 'payments.error.factoredInvoice',
  not_factored: 'payments.error.notFactored',
}

const fail = (reason: string, loadNumbers: string[] = []): PaymentState => ({
  ...PAYMENT_INITIAL,
  error: ERRORS[reason] ?? 'payments.error.paymentNotFound',
  loadNumbers,
})

const text = (formData: FormData, key: string) =>
  String(formData.get(key) ?? '').trim()

export async function recordPaymentAction(
  _previous: PaymentState,
  formData: FormData,
): Promise<PaymentState> {
  let amountCents: number
  try {
    amountCents = parseMoneyToCents(text(formData, 'amount'))
  } catch (error) {
    if (!(error instanceof MoneyFormatError)) throw error
    return fail('bad_amount')
  }

  // "810" is the 10th of August. The same parser the load form uses, for the
  // same reason: three tab stops per date is the measurement that killed
  // <input type="date"> here.
  const receivedAt = normalizeTypedDate(text(formData, 'receivedAt'))
  if (!receivedAt) return fail('no_date')

  const outcome = await withCurrentOrg('create', 'payment', (tx, session) =>
    recordPayment(tx, session.organizationId, {
      companyId: text(formData, 'companyId'),
      customerId: text(formData, 'customerId') || null,
      method: text(formData, 'method') as PaymentMethod,
      referenceNumber: text(formData, 'referenceNumber'),
      receivedAt: utcMidnight(receivedAt),
      amountCents,
      notes: text(formData, 'notes'),
      recordedByUserId: session.userId,
    }),
  )

  if (!outcome.ok) return fail(outcome.reason)

  revalidatePath('/payments')
  redirect(`/payments/${outcome.paymentId}`)
}

export async function applyToInvoiceAction(
  paymentId: string,
  _previous: PaymentState,
  formData: FormData,
): Promise<PaymentState> {
  let amountCents: number
  try {
    amountCents = parseMoneyToCents(text(formData, 'amount'))
  } catch (error) {
    if (!(error instanceof MoneyFormatError)) throw error
    return fail('bad_amount')
  }

  const outcome = await withCurrentOrg('update', 'payment', (tx) =>
    applyToInvoice(tx, paymentId, text(formData, 'invoiceId'), amountCents),
  )

  if (!outcome.ok) return fail(outcome.reason)

  revalidatePath(`/payments/${paymentId}`)
  revalidatePath('/payments')
  revalidatePath('/invoices')
  revalidatePath('/receivables')
  revalidatePath('/loads')
  return {
    ...PAYMENT_INITIAL,
    unappliedCents: outcome.unappliedCents,
  }
}

export async function applyToLoadsAction(
  paymentId: string,
  _previous: PaymentState,
  formData: FormData,
): Promise<PaymentState> {
  // One amount field per ticked load, named `amount:<loadId>`. The ticks say
  // which loads the statement covers; the amounts say how much each got, and
  // they are editable because a statement that pays $40 short on one load is a
  // fact worth recording rather than an inconvenience to spread around.
  const shares: { loadId: string; amountCents: number }[] = []
  for (const loadId of formData.getAll('loadIds').map(String)) {
    const raw = text(formData, `amount:${loadId}`)
    if (raw === '') continue
    try {
      const amountCents = parseMoneyToCents(raw)
      if (amountCents !== 0) shares.push({ loadId, amountCents })
    } catch (error) {
      if (!(error instanceof MoneyFormatError)) throw error
      return fail('bad_amount')
    }
  }

  const outcome = await withCurrentOrg('update', 'payment', (tx) =>
    applyToLoads(tx, paymentId, shares),
  )

  if (!outcome.ok) return fail(outcome.reason, outcome.loadNumbers ?? [])

  revalidatePath(`/payments/${paymentId}`)
  revalidatePath('/payments')
  revalidatePath('/invoices')
  revalidatePath('/loads')
  return {
    ...PAYMENT_INITIAL,
    unappliedCents: outcome.unappliedCents,
    shortfallCents: outcome.shortfallCents,
  }
}
