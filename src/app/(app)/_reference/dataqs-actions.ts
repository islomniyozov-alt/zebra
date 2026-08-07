'use server'

import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import { moveChallenge, openChallenge } from '@/lib/dataqs'
import { CLAIM_INITIAL, type ClaimState } from './claim-state'
import type { DataQsOutcome, DataQsStatus } from '@/generated/prisma/client'
import type { MessageKey } from '@/lib/i18n'

// A DataQs challenge is written from the inspection it disputes, so both
// actions revalidate that screen. §2.5 puts them with claims:
// OWNER/ADMIN/MANAGER write, ACCOUNTING reads.

const OPEN_ERRORS: Record<string, MessageKey> = {
  inspection_not_found: 'dataqs.error.inspectionNotFound',
  violation_not_on_inspection: 'dataqs.error.violationNotOnInspection',
  no_basis: 'dataqs.error.noBasis',
}

const text = (formData: FormData, key: string) =>
  String(formData.get(key) ?? '').trim()

export async function openChallengeAction(
  inspectionId: string,
  _previous: ClaimState,
  formData: FormData,
): Promise<ClaimState> {
  const outcome = await withCurrentOrg('create', 'dataQs', (tx) =>
    openChallenge(tx, {
      inspectionId,
      // The blank option means the carrier is disputing the inspection itself,
      // which is a real filing — wrong carrier, wrong unit, duplicate.
      violationId: text(formData, 'violationId') || null,
      basis: text(formData, 'basis'),
      referenceNumber: text(formData, 'referenceNumber'),
    }),
  )

  if (!outcome.ok) {
    return { error: OPEN_ERRORS[outcome.reason] ?? 'dataqs.error.noBasis' }
  }

  revalidatePath(`/safety/inspections/${inspectionId}`)
  return CLAIM_INITIAL
}

export async function moveChallengeAction(
  inspectionId: string,
  challengeId: string,
  _previous: ClaimState,
  formData: FormData,
): Promise<ClaimState> {
  const outcome = await withCurrentOrg('update', 'dataQs', (tx) =>
    moveChallenge(tx, {
      challengeId,
      to: text(formData, 'to') as DataQsStatus,
      outcome: (text(formData, 'outcome') || null) as DataQsOutcome | null,
      outcomeNote: text(formData, 'outcomeNote'),
      referenceNumber: text(formData, 'referenceNumber'),
    }),
  )

  if (outcome.result === 'not_found') return { error: 'dataqs.error.notFound' }
  if (outcome.result === 'needs_outcome') {
    return { error: 'dataqs.error.needsOutcome' }
  }
  if (outcome.result === 'refused') return { error: 'dataqs.error.refused' }

  revalidatePath(`/safety/inspections/${inspectionId}`)
  return CLAIM_INITIAL
}
