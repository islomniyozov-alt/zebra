'use server'

import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import {
  cancelLoad,
  markDelivered,
  updateLoad,
  uncancelLoad,
  LOAD_WRITE_TIMEOUT_MS,
} from '@/lib/loads'
import { optionalText } from '@/lib/reference'
import { DispatchConflictError } from '@/lib/dispatch'
import { ZONE_CHOICES } from '@/lib/stop-time'
import type { MessageKey } from '@/lib/i18n'

// The load detail screen's writes. Three of them, and only one is a status
// click — §7 keeps everything else on the operational axis automatic.

export interface DetailState {
  error: string | null
  /** Set when a transition was declined, so the screen can say what happened. */
  notice: string | null
}

/**
 * The one manual status click in the application (§7).
 *
 * Returns a NOTICE rather than an error when the engine declines. A Delivered
 * click that arrives after the POD already landed is not a mistake by the
 * person clicking — it is a race, the load is already further along than they
 * think, and the honest response is to say so.
 */
export async function markDeliveredAction(
  loadId: string,
  _previous: DetailState,
): Promise<DetailState> {
  const { t } = await getLocaleContext()

  const outcome = await withCurrentOrg(
    'update',
    'load',
    (tx, session) => markDelivered(tx, loadId, session.userId),
    { timeoutMs: LOAD_WRITE_TIMEOUT_MS },
  )

  revalidatePath(`/loads/${loadId}`)
  revalidatePath('/loads')

  const notice: Record<string, MessageKey> = {
    stale: 'loads.notice.stale',
    unchanged: 'loads.notice.alreadyThere',
    cancelled: 'loads.notice.cancelled',
  }
  const key = notice[outcome.result]

  return { error: null, notice: key ? t(key) : null }
}

export async function cancelLoadAction(
  loadId: string,
  _previous: DetailState,
  formData: FormData,
): Promise<DetailState> {
  const { t } = await getLocaleContext()
  const reason = optionalText(formData.get('reason'))

  if (reason === null) {
    return { error: t('ref.error.required'), notice: null }
  }

  await withCurrentOrg(
    'update',
    'load',
    (tx, session) =>
      cancelLoad(tx, loadId, reason, { byUserId: session.userId }),
    { timeoutMs: LOAD_WRITE_TIMEOUT_MS },
  )

  revalidatePath(`/loads/${loadId}`)
  revalidatePath('/loads')
  return { error: null, notice: null }
}

export async function uncancelLoadAction(loadId: string): Promise<void> {
  await withCurrentOrg(
    'update',
    'load',
    (tx, session) => uncancelLoad(tx, loadId, { byUserId: session.userId }),
    { timeoutMs: LOAD_WRITE_TIMEOUT_MS },
  )
  revalidatePath(`/loads/${loadId}`)
  revalidatePath('/loads')
}

/** A note on the load, written to `Communication` — the log §10 asks for. */
export async function addNoteAction(
  loadId: string,
  _previous: DetailState,
  formData: FormData,
): Promise<DetailState> {
  const { t } = await getLocaleContext()
  const body = optionalText(formData.get('body'))
  if (body === null) {
    return { error: t('ref.error.required'), notice: null }
  }

  await withCurrentOrg('create', 'load', async (tx, session) => {
    const load = await tx.load.findUniqueOrThrow({
      where: { id: loadId },
      select: { companyId: true },
    })
    await tx.communication.create({
      data: {
        organizationId: session.organizationId,
        companyId: load.companyId,
        loadId,
        type: 'NOTE',
        direction: 'INTERNAL',
        body,
        userId: session.userId,
      },
    })
  })

  revalidatePath(`/loads/${loadId}`)
  return { error: null, notice: null }
}

/**
 * Set (or clear) a place's own timezone, from the stop that shows the guess.
 *
 * The ride-along's "form accepts an explicit zone" lands HERE rather than on a
 * Locations screen, because here is where the approximation is admitted. A
 * dispatcher reading "approximate — Central, from the state" under a Panhandle
 * dock can correct it in the same glance; a separate reference screen would
 * mean noticing the problem in one place and fixing it in another, which is
 * how it stays wrong.
 *
 * Clearing it back to blank is allowed and means "derive it again" — the
 * fallback stays a fallback, not a thing you can only escape once.
 *
 * PERMISSION: `load:update`. There is no `location` resource in
 * src/lib/permissions.ts and Step 6 is not the step that invents one; the gap
 * is flagged in the brief rather than resolved here.
 */
export async function setStopZoneAction(
  loadId: string,
  locationId: string,
  formData: FormData,
): Promise<void> {
  const typed = String(formData.get('timezone') ?? '')
  // Only a zone this application can render. Anything else is dropped rather
  // than stored — a bad IANA name surfaces as a wrong appointment time weeks
  // later, and there is no way to tell it from a real one by looking.
  const timezone = ZONE_CHOICES.includes(typed) ? typed : null

  await withCurrentOrg('update', 'load', (tx) =>
    tx.location.update({ where: { id: locationId }, data: { timezone } }),
  )

  revalidatePath(`/loads/${loadId}`)
  revalidatePath('/loads')
}

/** After a document lands, the page has to re-read: a POD may have moved it. */
export async function refreshLoadAction(loadId: string): Promise<void> {
  revalidatePath(`/loads/${loadId}`)
  revalidatePath('/loads')
}

/**
/**
 * Truck and driver, from the load detail.
 *
 * A MAPPER, NOT A DECISION. `updateLoad` in loads.ts does the work — it is
 * the same function the edit path uses, it puts the pair to `assertAssignable`
 * itself, and it moves the load to Dispatched once both are present. Writing
 * the pair straight to the column — as an earlier draft of this did — is a
 * second implementation of the same act, which is flag 89 exactly.
 *
 * A BLANK CLEARS — `optionalText` turning "" into null is what expresses
 * taking a driver off a load. A cancelled load is refused by `updateLoad`.
 */
export async function assignLoadAction(
  loadId: string,
  _previous: DetailState,
  formData: FormData,
): Promise<DetailState> {
  const { t } = await getLocaleContext()

  try {
    await withCurrentOrg(
      'update',
      'load',
      (tx, session) =>
        updateLoad(
          tx,
          loadId,
          {
            truckId: optionalText(formData.get('truckId')),
            driverId: optionalText(formData.get('driverId')),
          },
          { byUserId: session.userId },
        ),
      { timeoutMs: LOAD_WRITE_TIMEOUT_MS },
    )
  } catch (error) {
    if (error instanceof DispatchConflictError) {
      // EVERY refusal at once, not the first — the same sentence-joining the
      // create form does, and for the same reason: one error slot, and a
      // dispatcher fixing one problem only to be told about the next is the
      // interaction §10 exists to prevent.
      const sentences = error.conflicts.map((conflict) =>
        Object.entries(conflict.values).reduce(
          (message, [key, value]) => message.replaceAll(`{${key}}`, value),
          t(conflict.messageKey),
        ),
      )
      return { error: sentences.join(' '), notice: null }
    }
    throw error
  }

  revalidatePath(`/loads/${loadId}`)
  revalidatePath('/loads')
  return { error: null, notice: null }
}
