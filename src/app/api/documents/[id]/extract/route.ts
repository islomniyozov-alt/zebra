import { NextResponse } from 'next/server'
import { withCurrentOrg } from '@/lib/auth-context'
import { objectBytes, r2ConfigFromEnv } from '@/lib/r2'
import { extractRateConfirmation } from '@/lib/rate-confirmation'
import { formatCostMilliCents } from '@/lib/claude'
import { withoutMoney } from '@/lib/extraction'
import { apiError, authFailureResponse } from '../../../_lib/respond'

// POST /api/documents/{id}/extract — read a rate confirmation (Phase 5 §3).
//
// The document is already in R2 by the time this runs: the browser uploaded it
// through the ordinary pipeline and confirmed it, so this fetches the bytes and
// asks the model about them. Extraction is the only step that needs the file
// itself; everything after it reads the columns this writes.
//
// `document:create` RATHER THAN `document:read`, deliberately. This spends
// money and writes to the row. A role that may look at documents is not
// thereby a role that may bill the account, and every operator role that
// uploads one already holds create — a dispatcher included, which is the whole
// point of §1's upload-first flow.
//
// THE MONEY SPLIT IS §1.3's, AND IT HAPPENS HERE. A DISPATCHER gets the
// extraction with the `money` key REMOVED — not emptied, removed — so the
// payload on the wire carries no rate at all. The figures stay on the
// Document's OCR columns for the rate panel, which asks a different permission.

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params

  try {
    const result = await withCurrentOrg(
      'create',
      'document',
      async (tx, session) => {
        const document = await tx.document.findFirst({
          where: { id, deletedAt: null },
          select: { id: true, r2Key: true, mimeType: true },
        })
        if (!document) return null

        // Fetched inside the scoped transaction so the row was proved to be
        // this tenant's before a byte is read out of the bucket.
        const bytes = await objectBytes(r2ConfigFromEnv(), document.r2Key)
        if (!bytes) return { missing: true as const }

        const outcome = await extractRateConfirmation(tx, {
          documentId: document.id,
          base64: base64Of(bytes),
          mimeType: document.mimeType,
        })

        return { outcome, session }
      },
      // The model takes seconds, not milliseconds, and the transaction is open
      // across it. Generous on purpose and still finite.
      { timeoutMs: 60_000, maxWaitMs: 20_000 },
    )

    if (!result) return apiError(404, 'not_found', 'No such document.')
    if ('missing' in result) {
      return apiError(404, 'not_found', 'The document has no stored object.')
    }

    const { outcome, session } = result

    if (!outcome.ok) {
      // 422, not 500: the request was fine and the document could not be read.
      // The reason is the caller's to show — "this file cannot be read" and
      // "try again" are different sentences.
      return apiError(422, outcome.reason, outcome.detail)
    }

    const maySeeMoney = session.role !== 'DISPATCHER'

    return NextResponse.json({
      documentId: outcome.documentId,
      // §1.3. The key is absent for a dispatcher, not blanked.
      extracted: maySeeMoney
        ? outcome.extracted
        : withoutMoney(outcome.extracted),
      ...(maySeeMoney ? { money: outcome.money } : {}),
      cost: {
        milliCents: outcome.costMilliCents,
        display: formatCostMilliCents(outcome.costMilliCents),
        inputTokens: outcome.usage.inputTokens,
        outputTokens: outcome.usage.outputTokens,
        model: outcome.model,
      },
    })
  } catch (error) {
    const authFailure = authFailureResponse(error)
    if (authFailure) return authFailure
    throw error
  }
}

/** Bytes to base64, without Buffer — this runs on workerd. */
function base64Of(bytes: Uint8Array): string {
  let binary = ''
  // Chunked: `String.fromCharCode(...bytes)` on a megabyte blows the argument
  // limit, and the failure is a stack overflow rather than a message.
  const CHUNK = 0x8000
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK))
  }
  return btoa(binary)
}
