'use server'

import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { operationalLabelKey } from '@/lib/status'
import {
  DRIVER_STEPS,
  recordPortalStatus,
  tappedAtFrom,
  type PortalStatusFailure,
} from '@/lib/portal-status'
import { toFormState } from '../../(app)/_reference/shared'
import type { StatusStepState } from './status-state'
import type { MessageKey } from '@/lib/i18n'
import type { LoadOperationalStatus } from '@/generated/prisma/client'

// THE DRIVER'S ONE WRITE: `portal.load:update`, which DRIVER holds and no
// office role does. permissions.ts decides that; this asks. The rule itself
// lives in src/lib/portal-status.ts, where the integration test reaches it —
// an action reads the form, calls one function, and revalidates.

const ERRORS: Record<PortalStatusFailure, MessageKey> = {
  no_driver_row: 'portal.noDriver',
  not_own_load: 'portal.status.error.notOwn',
  co_driver: 'portal.status.error.coDriver',
  cancelled: 'portal.status.error.cancelled',
  no_next_step: 'portal.status.error.noNextStep',
  not_the_next_step: 'portal.status.error.notTheNextStep',
}

const isStep = (value: string): value is LoadOperationalStatus =>
  (DRIVER_STEPS as readonly string[]).includes(value)

export async function advanceStatusAction(
  loadId: string,
  _previous: StatusStepState,
  formData: FormData,
): Promise<StatusStepState> {
  const { t } = await getLocaleContext()
  const to = String(formData.get('to') ?? '')
  if (!isStep(to)) {
    return { error: t('portal.status.error.notTheNextStep'), movedTo: null }
  }
  // The tap's own time — set by the phone, carried by a replay from the
  // offline queue (step 6). The one function decides whether to trust it.
  const tappedAt = tappedAtFrom(formData.get('tappedAt'))

  let outcome
  try {
    outcome = await withCurrentOrg('update', 'portal.load', (tx, session) =>
      recordPortalStatus(tx, session, loadId, to, { tappedAt }),
    )
  } catch (error) {
    return { error: toFormState(error, t).error, movedTo: null }
  }
  if (!outcome.ok) return { error: t(ERRORS[outcome.reason]), movedTo: null }

  revalidatePath('/portal')
  revalidatePath('/portal/loads')
  revalidatePath(`/loads/${loadId}`)
  revalidatePath('/dispatch')
  const landed = 'already' in outcome ? outcome.already : outcome.to
  return { error: null, movedTo: t(operationalLabelKey(landed)) }
}
