'use server'

import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import { fileRegistration, readRegistrationFiling } from '@/lib/new-asset'
import type { MessageKey } from '@/lib/i18n'
import type { RegistrationFileState } from './registration-state'

// FILING A CONFIRMED CAB CARD FROM THE SAFETY INTAKE (TMS §7.8, v11.57).
// Glue only: the filing is read by `readRegistrationFiling` and written by
// `fileRegistration` — Add truck's own two functions — against the truck the
// person confirmed. §0 rule 14: a refusal hands what was typed back.

const ERRORS: Record<string, MessageKey> = {
  subject_not_found: 'compliancePanel.error.subjectNotFound',
  bad_dates: 'compliancePanel.error.badDates',
  no_expiry: 'compliancePanel.error.noExpiry',
  duplicate: 'compliancePanel.error.duplicate',
}

export async function fileRegistrationAction(
  _previous: RegistrationFileState,
  formData: FormData,
): Promise<RegistrationFileState> {
  const typed = {
    truckId: String(formData.get('truckId') ?? ''),
    registrationExpiresAt: String(formData.get('registrationExpiresAt') ?? ''),
    registrationIssuedAt: String(formData.get('registrationIssuedAt') ?? ''),
  }
  const truckId = typed.truckId.trim()
  if (truckId === '') {
    return { error: 'safety.inspection.noTruck', createdId: null, typed }
  }
  const read = readRegistrationFiling(formData)
  if (!read.ok) return { error: read.error, createdId: null, typed }
  if (!read.filing) {
    return { error: 'fleet.registration.noExpiry', createdId: null, typed }
  }
  const filing = read.filing

  const outcome = await withCurrentOrg('create', 'compliance', (tx) =>
    fileRegistration(tx, 'truck', truckId, filing),
  )
  if (!outcome.ok) {
    return {
      error: ERRORS[outcome.reason] ?? 'compliancePanel.error.subjectNotFound',
      createdId: null,
      typed,
    }
  }

  revalidatePath('/safety')
  revalidatePath(`/trucks/${truckId}`)
  return { error: null, createdId: outcome.recordId, typed: null }
}
