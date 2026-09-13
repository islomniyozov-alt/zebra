import { NextResponse } from 'next/server'
import { withCurrentOrg } from '@/lib/auth-context'
import { DocumentPolicyError, mintUpload } from '@/lib/documents'
import { isCompanyInScope } from '@/lib/tenancy'
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
  /** Which authority a TARGETLESS mint belongs to. Validated against scope. */
  companyId?: unknown
  filename?: unknown
  mimeType?: unknown
  sizeBytes?: unknown
  sha256?: unknown
  documentType?: unknown
  unread?: unknown
}

export async function POST(request: Request): Promise<Response> {
  const parsed = await readJson<Body>(request)
  if (!parsed.ok) return parsed.response

  const {
    entity,
    entityId,
    companyId,
    filename,
    mimeType,
    sizeBytes,
    sha256,
    documentType,
    unread,
  } = parsed.value

  // ENTITY IS OPTIONAL SINCE PHASE 5. Upload-first create mints before the
  // load exists (§1.5); the target arrives at confirm, from the server action
  // that just created it.
  const targetless = entity === undefined && entityId === undefined
  if (targetless && typeof companyId !== 'string') {
    return apiError(
      400,
      'invalid_body',
      'A mint with no entity must name the authority it belongs to.',
    )
  }
  if (
    (!targetless &&
      (typeof entity !== 'string' || typeof entityId !== 'string')) ||
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
    const minted = await withCurrentOrg('create', 'document', (tx, session) => {
      if (
        targetless &&
        !isCompanyInScope(session.companyScopes, companyId as string)
      ) {
        // Out of scope reads as "no such authority" rather than "not yours":
        // the caller is not entitled to learn which authorities exist.
        throw new DocumentPolicyError(
          'entity_not_found',
          'No such authority for this user.',
        )
      }
      return mintUpload(
        tx,
        session.organizationId,
        {
          ...(targetless
            ? {}
            : { entity: entity as string, entityId: entityId as string }),
          filename,
          mimeType,
          sizeBytes,
          sha256Base64: sha256,
          documentType: documentType as DocumentType,
          // THE ONE VALUE A CLIENT MAY ASSERT, and it is the weakest one.
          // Anything else is ignored rather than refused: a client claiming
          // COMPLETED is not a request to honour and not an error worth
          // failing an upload over — it is a claim about a reading that never
          // happened, and dropping it on the floor is the whole answer.
          ...(unread === 'NEEDS_ROTATION'
            ? { unread: 'NEEDS_ROTATION' as const }
            : {}),
        },
        {
          requestedByUserId: session.userId,
          // The authority for a targetless mint. The CLIENT names it — it is
          // the carrier the user picked on the create-load form — and the
          // SERVER checks it is one they may act for. An owner's `companyScopes`
          // is empty, meaning every authority, so taking `[0]` would have
          // produced `undefined` for exactly the role that can do the most.
          companyId: targetless ? (companyId as string) : null,
        },
      )
    })

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
