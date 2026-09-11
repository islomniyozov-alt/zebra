import { withCurrentOrg } from '@/lib/auth-context'
import { packetForLoad } from '@/lib/factoring-filing'
import type { PacketRefusal } from '@/lib/factoring-packet'
import { objectBytes, r2ConfigFromEnv } from '@/lib/r2'
import { apiError, authFailureResponse } from '../../../_lib/respond'

// GET /api/loads/{id}/packet
//
// The artefact §7 asks for: invoice → POD → BOL → rate confirmation, one PDF.
// Filing is a status; THIS is the thing a person actually sends to the factor,
// so it exists separately and reads without writing — a packet can be looked
// at before the button is pressed and re-opened after.
//
// RENDERED ON DEMAND, like the invoice route beside it and for the same
// reason: page 1 is a pure function of rows that change, and a stored packet
// is one that disagrees with its own invoice the first time anything is
// corrected. The scans are fetched from the bucket each time.
//
// A load in another organization is a 404, not a 403.

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params

  try {
    const config = r2ConfigFromEnv()
    const built = await packetForLoad(
      {
        read: (fn) => withCurrentOrg('read', 'load.financials', (tx) => fn(tx)),
        fetchBytes: (key) => objectBytes(config, key),
      },
      id,
    )

    if (!built.ok) {
      const reason = built.reason
      if (reason.kind === 'load_not_found') {
        return apiError(404, 'not_found', 'No such load.')
      }
      // NAMED, NOT A BARE 409. The whole point of the readiness sentence is
      // that somebody is told which piece to go and get; a route that answers
      // "conflict" sends them back to the screen to guess.
      const detail =
        reason.kind === 'not_ready'
          ? (reason.readiness.because ?? 'The packet is not ready.')
          : reason.kind === 'not_factored'
            ? reason.detail
            : reason.kind === 'already_filed'
              ? 'This load is already filed.'
              : packetDetail(reason)
      return apiError(409, 'not_ready', detail)
    }

    return new Response(built.pdf as BodyInit, {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="${built.filename}"`,
        // Tenant money data behind a permission check. A shared cache holding
        // one is a leak waiting for a second reader.
        'cache-control': 'private, no-store',
      },
    })
  } catch (error) {
    const authFailure = authFailureResponse(error)
    if (authFailure) return authFailure
    throw error
  }
}

/** The assembler's own refusals, said in words. */
function packetDetail(reason: {
  kind: 'packet'
  reason: PacketRefusal
}): string {
  const inner = reason.reason
  if (inner.kind === 'no_pages_from') {
    // THE OWED PIECE, said out loud at the point it bites. A compressed
    // broker rate confirmation contributes no pages today (§7), and the load
    // looks ready the whole time because the document IS on it.
    return `${inner.filename} contributed no pages. Re-save it as a PDF this system can read.`
  }
  if (inner.kind === 'unreadable_image') {
    return `The ${inner.type} could not be read as an image.`
  }
  return 'The packet could not be assembled.'
}
