'use server'

import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import {
  closeStandingCharge,
  exemptDriver,
  saveStandingCharge,
} from '@/lib/standing-charges'
import { MoneyFormatError, parseMoneyToCents } from '@/lib/money'
import { normalizeTypedDate, utcMidnight } from '@/lib/typed-date'
import type { StandingState } from './standing-state'
import type { DeductionCadence } from '@/lib/deductions'
import type { MessageKey } from '@/lib/i18n'

// PAYROLL → CHARGES → STANDING. Three writes, none of which decides anything.
//
// THE FORM READS, ONE LIB FUNCTION DECIDES, THE PAGE REVALIDATES — AGENTS.md's
// rule, and `standing-charges.ts` has its own suite because of it. Every refusal
// below is that file speaking.
//
// ── ONE PATH REVALIDATED, NOT TWO ────────────────────────────────────────
//
// `actions.ts` beside this revalidates the charges list AND the driver's page,
// because a recurring deduction shows on both. A standing charge belongs to the
// organization and appears on NO driver page — it materialises onto statements
// at refresh, and a draft statement is recomputed when somebody opens it. So
// there is one path, and listing the drivers' pages here would be revalidating
// screens that never showed the row.

const ERRORS: Record<string, MessageKey> = {
  bad_type: 'standing.error.badType',
  bad_amount: 'deduction.error.badAmount',
  bad_scope: 'standing.error.badScope',
  bad_dates: 'deduction.error.badDates',
  overlaps: 'standing.error.overlaps',
  not_found: 'deduction.error.driverNotFound',
  no_reason: 'standing.error.noReason',
  already_exempt: 'standing.error.alreadyExempt',
}

const text = (formData: FormData, key: string) =>
  String(formData.get(key) ?? '').trim()

const refusal = (reason: string, fallback: MessageKey): StandingState => ({
  error: ERRORS[reason] ?? fallback,
  savedId: null,
})

export async function addStandingChargeAction(
  _previous: StandingState,
  formData: FormData,
): Promise<StandingState> {
  const cadence = text(formData, 'cadence') as DeductionCadence

  let amountCents: number
  try {
    amountCents = parseMoneyToCents(text(formData, 'amount'))
  } catch (error) {
    if (!(error instanceof MoneyFormatError)) throw error
    return { error: 'deduction.error.badAmount', savedId: null }
  }

  const from = normalizeTypedDate(text(formData, 'effectiveFrom'))
  if (!from) return { error: 'deduction.error.badDates', savedId: null }

  const outcome = await withCurrentOrg('update', 'driver.pay', (tx, session) =>
    saveStandingCharge(tx, session.organizationId, {
      type: text(formData, 'type'),
      description: text(formData, 'description') || null,
      amountCents,
      cadence,
      appliesTo: text(formData, 'appliesTo'),
      effectiveFrom: utcMidnight(from),
      effectiveTo: null,
      notes: null,
    }),
  )

  if (!outcome.ok) return refusal(outcome.reason, 'deduction.error.badAmount')
  revalidatePath('/accounting/charges')
  return { error: null, savedId: outcome.standingChargeId }
}

export async function closeStandingChargeAction(
  standingChargeId: string,
  _previous: StandingState,
  formData: FormData,
): Promise<StandingState> {
  const on = normalizeTypedDate(text(formData, 'effectiveTo'))
  if (!on) return { error: 'deduction.error.badDates', savedId: null }

  const outcome = await withCurrentOrg('update', 'driver.pay', (tx) =>
    closeStandingCharge(tx, standingChargeId, utcMidnight(on)),
  )
  if (!outcome.ok) return refusal(outcome.reason, 'deduction.error.badDates')
  revalidatePath('/accounting/charges')
  return { error: null, savedId: standingChargeId }
}

export async function exemptDriverAction(
  standingChargeId: string,
  _previous: StandingState,
  formData: FormData,
): Promise<StandingState> {
  const outcome = await withCurrentOrg('update', 'driver.pay', (tx) =>
    exemptDriver(tx, {
      standingChargeId,
      driverId: text(formData, 'driverId'),
      reason: text(formData, 'reason'),
    }),
  )
  if (!outcome.ok) return refusal(outcome.reason, 'standing.error.noReason')
  revalidatePath('/accounting/charges')
  return { error: null, savedId: standingChargeId }
}
