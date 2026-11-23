'use server'

import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import { recordRenewal } from '@/lib/compliance'
import { readRenewalForm } from '@/lib/compliance-form'
import type { MessageKey } from '@/lib/i18n'
import type { ComplianceState } from '../_reference/compliance-state'

// FILING A CONFIRMED ANNUAL INSPECTION (TMS §7.8, v11.47). The compliance
// panel's own path: `readRenewalForm` reads what the person typed — the
// reader's prefill, corrected or completed by hand — and `recordRenewal`
// writes it against the truck the person confirmed. §0 rule 14 holds: a
// refusal hands every typed value back.

const ERRORS: Record<string, MessageKey> = {
  subject_not_found: 'compliancePanel.error.subjectNotFound',
  bad_dates: 'compliancePanel.error.badDates',
  no_expiry: 'compliancePanel.error.noExpiry',
  duplicate: 'compliancePanel.error.duplicate',
}

export async function fileInspectionAction(
  _previous: ComplianceState,
  formData: FormData,
): Promise<ComplianceState> {
  formData.set('type', 'ANNUAL_INSPECTION')
  const read = readRenewalForm(formData)
  const truckId = String(formData.get('truckId') ?? '').trim()
  if (!read.ok) {
    return { error: read.error, createdId: null, values: read.values }
  }
  if (truckId === '') {
    return {
      error: 'safety.inspection.noTruck',
      createdId: null,
      values: read.values,
    }
  }

  const outcome = await withCurrentOrg('create', 'compliance', (tx) =>
    recordRenewal(tx, { subject: 'truck', subjectId: truckId, ...read.fields }),
  )
  if (!outcome.ok) {
    return {
      error: ERRORS[outcome.reason] ?? 'compliancePanel.error.subjectNotFound',
      createdId: null,
      values: read.values,
    }
  }

  revalidatePath('/safety')
  revalidatePath(`/trucks/${truckId}`)
  return { error: null, createdId: outcome.recordId, values: null }
}
