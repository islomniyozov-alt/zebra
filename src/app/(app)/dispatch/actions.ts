'use server'

import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import { LOAD_WRITE_TIMEOUT_MS, applyAssignmentStatus } from '@/lib/loads'
import {
  assertAssignable,
  loadWindow,
  DispatchConflictError,
} from '@/lib/dispatch'
import type { AssignState } from './assign-state'

// Assignment from the board.
//
// It goes through the SAME §8 checks as the create form and the same status
// engine — `assertAssignable` then `applyAssignmentStatus`. Not a copy of
// them: a board that could assign a truck the create form would refuse is a
// board that quietly becomes the way people book overlapping loads.

export async function assignAction(
  loadId: string,
  _previous: AssignState,
  formData: FormData,
): Promise<AssignState> {
  const { t } = await getLocaleContext()

  // Read from the FORM, not from a closure. The first version captured the
  // chosen truck in a `useActionState` reducer closure; the control reported
  // itself selected and enabled, and the action never ran — a failure with no
  // error message anywhere, which is the worst kind. A form that carries its
  // own data has nothing to go stale.
  const truckId = String(formData.get('truckId') ?? '')
  const driverId = String(formData.get('driverId') ?? '') || null
  if (truckId === '') return { error: t('ref.error.required'), moved: null }

  try {
    const outcome = await withCurrentOrg(
      'update',
      'load',
      async (tx, session) => {
        const load = await tx.load.findUniqueOrThrow({
          where: { id: loadId },
          select: { companyId: true, driverId: true },
        })

        // The driver comes from the truck's current pairing when the board
        // does not name one — assigning a truck without its driver would
        // leave the load at Booked and look like nothing happened.
        const driver = driverId ?? load.driverId

        const window = await loadWindow(tx, loadId)
        await assertAssignable(
          tx,
          { truckId, driverId: driver },
          { loadId, companyId: load.companyId, ...window },
        )

        await tx.load.update({
          where: { id: loadId },
          data: { truckId, driverId: driver },
        })

        // Custody history, which is what answers "who had trailer X on the
        // 14th" — the question the Amazon Relay claim turned on.
        await tx.loadAssignment.create({
          data: {
            loadId,
            organizationId: session.organizationId,
            truckId,
            driverId: driver,
            assignedByUserId: session.userId,
          },
        })

        // §7 — Dispatched, automatically, through the one engine. It appears
        // in the timeline as AUTOMATIC because that is what it is.
        return applyAssignmentStatus(tx, loadId, session.userId)
      },
      { timeoutMs: LOAD_WRITE_TIMEOUT_MS },
    )

    revalidatePath('/dispatch')
    revalidatePath('/loads')
    revalidatePath(`/loads/${loadId}`)

    return {
      error: null,
      moved: outcome?.result === 'moved' ? t('status.DISPATCHED') : null,
    }
  } catch (error) {
    if (error instanceof DispatchConflictError) {
      // Every refusal at once, in the design system's voice, naming the load
      // (§8, §10). The board has one message slot, so they join.
      return {
        error: error.conflicts
          .map((conflict) =>
            Object.entries(conflict.values).reduce(
              (message, [key, value]) => message.replaceAll(`{${key}}`, value),
              t(conflict.messageKey),
            ),
          )
          .join(' '),
        moved: null,
      }
    }
    throw error
  }
}
