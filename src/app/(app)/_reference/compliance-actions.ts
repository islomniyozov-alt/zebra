'use server'

import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import { recordRenewal, type ComplianceSubject } from '@/lib/compliance'
import { normalizeTypedDate, utcMidnight } from '@/lib/typed-date'
import { COMPLIANCE_INITIAL, type ComplianceState } from './compliance-state'
import type { ComplianceType } from '@/generated/prisma/client'
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

const text = (formData: FormData, key: string) =>
  String(formData.get(key) ?? '').trim()

export async function recordRenewalAction(
  subject: ComplianceSubject,
  subjectId: string,
  _previous: ComplianceState,
  formData: FormData,
): Promise<ComplianceState> {
  // "810" is the 10th of August — the same typed-date field the load form
  // uses, for the same measured reason (see typed-date.ts).
  const expires = normalizeTypedDate(text(formData, 'expiresAt'))
  if (!expires) {
    return { error: 'compliancePanel.error.noExpiry', createdId: null }
  }

  const issuedTyped = text(formData, 'issuedAt')
  const issued = issuedTyped === '' ? null : normalizeTypedDate(issuedTyped)
  if (issuedTyped !== '' && !issued) {
    return { error: 'compliancePanel.error.badDates', createdId: null }
  }

  const outcome = await withCurrentOrg('create', 'compliance', (tx) =>
    recordRenewal(tx, {
      subject,
      subjectId,
      type: text(formData, 'type') as ComplianceType,
      issuedAt: issued ? utcMidnight(issued) : null,
      expiresAt: utcMidnight(expires),
      identifier: text(formData, 'identifier'),
      issuer: text(formData, 'issuer'),
      notes: text(formData, 'notes'),
    }),
  )

  if (!outcome.ok) {
    return {
      error: ERRORS[outcome.reason] ?? 'compliancePanel.error.subjectNotFound',
      createdId: null,
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
