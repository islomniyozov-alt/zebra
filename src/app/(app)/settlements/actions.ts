'use server'

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
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
import { addTripsToSettlement } from '@/lib/statement-workbench'
import { sendStatementToDriver } from '@/lib/statement-send'
import { refreshTotals } from '@/lib/settlements'
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
  // SEND TO DRIVER. Every refusal keeps its own sentence (§6.2.1): the office
  // does something different about a missing address than about a deployment
  // that is not allowed to send, and one "could not send" would hide which.
  not_final: 'settlements.error.notFinal',
  voided: 'settlements.error.voided',
  no_email: 'settlements.error.noEmail',
  not_production: 'settlements.error.notProduction',
  not_configured: 'settlements.error.mailNotConfigured',
  rejected: 'settlements.error.mailRejected',
  unreachable: 'settlements.error.mailUnreachable',
  misconfigured: 'settlements.error.mailMisconfigured',
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

  // QUANTITY IS OPTIONAL ON THE WIRE and 1 when absent — the add-line form
  // that predates the workbench does not send the field, and its callers all
  // meant one of the thing. A field present but unreadable is NOT 1: that is
  // somebody who typed something into the box.
  const rawQuantity = text(formData, 'quantity')
  const quantity = rawQuantity === '' ? 1 : Number(rawQuantity)

  const outcome = await withCurrentOrg('update', 'settlement', (tx) =>
    addSettlementLine(tx, settlementId, {
      type: text(formData, 'type') as SettlementLineType,
      description: text(formData, 'description'),
      amountCents,
      quantity,
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

// ── THE WORKBENCH: ADD TRIPS, AND RECALCULATE ──────────────────────────────

/**
 * Put chosen loads onto this DRAFT settlement.
 *
 * THE FORM POSTS IDS AND NOTHING ELSE. Prices, places and dates come from the
 * same reader that offered the rows — a form that posted an amount would let a
 * hand-edited request write any figure onto a statement.
 */
export async function addTripsAction(
  settlementId: string,
  _previous: SettlementState,
  formData: FormData,
): Promise<SettlementState> {
  const loadIds = formData.getAll('load').map(String).filter(Boolean)

  const outcome = await withCurrentOrg('update', 'settlement', (tx) =>
    addTripsToSettlement(tx, settlementId, loadIds),
  )
  if (!outcome.ok) return fail(outcome.reason)

  revalidatePath(`/settlements/${settlementId}`)
  revalidatePath('/payroll/statements')
  return SETTLEMENT_INITIAL
}

/**
 * Recompute this settlement's totals from the lines it now carries.
 *
 * ── IT RE-ADDS; IT DOES NOT RE-PRICE ──────────────────────────────────────
 *
 * `refreshTotals` sums the lines. It does not re-run the pay rule, re-read the
 * loads or re-apply deductions — that is `refreshDraft`, and it belongs to the
 * BATCH because it throws every settlement away and rebuilds it.
 *
 * SO THIS IS THE HONEST SCOPE FOR A BUTTON ON ONE STATEMENT: after adding a
 * trip or a charge by hand, the header figures agree with the rows again. A
 * button labelled Recalculate that silently rebuilt the statement would discard
 * exactly the hand edits the person just made.
 */
export async function recalculateAction(
  settlementId: string,
  _previous: SettlementState,
  _formData: FormData,
): Promise<SettlementState> {
  await withCurrentOrg('update', 'settlement', (tx) =>
    refreshTotals(tx, settlementId),
  )
  revalidatePath(`/settlements/${settlementId}`)
  return SETTLEMENT_INITIAL
}

/**
 * Mail one statement to its driver.
 *
 * THE SENTENCES ARE RESOLVED HERE AND PASSED IN, not looked up in the lib.
 * `sendStatementToDriver` builds a message and must not know about `t` — the
 * same reason `basisSentence` takes templates: the Farsi statement rendered
 * mirrored numbers around unmirrored glued words the first time words were
 * assembled next to figures.
 */
export async function sendToDriverAction(
  settlementId: string,
  _previous: SettlementState,
  _formData: FormData,
): Promise<SettlementState> {
  const { t, locale } = await getLocaleContext()
  const host = (await headers()).get('host')
  const origin = process.env.APP_ORIGIN || (host ? `https://${host}` : '')

  const outcome = await withCurrentOrg('update', 'settlement', (tx) =>
    sendStatementToDriver(tx, settlementId, {
      origin,
      locale,
      labels: {
        subject: t('statementMail.subject'),
        greeting: t('statementMail.greeting'),
        body: t('statementMail.body'),
        link: t('statementMail.link'),
      },
    }),
  )

  if (!outcome.ok) return fail(outcome.reason)

  revalidatePath(`/settlements/${settlementId}`)
  return SETTLEMENT_INITIAL
}
