'use server'

import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import { recordRenewal, type ComplianceSubject } from '@/lib/compliance'
import { readRenewalForm } from '@/lib/compliance-form'
import { COMPLIANCE_INITIAL, type ComplianceState } from './compliance-state'
import type { MessageKey } from '@/lib/i18n'

// Recording a renewal is `compliance:create` — a SAFETY act, held by the roles
// with FLEET_WRITE. ACCOUNTING reads expiry dates for billing and factoring
// and cannot renew one; permissions.ts decides that, this asks.

const ERRORS: Record<string, MessageKey> = {
  subject_not_found: 'compliancePanel.error.subjectNotFound',
  bad_dates: 'compliancePanel.error.badDates',
  no_expiry: 'compliancePanel.error.noExpiry',
  duplicate: 'compliancePanel.error.duplicate',
}

export async function recordRenewalAction(
  subject: ComplianceSubject,
  subjectId: string,
  _previous: ComplianceState,
  formData: FormData,
): Promise<ComplianceState> {
  // §0 rule 14: what was typed is read in the lib, and a refusal hands every
  // typed value back so the form shows it again.
  const read = readRenewalForm(formData)
  if (!read.ok) {
    return { error: read.error, createdId: null, values: read.values }
  }

  const outcome = await withCurrentOrg('create', 'compliance', (tx) =>
    recordRenewal(tx, { subject, subjectId, ...read.fields }),
  )

  if (!outcome.ok) {
    return {
      error: ERRORS[outcome.reason] ?? 'compliancePanel.error.subjectNotFound',
      createdId: null,
      values: read.values,
    }
  }

  const path =
    subject === 'truck'
      ? `/trucks/${subjectId}`
      : subject === 'trailer'
        ? `/trailers/${subjectId}`
        : `/drivers/${subjectId}`

  revalidatePath(path)
  // The queue and the dashboard row both read the same derivation, so both
  // move the moment a renewal lands.
  revalidatePath('/safety')
  revalidatePath('/dashboard')

  return { ...COMPLIANCE_INITIAL, createdId: outcome.recordId }
}
