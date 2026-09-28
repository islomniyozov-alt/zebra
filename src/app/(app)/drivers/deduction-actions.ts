'use server'

import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import {
  closeRecurringDeduction,
  saveOpeningBalance,
  saveRecurringDeduction,
} from '@/lib/driver-deductions'
import { MoneyFormatError, parseMoneyToCents } from '@/lib/money'
import { normalizeTypedDate, utcMidnight } from '@/lib/typed-date'
import type { DeductionState, OpeningState } from './deduction-state'
import type { DeductionCadence } from '@/lib/deductions'
import type { OpeningBalanceCategory } from '@/generated/prisma/client'
import type { MessageKey } from '@/lib/i18n'

// ---------------------------------------------------------------------------
// THE FORM READS, ONE FUNCTION DECIDES, THE PAGE REVALIDATES.
//
// AGENTS.md's rule, and the reason is not style: an action body runs behind
// `withCurrentOrg`, so a rule written HERE can only be tested by standing up the
// whole auth context, which nobody does — and it ships on a reading instead.
// Every refusal below comes from `driver-deductions.ts`, which has its own suite.
//
// ── THESE ARE `driver.pay` WRITES ─────────────────────────────────────────
//
// The same permission the pay rules use, and for the same reason: a deduction
// changes what a driver is paid. OWNER, ADMIN and ACCOUNTING hold it; a MANAGER
// reads the figures and does not set them, and a DISPATCHER never sees them.
// `permissions.ts` decides that — this only asks.
// ---------------------------------------------------------------------------

const DEDUCTION_ERRORS: Record<string, MessageKey> = {
  driver_not_found: 'deduction.error.driverNotFound',
  unknown_type: 'deduction.error.unknownType',
  bad_amount: 'deduction.error.badAmount',
  bad_monthly_total: 'deduction.error.badMonthlyTotal',
  bad_target: 'deduction.error.badTarget',
  bad_dates: 'deduction.error.badDates',
  overlaps: 'deduction.error.overlaps',
}

const OPENING_ERRORS: Record<string, MessageKey> = {
  driver_not_found: 'opening.error.driverNotFound',
  bad_year: 'opening.error.badYear',
  bad_amount: 'opening.error.badAmount',
  bad_dates: 'opening.error.badDates',
  no_source: 'opening.error.noSource',
}

const text = (formData: FormData, key: string) =>
  String(formData.get(key) ?? '').trim()

export async function saveDeductionAction(
  driverId: string,
  _previous: DeductionState,
  formData: FormData,
): Promise<DeductionState> {
  const cadence = text(formData, 'cadence') as DeductionCadence

  let amountCents: number
  let monthlyTotalCents: number | null = null
  let targetCents: number | null = null
  try {
    amountCents = parseMoneyToCents(text(formData, 'amount'))
    // ONLY THE FIGURES THIS CADENCE USES. A monthly total left behind on a
    // weekly rule is refused by the writer, which is the correct place for that
    // judgement — but sending it at all would be this file inventing an input.
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
  const toTyped = text(formData, 'effectiveTo')
  const to = toTyped === '' ? null : normalizeTypedDate(toTyped)
  if (toTyped !== '' && !to) {
    return { error: 'deduction.error.badDates', savedId: null }
  }

  const outcome = await withCurrentOrg('update', 'driver.pay', (tx) =>
    saveRecurringDeduction(tx, driverId, {
      type: text(formData, 'type'),
      description: text(formData, 'description') || null,
      amountCents,
      cadence,
      monthlyTotalCents,
      targetCents,
      effectiveFrom: utcMidnight(from),
      effectiveTo: to ? utcMidnight(to) : null,
      notes: text(formData, 'notes') || null,
    }),
  )

  if (!outcome.ok) {
    return {
      error: DEDUCTION_ERRORS[outcome.reason] ?? 'deduction.error.badAmount',
      savedId: null,
    }
  }
  revalidatePath(`/drivers/${driverId}`)
  return { error: null, savedId: outcome.deductionId }
}

export async function closeDeductionAction(
  driverId: string,
  deductionId: string,
  _previous: DeductionState,
  formData: FormData,
): Promise<DeductionState> {
  const on = normalizeTypedDate(text(formData, 'effectiveTo'))
  if (!on) return { error: 'deduction.error.badDates', savedId: null }

  const outcome = await withCurrentOrg('update', 'driver.pay', (tx) =>
    closeRecurringDeduction(tx, deductionId, utcMidnight(on)),
  )
  if (!outcome.ok) {
    return {
      error:
        outcome.reason === 'not_found'
          ? 'deduction.error.driverNotFound'
          : 'deduction.error.badDates',
      savedId: null,
    }
  }
  revalidatePath(`/drivers/${driverId}`)
  return { error: null, savedId: deductionId }
}

export async function saveOpeningBalanceAction(
  driverId: string,
  _previous: OpeningState,
  formData: FormData,
): Promise<OpeningState> {
  let amountCents: number
  try {
    // ── THE SIGN IS THE ACCOUNTANT'S, NOT OURS ──────────────────────────
    //
    // Deductions print negative on every statement and that is how they are
    // typed in. Flipping the sign for them here would mean the screen and the
    // paper disagree about what was entered, and the person reconciling has no
    // way to tell which one lied.
    amountCents = parseMoneyToCents(text(formData, 'amount'))
  } catch (error) {
    if (!(error instanceof MoneyFormatError)) throw error
    return { error: 'opening.error.badAmount', savedId: null }
  }

  const asOf = normalizeTypedDate(text(formData, 'asOf'))
  if (!asOf) return { error: 'opening.error.badDates', savedId: null }

  const year = Number.parseInt(text(formData, 'year'), 10)
  if (!Number.isInteger(year)) {
    return { error: 'opening.error.badYear', savedId: null }
  }

  const outcome = await withCurrentOrg('update', 'driver.pay', (tx) =>
    saveOpeningBalance(tx, driverId, {
      year,
      category: text(formData, 'category') as OpeningBalanceCategory,
      amountCents,
      asOf: utcMidnight(asOf),
      source: text(formData, 'source'),
      notes: text(formData, 'notes') || null,
    }),
  )

  if (!outcome.ok) {
    return {
      error: OPENING_ERRORS[outcome.reason] ?? 'opening.error.badAmount',
      savedId: null,
    }
  }
  revalidatePath(`/drivers/${driverId}`)
  return { error: null, savedId: outcome.balanceId }
}
