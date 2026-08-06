'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import {
  addSettlementLine,
  approveSettlement,
  generateSettlement,
  markSettlementPaid,
  removeSettlementLine,
  voidSettlement,
} from '@/lib/settlements'
import { MoneyFormatError, parseMoneyToCents } from '@/lib/money'
import { normalizeTypedDate, utcMidnight } from '@/lib/typed-date'
import { SETTLEMENT_INITIAL, type SettlementState } from './settlement-state'
import type {
  PaymentMethod,
  SettlementLineType,
} from '@/generated/prisma/client'
import type { MessageKey } from '@/lib/i18n'

// The six writes the settlement screens make.
//
// Generating and editing are `settlement` writes; APPROVING is its own
// permission (`settlement:approve`), because signing off on what a person is
// paid is a different act from preparing it. permissions.ts decides both.

const ERRORS: Record<string, MessageKey> = {
  driver_not_found: 'settlements.error.driverNotFound',
  no_loads: 'settlements.error.noLoads',
  bad_period: 'settlements.error.badPeriod',
  no_rule: 'settlements.error.noRule',
  custom_unsupported: 'settlements.error.customUnsupported',
  rule_incomplete: 'settlements.error.ruleIncomplete',
  no_miles: 'settlements.error.noMiles',
  not_found: 'settlements.error.notFound',
  not_draft: 'settlements.error.notDraft',
  not_approved: 'settlements.error.notApproved',
  already_paid: 'settlements.error.alreadyPaid',
  negative_net: 'settlements.error.negativeNet',
  no_reference: 'settlements.error.noReference',
  bad_amount: 'settlements.error.badAmount',
  no_description: 'settlements.error.noDescription',
  wrong_sign: 'settlements.error.wrongSign',
}

const fail = (reason: string, loadNumbers: string[] = []): SettlementState => ({
  ...SETTLEMENT_INITIAL,
  error: ERRORS[reason] ?? 'settlements.error.notFound',
  loadNumbers,
})

const text = (formData: FormData, key: string) =>
  String(formData.get(key) ?? '').trim()

export async function generateSettlementAction(
  _previous: SettlementState,
  formData: FormData,
): Promise<SettlementState> {
  const { t } = await getLocaleContext()

  const from = normalizeTypedDate(text(formData, 'periodStart'))
  const to = normalizeTypedDate(text(formData, 'periodEnd'))
  if (!from || !to) return fail('bad_period')

  const outcome = await withCurrentOrg('create', 'settlement', (tx, session) =>
    generateSettlement(tx, session.organizationId, {
      driverId: text(formData, 'driverId'),
      periodStart: utcMidnight(from),
      // The whole of the last day, not midnight at its start — a POD that
      // landed at 4pm on Sunday belongs to the week that ends on Sunday.
      periodEnd: new Date(`${to}T23:59:59.999Z`),
      labels: {
        // Written in the generating user's locale and then FROZEN. A
        // settlement is a document, and a document does not change language
        // because a different person opens it.
        //
        // `settlementLine.LOAD_PAY`, not `settlements.loads` — the first run
        // of the walkthrough produced lines reading "Loads 1111", because a
        // column heading had been reused as a line description.
        loadPay: (loadNumber: string) =>
          `${t('settlementLine.LOAD_PAY')} ${loadNumber}`,
      },
    }),
  )

  if (!outcome.ok) return fail(outcome.reason, outcome.loadNumbers ?? [])

  revalidatePath('/settlements')
  redirect(`/settlements/${outcome.settlementId}`)
}

export async function addLineAction(
  settlementId: string,
  _previous: SettlementState,
  formData: FormData,
): Promise<SettlementState> {
  let amountCents: number
  try {
    amountCents = parseMoneyToCents(text(formData, 'amount'))
  } catch (error) {
    if (!(error instanceof MoneyFormatError)) throw error
    return fail('bad_amount')
  }

  const outcome = await withCurrentOrg('update', 'settlement', (tx) =>
    addSettlementLine(tx, settlementId, {
      type: text(formData, 'type') as SettlementLineType,
      description: text(formData, 'description'),
      amountCents,
    }),
  )

  if (!outcome.ok) return fail(outcome.reason)

  revalidatePath(`/settlements/${settlementId}`)
  revalidatePath('/settlements')
  return SETTLEMENT_INITIAL
}

export async function removeLineAction(
  settlementId: string,
  lineId: string,
  _previous: SettlementState,
  _formData: FormData,
): Promise<SettlementState> {
  const outcome = await withCurrentOrg('update', 'settlement', (tx) =>
    removeSettlementLine(tx, lineId),
  )
  if (!outcome.ok) return fail(outcome.reason)

  revalidatePath(`/settlements/${settlementId}`)
  revalidatePath('/settlements')
  return SETTLEMENT_INITIAL
}

export async function approveSettlementAction(
  settlementId: string,
  _previous: SettlementState,
  _formData: FormData,
): Promise<SettlementState> {
  const outcome = await withCurrentOrg('approve', 'settlement', (tx, session) =>
    approveSettlement(tx, settlementId, session.userId),
  )
  if (!outcome.ok) return fail(outcome.reason)

  revalidatePath(`/settlements/${settlementId}`)
  revalidatePath('/settlements')
  return SETTLEMENT_INITIAL
}

export async function markPaidAction(
  settlementId: string,
  _previous: SettlementState,
  formData: FormData,
): Promise<SettlementState> {
  const outcome = await withCurrentOrg('update', 'settlement', (tx) =>
    markSettlementPaid(tx, settlementId, {
      method: text(formData, 'method') as PaymentMethod,
      reference: text(formData, 'reference'),
    }),
  )
  if (!outcome.ok) return fail(outcome.reason)

  revalidatePath(`/settlements/${settlementId}`)
  revalidatePath('/settlements')
  return SETTLEMENT_INITIAL
}

export async function voidSettlementAction(
  settlementId: string,
  _previous: SettlementState,
  _formData: FormData,
): Promise<SettlementState> {
  const outcome = await withCurrentOrg('delete', 'settlement', (tx) =>
    voidSettlement(tx, settlementId),
  )
  if (!outcome.ok) return fail(outcome.reason)

  revalidatePath(`/settlements/${settlementId}`)
  revalidatePath('/settlements')
  revalidatePath('/loads')
  return SETTLEMENT_INITIAL
}
