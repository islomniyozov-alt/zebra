'use server'

import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import { addAccessorial, removeAccessorial, setLoadRate } from '@/lib/rates'
import { RATE_INITIAL, type RateState } from './rate-state'
import type { AccessorialType } from '@/generated/prisma/client'
import type { MessageKey } from '@/lib/i18n'

// Rate entry (§5 step 1). Gated on `load.financials`, which OWNER, ADMIN and
// ACCOUNTING hold and a MANAGER holds read-only — §1's "rates are entered by
// OWNER/ACCOUNTING", enforced where every other permission is.

const FAILURES: Record<string, MessageKey> = {
  bad_amount: 'rate.error.badAmount',
  negative: 'rate.error.negative',
  not_found: 'rate.error.notFound',
}

export async function setRateAction(
  loadId: string,
  _previous: RateState,
  formData: FormData,
): Promise<RateState> {
  const outcome = await withCurrentOrg('update', 'load.financials', (tx) =>
    setLoadRate(tx, loadId, {
      linehaul: String(formData.get('linehaul') ?? ''),
      fuelSurcharge: String(formData.get('fuelSurcharge') ?? ''),
    }),
  )

  if (!outcome.ok) {
    return {
      error: FAILURES[outcome.reason] ?? 'rate.error.badAmount',
      field: outcome.field ?? null,
      savedTotalCents: null,
    }
  }

  revalidatePath(`/loads/${loadId}`)
  revalidatePath('/loads')
  return { ...RATE_INITIAL, savedTotalCents: outcome.totalRevenueCents }
}

export async function addAccessorialAction(
  loadId: string,
  _previous: RateState,
  formData: FormData,
): Promise<RateState> {
  const outcome = await withCurrentOrg(
    'update',
    'load.financials',
    (tx, session) =>
      addAccessorial(tx, session.organizationId, loadId, {
        type: String(formData.get('type') ?? 'OTHER') as AccessorialType,
        amount: String(formData.get('amount') ?? ''),
        // Unchecked means a cost you ate, which is the answer that costs money
        // if guessed wrong — so it is the one you have to choose.
        isBillable: formData.get('isBillable') === 'on',
        notes: null,
      }),
  )

  if (!outcome.ok) {
    return {
      error: FAILURES[outcome.reason] ?? 'rate.error.badAmount',
      field: null,
      savedTotalCents: null,
    }
  }

  revalidatePath(`/loads/${loadId}`)
  revalidatePath('/loads')
  return { ...RATE_INITIAL, savedTotalCents: outcome.totalRevenueCents }
}

export async function removeAccessorialAction(
  loadId: string,
  accessorialId: string,
): Promise<void> {
  await withCurrentOrg('update', 'load.financials', (tx) =>
    removeAccessorial(tx, loadId, accessorialId),
  )
  revalidatePath(`/loads/${loadId}`)
  revalidatePath('/loads')
}
