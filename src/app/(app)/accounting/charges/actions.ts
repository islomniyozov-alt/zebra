'use server'

import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import {
  closeRecurringDeduction,
  saveRecurringDeduction,
  updateRecurringDeduction,
} from '@/lib/driver-deductions'
import { MoneyFormatError, parseMoneyToCents } from '@/lib/money'
import { normalizeTypedDate, utcMidnight } from '@/lib/typed-date'
import type { ChargeState } from './state'
import type { DeductionCadence } from '@/lib/deductions'
import type { MessageKey } from '@/lib/i18n'

// ACCOUNTING → CHARGES. Three writes, none of which decides anything.
//
// THE FORM READS, ONE LIB FUNCTION DECIDES, THE PAGE REVALIDATES — AGENTS.md's
// rule, and not a style preference: an action body runs behind `withCurrentOrg`,
// so a rule written here could only be tested by standing up the whole auth
// context, which nobody does. Every refusal below is `driver-deductions.ts`
// speaking, and that file has its own suite.
//
// BOTH PATHS ARE REVALIDATED. A charge shows on this cross-driver list AND on
// the driver's own page; writing here and refreshing only this screen would leave
// the driver page serving a figure that is no longer true, which is the kind of
// disagreement nobody looks for because each screen looks right on its own.

const ERRORS: Record<string, MessageKey> = {
  driver_not_found: 'deduction.error.driverNotFound',
  not_found: 'deduction.error.driverNotFound',
  unknown_type: 'deduction.error.unknownType',
  bad_amount: 'deduction.error.badAmount',
  bad_monthly_total: 'deduction.error.badMonthlyTotal',
  bad_target: 'deduction.error.badTarget',
  bad_dates: 'deduction.error.badDates',
  overlaps: 'deduction.error.overlaps',
}

const text = (formData: FormData, key: string) =>
  String(formData.get(key) ?? '').trim()

const both = (driverId: string) => {
  revalidatePath('/accounting/charges')
  revalidatePath(`/drivers/${driverId}`)
}

export async function addChargeAction(
  _previous: ChargeState,
  formData: FormData,
): Promise<ChargeState> {
  const driverId = text(formData, 'driverId')
  if (driverId === '') {
    return { error: 'deduction.error.driverNotFound', savedId: null }
  }

  const cadence = text(formData, 'cadence') as DeductionCadence

  let amountCents: number
  let monthlyTotalCents: number | null = null
  let targetCents: number | null = null
  try {
    amountCents = parseMoneyToCents(text(formData, 'amount'))
    // ONLY THE FIGURES THIS CADENCE USES. A monthly total left behind on a
    // weekly rule is refused by the writer — the right place for that judgement
    // — but sending it at all would be this file inventing an input.
    if (cadence === 'MONTHLY_SPLIT_WEEKLY') {
      monthlyTotalCents = parseMoneyToCents(text(formData, 'monthlyTotal'))
    }
    const target = text(formData, 'target')
    if (target !== '') targetCents = parseMoneyToCents(target)
  } catch (error) {
    if (!(error instanceof MoneyFormatError)) throw error
    return { error: 'deduction.error.badAmount', savedId: null }
  }

  const from = normalizeTypedDate(text(formData, 'effectiveFrom'))
  if (!from) return { error: 'deduction.error.badDates', savedId: null }

  const outcome = await withCurrentOrg('update', 'driver.pay', (tx) =>
    saveRecurringDeduction(tx, driverId, {
      type: text(formData, 'type'),
      description: text(formData, 'description') || null,
      amountCents,
      cadence,
      monthlyTotalCents,
      targetCents,
      effectiveFrom: utcMidnight(from),
      effectiveTo: null,
      notes: null,
    }),
  )

  if (!outcome.ok) {
    return {
      error: ERRORS[outcome.reason] ?? 'deduction.error.badAmount',
      savedId: null,
    }
  }
  both(driverId)
  return { error: null, savedId: outcome.deductionId }
}

export async function editChargeAction(
  chargeId: string,
  driverId: string,
  _previous: ChargeState,
  formData: FormData,
): Promise<ChargeState> {
  let amountCents: number
  let monthlyTotalCents: number | null = null
  let targetCents: number | null = null
  try {
    amountCents = parseMoneyToCents(text(formData, 'amount'))
    const monthly = text(formData, 'monthlyTotal')
    if (monthly !== '') monthlyTotalCents = parseMoneyToCents(monthly)
    const target = text(formData, 'target')
    if (target !== '') targetCents = parseMoneyToCents(target)
  } catch (error) {
    if (!(error instanceof MoneyFormatError)) throw error
    return { error: 'deduction.error.badAmount', savedId: null }
  }

  const outcome = await withCurrentOrg('update', 'driver.pay', (tx) =>
    updateRecurringDeduction(tx, chargeId, {
      amountCents,
      monthlyTotalCents,
      targetCents,
      description: text(formData, 'description') || null,
    }),
  )

  if (!outcome.ok) {
    return {
      error: ERRORS[outcome.reason] ?? 'deduction.error.badAmount',
      savedId: null,
    }
  }
  both(driverId)
  return { error: null, savedId: chargeId }
}

export async function closeChargeAction(
  chargeId: string,
  driverId: string,
  _previous: ChargeState,
  formData: FormData,
): Promise<ChargeState> {
  const on = normalizeTypedDate(text(formData, 'effectiveTo'))
  if (!on) return { error: 'deduction.error.badDates', savedId: null }

  const outcome = await withCurrentOrg('update', 'driver.pay', (tx) =>
    closeRecurringDeduction(tx, chargeId, utcMidnight(on)),
  )
  if (!outcome.ok) {
    return {
      error: ERRORS[outcome.reason] ?? 'deduction.error.badDates',
      savedId: null,
    }
  }
  both(driverId)
  return { error: null, savedId: chargeId }
}
