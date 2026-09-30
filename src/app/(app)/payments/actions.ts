'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import {
  applyAllocations,
  applyToInvoice,
  applyToLoads,
  recordPayment,
  type Allocation,
  type AllocationRefusal,
} from '@/lib/payments'
import { MoneyFormatError, parseMoneyToCents } from '@/lib/money'
import { normalizeTypedDate, utcMidnight } from '@/lib/typed-date'
import { PAYMENT_INITIAL, type PaymentState } from './payment-state'
import type { ApplyState } from './apply-state'
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

/**
 * Apply one payment across a chosen set of open items (§6.2.5).
 *
 * ── THE ROLLBACK LIVES HERE, WHERE THE TRANSACTION IS ────────────────────
 *
 * `applyAllocations` reports; this throws. A sentinel error out of
 * `withCurrentOrg` rolls the interactive transaction back, so a refused
 * allocation undoes the ones that had already been written in the same call.
 * The refusals ride on the sentinel rather than being re-derived afterwards.
 */
class Refused extends Error {
  constructor(readonly refusals: AllocationRefusal[]) {
    super('allocation refused')
  }
}

const ALLOCATION_REASON: Record<string, MessageKey> = {
  payment_not_found: 'payments.error.notFound',
  invoice_not_found: 'payments.error.invoiceNotFound',
  load_not_found: 'payments.error.loadNotFound',
  bad_amount: 'payments.error.badAmount',
  exceeds_unapplied: 'payments.error.exceedsUnapplied',
  exceeds_balance: 'payments.error.exceedsBalance',
  exceeds_load_balance: 'payments.error.exceedsBalance',
  wrong_carrier: 'payments.error.wrongCarrier',
  factored_invoice: 'payments.error.factoredInvoice',
  not_factored: 'payments.error.notFactored',
  not_direct_settled: 'payments.error.notDirectSettled',
  no_loads: 'payments.error.noLoads',
}

export async function applyAllocationsAction(
  paymentId: string,
  _previous: ApplyState,
  formData: FormData,
): Promise<ApplyState> {
  // ONE FIELD PER ROW, `amount.<kind>.<id>`, and a blank or zero is simply
  // not an allocation. A row the person cleared is one they decided not to
  // pay, which is different from one they typed nothing into by accident —
  // and treating both as "skip" is the reading that cannot lose money.
  const allocations: Allocation[] = []
  for (const [field, raw] of formData.entries()) {
    const match = /^amount\.(invoice|load)\.(.+)$/.exec(field)
    if (!match) continue
    const text = String(raw).trim()
    if (text === '') continue
    let amountCents: number
    try {
      amountCents = parseMoneyToCents(text)
    } catch (error) {
      if (!(error instanceof MoneyFormatError)) throw error
      return {
        appliedCents: null,
        unappliedCents: null,
        refusals: [
          { label: match[2]!.slice(0, 8), reason: 'payments.error.badAmount' },
        ],
      }
    }
    if (amountCents === 0) continue
    allocations.push({
      kind: match[1] as Allocation['kind'],
      id: match[2]!,
      amountCents,
    })
  }

  if (allocations.length === 0) {
    return {
      appliedCents: null,
      unappliedCents: null,
      refusals: [{ label: '', reason: 'payments.error.nothingChosen' }],
    }
  }

  try {
    const outcome = await withCurrentOrg('update', 'payment', async (tx) => {
      const result = await applyAllocations(tx, paymentId, allocations)
      if (!result.ok) throw new Refused(result.refusals)
      return result
    })

    revalidatePath(`/payments/${paymentId}`)
    revalidatePath('/accounting/payments')
    return {
      appliedCents: outcome.appliedCents,
      unappliedCents: outcome.unappliedCents,
      refusals: [],
    }
  } catch (error) {
    if (!(error instanceof Refused)) throw error
    return {
      appliedCents: null,
      unappliedCents: null,
      refusals: error.refusals.map((refusal) => ({
        label: refusal.label,
        reason: ALLOCATION_REASON[refusal.reason] ?? 'payments.error.notFound',
      })),
    }
  }
}
