import { withCurrentOrg } from '@/lib/auth-context'
import {
  invoicePacketForLoad,
  invoicePacketRefusalDetail,
} from '@/lib/invoice-packet-store'
import { objectBytes, putObject, r2ConfigFromEnv } from '@/lib/r2'
import { apiError, authFailureResponse } from '../../../_lib/respond'

// GET /api/loads/{id}/invoice-packet — Merge download (TMS §7.14 item 5).
//
// POD photos, the POD and BOL PDFs, the rate con, then the invoice when one
// exists: one PDF, stored as the load's `INVOICE_PACKET` once per inputs
// (R4). A GET that may write, and safe to repeat for exactly that reason:
// the same inputs answer with the stored packet and write nothing, so a
// second click, a reload or a prefetch never makes a second packet.
//
// Read under `load.financials` — the packet carries the invoice and the rate
// con, both money — and stored under `document:create`. The network sits
// between the two transactions, never inside one (`assertOutsideTransaction`).
//
// A load in another organization is a 404, not a 403.

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params

  try {
    const config = r2ConfigFromEnv()
    const outcome = await invoicePacketForLoad(
      {
        read: (fn) => withCurrentOrg('read', 'load.financials', (tx) => fn(tx)),
        write: (fn) =>
          withCurrentOrg('create', 'document', (tx, session) =>
            fn(tx, session.userId),
          ),
        fetchBytes: (key) => objectBytes(config, key),
        putBytes: (key, bytes) =>
          putObject(config, key, bytes, 'application/pdf'),
        newId: () => crypto.randomUUID(),
      },
      id,
    )

    if (!outcome.ok) {
      if (outcome.reason.kind === 'load_not_found') {
        return apiError(404, 'not_found', 'No such load.')
      }
      // NAMED, NOT A BARE 409: which piece to go and get, or why not.
      return apiError(
        409,
        'not_ready',
        invoicePacketRefusalDetail(outcome.reason),
      )
    }

    return new Response(outcome.pdf as BodyInit, {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${outcome.filename}"`,
        // Tenant money data behind a permission check.
        'cache-control': 'private, no-store',
      },
    })
  } catch (error) {
    const authFailure = authFailureResponse(error)
    if (authFailure) return authFailure
    throw error
  }
}
