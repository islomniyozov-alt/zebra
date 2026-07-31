'use server'

import { revalidatePath } from 'next/cache'
import { withCurrentOrg } from '@/lib/auth-context'
import { getLocaleContext } from '@/lib/locale'
import {
  cancelLoad,
  markDelivered,
  uncancelLoad,
  LOAD_WRITE_TIMEOUT_MS,
} from '@/lib/loads'
import { optionalText } from '@/lib/reference'
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

/** After a document lands, the page has to re-read: a POD may have moved it. */
export async function refreshLoadAction(loadId: string): Promise<void> {
  revalidatePath(`/loads/${loadId}`)
  revalidatePath('/loads')
}
