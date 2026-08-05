'use server'

import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import { markFactored, saveFactor } from '@/lib/factoring'
import { MoneyFormatError, parsePercentToBps } from '@/lib/money'
import type { FactoringState } from './factoring-state'
import type { MessageKey } from '@/lib/i18n'

// The two writes the factoring screens make.
//
// Setup is `receivable:update` — configuration of the terms. Selling an invoice
// is `invoice:update`, because the row it changes is the invoice. Neither route
// decides that here; permissions.ts does, and this passes the question along.

const SAVE_ERRORS: Record<string, MessageKey> = {
  no_name: 'factoring.error.noName',
  no_company: 'factoring.error.noCompany',
  bad_rate: 'factoring.error.badRate',
  over_hundred: 'factoring.error.overHundred',
  not_found: 'factoring.error.notFound',
}

const FACTOR_ERRORS: Record<string, MessageKey> = {
  invoice_not_found: 'factoring.error.invoiceNotFound',
  factor_not_found: 'factoring.error.factorNotFound',
  already_factored: 'factoring.error.alreadyFactored',
  not_sent: 'factoring.error.notSent',
  no_terms: 'factoring.error.noTerms',
  wrong_carrier: 'factoring.error.wrongCarrier',
}

const text = (formData: FormData, key: string) =>
  String(formData.get(key) ?? '').trim()

export async function saveFactorAction(
  _previous: FactoringState,
  formData: FormData,
): Promise<FactoringState> {
  // Parsed here rather than in the service: a typed percentage is a form
  // concern, and `saveFactor` takes basis points so a test can hand it 9700
  // without going through a string.
  let advanceRateBps: number
  let feeBps: number
  try {
    advanceRateBps = parsePercentToBps(text(formData, 'advanceRate'))
    feeBps = parsePercentToBps(text(formData, 'feeRate'))
  } catch (error) {
    if (!(error instanceof MoneyFormatError)) throw error
    return { error: 'factoring.error.badRate', savedId: null }
  }

  const outcome = await withCurrentOrg('update', 'receivable', (tx, session) =>
    saveFactor(tx, session.organizationId, {
      id: text(formData, 'id') || null,
      companyId: text(formData, 'companyId'),
      name: text(formData, 'name'),
      contactName: text(formData, 'contactName'),
      phone: text(formData, 'phone'),
      email: text(formData, 'email'),
      advanceRateBps,
      feeBps,
      notes: text(formData, 'notes'),
    }),
  )

  if (!outcome.ok) {
    return {
      error: SAVE_ERRORS[outcome.reason] ?? 'factoring.error.notFound',
      savedId: null,
    }
  }

  revalidatePath('/receivables/factoring')
  return { error: null, savedId: outcome.id }
}

export async function markFactoredAction(
  invoiceId: string,
  _previous: FactoringState,
  formData: FormData,
): Promise<FactoringState> {
  // Blank means "use the terms on file". An empty string parsing to zero would
  // sell the invoice at a 0% advance, which is the kind of quiet wrong number
  // this whole phase exists to avoid.
  const optionalBps = (key: string): number | undefined => {
    const raw = text(formData, key)
    return raw === '' ? undefined : parsePercentToBps(raw)
  }

  let advanceRateBps: number | undefined
  let feeBps: number | undefined
  try {
    advanceRateBps = optionalBps('advanceRate')
    feeBps = optionalBps('feeRate')
  } catch (error) {
    if (!(error instanceof MoneyFormatError)) throw error
    return { error: 'factoring.error.badRate', savedId: null }
  }

  if (
    advanceRateBps !== undefined &&
    feeBps !== undefined &&
    advanceRateBps + feeBps > 10_000
  ) {
    return { error: 'factoring.error.overHundred', savedId: null }
  }

  const outcome = await withCurrentOrg('update', 'invoice', (tx) =>
    markFactored(tx, invoiceId, {
      factoringCompanyId: text(formData, 'factoringCompanyId'),
      ...(advanceRateBps === undefined ? {} : { advanceRateBps }),
      ...(feeBps === undefined ? {} : { feeBps }),
    }),
  )

  if (!outcome.ok) {
    return {
      error: FACTOR_ERRORS[outcome.reason] ?? 'factoring.error.invoiceNotFound',
      savedId: null,
    }
  }

  revalidatePath(`/invoices/${invoiceId}`)
  revalidatePath('/invoices')
  revalidatePath('/receivables')
  // The apportioned fee lands on each load's own financials.
  revalidatePath('/loads')
  return { error: null, savedId: invoiceId }
}
