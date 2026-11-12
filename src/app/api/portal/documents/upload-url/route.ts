import { NextResponse } from 'next/server'
import { withCurrentOrg } from '@/lib/auth-context'
import { DocumentPolicyError, mintUpload } from '@/lib/documents'
import { isPortalDocumentType, uploadTargetFor } from '@/lib/portal-documents'
import { apiError, authFailureResponse, readJson } from '../../../_lib/respond'

// POST /api/portal/documents/upload-url — the driver's presigned PUT.
//
// The office's route asks `document:create` and takes any entity; this one
// asks `portal.document:create`, takes a LOAD the driver is on (either seat)
// and one of the seven portal types, and mints through the same `mintUpload`.
// Authorization happens here and nowhere later: the URL is the capability
// from the moment it exists.

interface Body {
  loadId?: unknown
  filename?: unknown
  mimeType?: unknown
  sizeBytes?: unknown
  sha256?: unknown
  documentType?: unknown
}

export async function POST(request: Request): Promise<Response> {
  const parsed = await readJson<Body>(request)
  if (!parsed.ok) return parsed.response
  const { loadId, filename, mimeType, sizeBytes, sha256, documentType } =
    parsed.value

  if (
    typeof loadId !== 'string' ||
    typeof filename !== 'string' ||
    typeof mimeType !== 'string' ||
    typeof sizeBytes !== 'number' ||
    typeof sha256 !== 'string' ||
    typeof documentType !== 'string'
  ) {
    return apiError(
      400,
      'invalid_body',
      'loadId, filename, mimeType, sizeBytes, sha256 and documentType are required.',
    )
  }
  if (!isPortalDocumentType(documentType)) {
    return apiError(
      400,
      'type_not_allowed',
      'A driver attaches a POD, BOL, lumper receipt, scale ticket, fuel receipt, detention proof or photo.',
    )
  }

  try {
    const minted = await withCurrentOrg(
      'create',
      'portal.document',
      async (tx, session) => {
        const target = await uploadTargetFor(tx, session, loadId)
        if (!target.ok) return null
        return mintUpload(
          tx,
          session.organizationId,
          {
            entity: 'load',
            entityId: loadId,
            filename,
            mimeType,
            sizeBytes,
            sha256Base64: sha256,
            documentType,
          },
          { requestedByUserId: session.userId },
        )
      },
    )
    // Not the driver's load, or no roster row: a 404, the fact worth hiding.
    if (!minted) return apiError(404, 'not_found', 'No such load.')

    return NextResponse.json(
      {
        pendingUploadId: minted.pendingUploadId,
        url: minted.url,
        headers: minted.headers,
        expiresAt: minted.expiresAt.toISOString(),
      },
      { status: 201 },
    )
  } catch (error) {
    const authFailure = authFailureResponse(error)
    if (authFailure) return authFailure
    if (error instanceof DocumentPolicyError) {
      return apiError(400, error.code, error.message)
    }
    throw error
  }
}
