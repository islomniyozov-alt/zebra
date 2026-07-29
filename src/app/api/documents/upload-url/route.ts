import { NextResponse } from 'next/server'
import { withCurrentOrg } from '@/lib/auth-context'
import { DocumentPolicyError, mintUpload } from '@/lib/documents'
import { apiError, authFailureResponse, readJson } from '../../_lib/respond'
import type { DocumentType } from '@/generated/prisma/client'

// POST /api/documents/upload-url — mint a presigned PUT.
//
// Authorization happens here and nowhere later, because the URL is the
// capability from the moment it exists. `withCurrentOrg` checks the permission,
// scopes the transaction to the session's tenant, and attributes the write; the
// entity lookup inside mintUpload runs through that scope, so a load belonging
// to another organization is simply not there.

interface Body {
  entity?: unknown
  entityId?: unknown
  filename?: unknown
  mimeType?: unknown
  sizeBytes?: unknown
  sha256?: unknown
  documentType?: unknown
}

export async function POST(request: Request): Promise<Response> {
  const parsed = await readJson<Body>(request)
  if (!parsed.ok) return parsed.response

  const {
    entity,
    entityId,
    filename,
    mimeType,
    sizeBytes,
    sha256,
    documentType,
  } = parsed.value

  if (
    typeof entity !== 'string' ||
    typeof entityId !== 'string' ||
    typeof filename !== 'string' ||
    typeof mimeType !== 'string' ||
    typeof sizeBytes !== 'number' ||
    typeof sha256 !== 'string' ||
    typeof documentType !== 'string'
  ) {
    return apiError(
      400,
      'invalid_body',
      'entity, entityId, filename, mimeType, sizeBytes, sha256 and documentType are required.',
    )
  }

  try {
    const minted = await withCurrentOrg('create', 'document', (tx, session) =>
      mintUpload(
        tx,
        session.organizationId,
        {
          entity,
          entityId,
          filename,
          mimeType,
          sizeBytes,
          sha256Base64: sha256,
          documentType: documentType as DocumentType,
        },
        { requestedByUserId: session.userId },
      ),
    )

    return NextResponse.json(
      {
        pendingUploadId: minted.pendingUploadId,
        url: minted.url,
        // Not advisory. The signature covers these, so a PUT that omits or
        // changes one is refused by R2 before a byte is stored.
        headers: minted.headers,
        expiresAt: minted.expiresAt.toISOString(),
      },
      { status: 201 },
    )
  } catch (error) {
    const authFailure = authFailureResponse(error)
    if (authFailure) return authFailure

    if (error instanceof DocumentPolicyError) {
      // entity_not_found covers "no such id" and "belongs to another tenant"
      // alike. The caller must not be able to tell them apart.
      return apiError(
        error.code === 'entity_not_found' ? 404 : 422,
        error.code,
        error.message,
      )
    }
    throw error
  }
}
