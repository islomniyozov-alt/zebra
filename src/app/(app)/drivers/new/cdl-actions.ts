'use server'

import { requireSession } from '@/lib/auth-context'
import { can } from '@/lib/permissions'
import {
  DOCUMENT_TYPES,
  IMAGE_TYPES,
  MAX_DOCUMENT_BASE64_BYTES,
} from '@/lib/claude'
import { NOTHING_READ, cdlPrefill, readCdl } from '@/lib/cdl'
import { EMPTY_CDL_READ, type CdlReadState } from './cdl-state'

// ---------------------------------------------------------------------------
// THE READ, WHICH HAPPENS BEFORE THE DRIVER EXISTS.
//
// THE BYTES GO THROUGH THE WORKER, and that is forced rather than chosen.
// Every other upload here goes straight to R2 on a presigned URL — the file
// never touches the Worker — but a presigned URL is minted against a TARGET
// ENTITY, and there is no driver to target until the confirm step saves one.
// The same constraint the load form records: save, then attach. Here the read
// has to happen first, so the file comes through.
//
// HENCE THE SIZE CAP, and it is the extraction cap rather than the upload cap:
// `MAX_DOCUMENT_BASE64_BYTES` is 10MB because beyond that you are sending a
// 600dpi scan of something that is not a licence. `MAX_UPLOAD_BYTES` (25MB) is
// what the document pipeline will STORE, and storing is not what this does.
//
// NOTHING IS PERSISTED. The card is read and dropped. Filing the image against
// the driver is a document upload against a driver that exists, which is the
// existing path and belongs after the confirm step, not inside the read.
// ---------------------------------------------------------------------------

export async function readCdlAction(
  _previous: CdlReadState,
  formData: FormData,
): Promise<CdlReadState> {
  const session = await requireSession()
  // The same permission the create needs. Reading a licence to prefill a form
  // nobody may submit is work done for a refusal.
  if (!can(session, 'create', 'driver')) {
    return { ...EMPTY_CDL_READ, notice: 'drivers.cdl.notAllowed' }
  }

  const base64 = String(formData.get('cdl') ?? '')
  const mimeType = String(formData.get('cdlType') ?? '')
  const fileName = String(formData.get('cdlName') ?? '') || null

  if (base64 === '') return { ...EMPTY_CDL_READ, notice: 'drivers.cdl.noFile' }

  if (!DOCUMENT_TYPES.has(mimeType) && !IMAGE_TYPES.has(mimeType)) {
    return { ...EMPTY_CDL_READ, fileName, notice: 'drivers.cdl.wrongType' }
  }
  if (base64.length > MAX_DOCUMENT_BASE64_BYTES) {
    return { ...EMPTY_CDL_READ, fileName, notice: 'drivers.cdl.tooLarge' }
  }

  const outcome = await readCdl({ base64, mimeType })

  // NOT_IMPLEMENTED IS ITS OWN ANSWER, distinct from "read it and found
  // nothing". One means the card is fine and we cannot read yet; the other
  // means take a better photograph. Telling a dispatcher the wrong one costs
  // them a second trip to the driver.
  if (!outcome.ok) {
    return {
      values: cdlPrefill(NOTHING_READ),
      attempted: true,
      fileName,
      notice:
        outcome.reason === 'not_implemented'
          ? 'drivers.cdl.notReadingYet'
          : 'drivers.cdl.unreadable',
    }
  }

  return {
    values: cdlPrefill(outcome.fields),
    attempted: true,
    fileName,
    notice: null,
  }
}
