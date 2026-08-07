'use server'

import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import { saveSettings } from '@/lib/settings'
import { SETTINGS_INITIAL, type SettingsState } from './settings-state'
import type { MessageKey } from '@/lib/i18n'

// Saving settings is `organization:update` — OWNER and ADMIN. Invoice terms and
// the settlement week are the owner's call, and a MANAGER who could move the
// week boundary could move every driver's pay period without touching pay.
//
// FIELD-LEVEL DIFFS ARE NOT WRITTEN HERE. The Prisma audit extension already
// records `{ field: { from, to } }` for every changed field on every write
// through the scoped client (audit.ts). What this owes §4 is ONE update per
// save, which `saveSettings` does — so the audit row is one diff of the whole
// save, with untouched fields absent.

const ERRORS: Record<string, MessageKey> = {
  not_found: 'settings.error.notFound',
  bad_prefix: 'settings.error.badPrefix',
  bad_days: 'settings.error.badDays',
  bad_money: 'settings.error.badMoney',
  bad_mpg: 'settings.error.badMpg',
  bad_weekday: 'settings.error.badWeekday',
}

const text = (formData: FormData, key: string) =>
  String(formData.get(key) ?? '').trim()

export async function saveSettingsAction(
  companyId: string,
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const outcome = await withCurrentOrg('update', 'organization', (tx) =>
    saveSettings(tx, companyId, {
      invoiceNumberPrefix: text(formData, 'invoiceNumberPrefix'),
      invoiceTermsDays: text(formData, 'invoiceTermsDays'),
      invoiceNotes: text(formData, 'invoiceNotes'),
      remitToText: text(formData, 'remitToText'),
      defaultFuelCostPerMile: text(formData, 'defaultFuelCostPerMile'),
      defaultMpg: text(formData, 'defaultMpg'),
      factoringFeePercent: text(formData, 'factoringFeePercent'),
      dispatchFeePercent: text(formData, 'dispatchFeePercent'),
      complianceWarnDays: text(formData, 'complianceWarnDays'),
      podMissingAlertDays: text(formData, 'podMissingAlertDays'),
      invoiceOverdueDays: text(formData, 'invoiceOverdueDays'),
      settlementWeekEndsOn: text(formData, 'settlementWeekEndsOn'),
    }),
  )

  if (!outcome.ok) {
    return {
      ...SETTINGS_INITIAL,
      error: ERRORS[outcome.reason] ?? 'settings.error.notFound',
      field: outcome.field ?? null,
    }
  }

  revalidatePath('/settings')
  // Every screen that READS a setting. The compliance queue's horizon and the
  // settlement week both move the moment one of these is saved, and a stale
  // cached page would show yesterday's policy.
  revalidatePath('/safety')
  revalidatePath('/settlements')
  revalidatePath('/dashboard')

  return { ...SETTINGS_INITIAL, changed: outcome.changed }
}
