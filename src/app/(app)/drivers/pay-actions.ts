'use server'

import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import { closePayRule, saveDriverPayRule } from '@/lib/driver-pay'
import {
  MoneyFormatError,
  parseMoneyToCents,
  parsePercentToBps,
} from '@/lib/money'
import { normalizeTypedDate, utcMidnight } from '@/lib/typed-date'
import { PAY_RULE_INITIAL, type PayRuleState } from './pay-state'
import type { PayRuleType } from '@/generated/prisma/client'
import type { MessageKey } from '@/lib/i18n'

// Pay rules are `driver.pay` writes, which OWNER, ADMIN and ACCOUNTING hold —
// a MANAGER reads what a driver is paid and does not set it, and a DISPATCHER
// never sees the number at all. permissions.ts decides that; this asks.

const ERRORS: Record<string, MessageKey> = {
  driver_not_found: 'payRule.error.driverNotFound',
  custom_unsupported: 'payRule.error.customUnsupported',
  bad_percent: 'payRule.error.badPercent',
  bad_per_mile: 'payRule.error.badPerMile',
  bad_flat: 'payRule.error.badFlat',
  bad_dates: 'payRule.error.badDates',
  overlaps: 'payRule.error.overlaps',
}

const text = (formData: FormData, key: string) =>
  String(formData.get(key) ?? '').trim()

export async function savePayRuleAction(
  driverId: string,
  _previous: PayRuleState,
  formData: FormData,
): Promise<PayRuleState> {
  const type = text(formData, 'type') as PayRuleType

  let percentBps: number | null = null
  let perMileCents: number | null = null
  let flatCents: number | null = null

  try {
    // Only the figure this type needs is read. Parsing all three would turn a
    // leftover value in a hidden field into a number on the saved rule.
    if (type === 'PERCENT_GROSS' || type === 'PERCENT_LINEHAUL') {
      percentBps = parsePercentToBps(text(formData, 'percent'))
    } else if (type === 'PER_MILE') {
      perMileCents = parseMoneyToCents(text(formData, 'perMile'))
    } else if (type === 'FLAT_PER_LOAD') {
      flatCents = parseMoneyToCents(text(formData, 'flat'))
    }
  } catch (error) {
    if (!(error instanceof MoneyFormatError)) throw error
    return {
      error:
        type === 'PER_MILE'
          ? 'payRule.error.badPerMile'
          : type === 'FLAT_PER_LOAD'
            ? 'payRule.error.badFlat'
            : 'payRule.error.badPercent',
      savedId: null,
    }
  }

  const from = normalizeTypedDate(text(formData, 'effectiveFrom'))
  if (!from) return { error: 'payRule.error.badDates', savedId: null }

  const toTyped = text(formData, 'effectiveTo')
  const to = toTyped === '' ? null : normalizeTypedDate(toTyped)
  if (toTyped !== '' && !to) {
    return { error: 'payRule.error.badDates', savedId: null }
  }

  const outcome = await withCurrentOrg('update', 'driver.pay', (tx) =>
    saveDriverPayRule(tx, driverId, {
      type,
      percentBps,
      perMileCents,
      flatCents,
      effectiveFrom: utcMidnight(from),
      effectiveTo: to ? utcMidnight(to) : null,
      notes: text(formData, 'notes'),
    }),
  )

  if (!outcome.ok) {
    return {
      error: ERRORS[outcome.reason] ?? 'payRule.error.driverNotFound',
      savedId: null,
    }
  }

  revalidatePath(`/drivers/${driverId}`)
  return { ...PAY_RULE_INITIAL, savedId: outcome.ruleId }
}

export async function closePayRuleAction(
  driverId: string,
  ruleId: string,
  _previous: PayRuleState,
  formData: FormData,
): Promise<PayRuleState> {
  const typed = normalizeTypedDate(text(formData, 'effectiveTo'))
  if (!typed) return { error: 'payRule.error.badDates', savedId: null }

  const outcome = await withCurrentOrg('update', 'driver.pay', (tx) =>
    closePayRule(tx, ruleId, utcMidnight(typed)),
  )
  if (!outcome.ok) return { error: 'payRule.error.badDates', savedId: null }

  revalidatePath(`/drivers/${driverId}`)
  return { ...PAY_RULE_INITIAL, savedId: ruleId }
}
