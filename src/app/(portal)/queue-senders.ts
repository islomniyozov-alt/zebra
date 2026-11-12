import type { Senders } from '@/lib/offline-queue'
import { PORTAL_ENDPOINTS, uploadDocument } from '@/lib/upload-client'
import { advanceStatusAction } from './portal/status-actions'
import { STATUS_STEP_INITIAL } from './portal/status-state'

// HOW A KEPT WRITE REACHES THE OFFICE (Phase 7 step 6): through the SAME
// route the live one takes, so there is one rule per write and the replay
// cannot drift from the tap. A status goes through Load's own server action
// with the tap's time; a document goes through the portal's own mint → PUT →
// confirm. A network failure throws out of here and stops the replay; an
// answer in words comes back as `refused`, and `replay` keeps it on the strip.

export const senders: Senders = {
  async status(entry) {
    const form = new FormData()
    form.set('to', entry.to)
    form.set('tappedAt', entry.tappedAt)
    const result = await advanceStatusAction(
      entry.loadId,
      STATUS_STEP_INITIAL,
      form,
    )
    return result.error
      ? { sent: false, refused: result.error }
      : { sent: true }
  },
  async upload(entry) {
    const file = new File([entry.bytes], entry.filename, {
      type: entry.mimeType,
    })
    await uploadDocument(
      file,
      {
        entity: 'load',
        entityId: entry.loadId,
        documentType: entry.documentType,
      },
      undefined,
      { endpoints: PORTAL_ENDPOINTS, mintBody: { loadId: entry.loadId } },
    )
    return { sent: true }
  },
}
