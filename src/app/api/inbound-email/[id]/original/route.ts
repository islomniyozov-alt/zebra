import { withCurrentOrg } from '@/lib/auth-context'
import { objectBytes, r2ConfigFromEnv } from '@/lib/r2'
import { apiError, authFailureResponse } from '../../../_lib/respond'

// GET /api/inbound-email/{id}/original — the message as it arrived (spec §12).
//
// "Store the source document reference so the dispatcher can always verify
// where the extracted information came from." A `.eml` IS that reference: the
// headers that prove who sent it, the body the reader was given, and every
// attachment, in the bytes that actually crossed the wire.
//
// SERVED THROUGH THE WORKER RATHER THAN AS A PRESIGNED URL, which is the
// opposite of what documents do. A presigned GET is a bearer capability that
// outlives the click; the load path accepts that because a rate confirmation
// is opened constantly and the URLs are short-lived. An original is opened
// rarely, during an argument, and is worth the round trip to keep the bytes
// behind a session.
//
// GATED ON `load:create`, the same permission the queue itself is. A role that
// cannot see the Incoming list has no business reading its mail.

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params

  try {
    const email = await withCurrentOrg('create', 'load', (tx) =>
      tx.inboundEmail.findFirst({
        where: { id },
        select: { rawR2Key: true, subject: true },
      }),
    )

    // ONE ANSWER FOR "not yours" AND "not there". RLS makes another tenant's
    // id return nothing, and a distinguishable 403 would confirm the row
    // exists — which is exactly the fact worth hiding.
    if (!email?.rawR2Key) {
      return apiError(404, 'not_found', 'No stored original for that message.')
    }

    const bytes = await objectBytes(r2ConfigFromEnv(), email.rawR2Key)
    if (!bytes) {
      // The row says there is one and the bucket disagrees. Named separately
      // because it is an operational fault rather than a wrong id.
      console.error(`[zebra.inbound] missing object ${email.rawR2Key}`)
      return apiError(404, 'not_found', 'The stored original is missing.')
    }

    return new Response(bytes as unknown as BodyInit, {
      headers: {
        'content-type': 'message/rfc822',
        // ATTACHMENT, not inline. A browser asked to render `message/rfc822`
        // does something different in every browser; downloading it hands the
        // file to whatever the person actually reads mail with.
        'content-disposition': `attachment; filename="${filenameFor(email.subject)}"`,
        // Never cached by a shared cache: this is one tenant's mail.
        'cache-control': 'private, no-store',
      },
    })
  } catch (error) {
    const authFailure = authFailureResponse(error)
    if (authFailure) return authFailure

    console.error(
      `[zebra.inbound] original ${id}: ${
        error instanceof Error ? (error.stack ?? error.message) : String(error)
      }`,
    )
    return apiError(500, 'download_failed', 'Could not fetch that message.')
  }
}

/** A subject line as a filename somebody can find again. */
function filenameFor(subject: string | null): string {
  const stem =
    (subject ?? '')
      .replace(/[^A-Za-z0-9._ -]+/g, '')
      .trim()
      .slice(0, 80) || 'message'
  return `${stem}.eml`
}
