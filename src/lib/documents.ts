import type { DocumentType } from '@/generated/prisma/client'
import type { TxClient } from './tenancy'
import { podConfirmed } from './load-status'
import {
  deleteObject,
  headObject,
  presignGet,
  presignPut,
  r2ConfigFromEnv,
  type R2Config,
} from './r2'

// ---------------------------------------------------------------------------
// DOCUMENT PLUMBING (§9)
//
// Three moments, and the security lives entirely in the first one:
//
//   MINT     verify the caller may attach to this entity, that the entity is
//            in their organization, and that the declared file is within
//            policy — then hand out a URL bound to exactly that file.
//   UPLOAD   browser to R2 directly. The Worker never sees the bytes.
//   CONFIRM  ask R2 what landed, compare it with what was promised, and only
//            then write the Document row.
//
// PHANTOM ROWS. Two failure modes, and they are not symmetric:
//
//   * URL minted, upload never happens → an unconfirmed PendingUpload and no
//     object. Nothing user-visible. Reconciliation sweeps it.
//   * Upload happens, confirm never called → an orphan object in R2 that
//     nothing references. Costs storage; misleads nobody.
//   * Confirm without a successful upload → a Document row pointing at
//     nothing. A user clicks the POD that proves delivery and gets a 404,
//     during a broker dispute.
//
// Only the third is intolerable, so confirm HEADs the object first. We accept
// orphan objects and never accept a row that lies. `Document` means the file
// exists.
// ---------------------------------------------------------------------------

/** Minutes, not hours. The URL is a bearer capability while it lives. */
export const UPLOAD_URL_TTL_SECONDS = 5 * 60

/** Long enough to click, short enough not to be worth passing around. */
export const DOWNLOAD_URL_TTL_SECONDS = 60

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

/**
 * What a driver's phone or a dispatcher's scanner actually produces. An
 * allowlist, because "anything the browser reports" is how a bucket ends up
 * serving HTML from your own domain.
 */
export const ALLOWED_MIME_TYPES: readonly string[] = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/webp',
  'image/tiff',
]

/**
 * Which column a Document hangs off, keyed by the entity name that appears in
 * the R2 key.
 *
 * A closed map rather than a string the caller passes through: it is both the
 * list of legal targets and the list of tables mint is allowed to look in, and
 * one place to add to when Phase 2 attaches documents to something new.
 */
const TARGETS = {
  load: { column: 'loadId', model: 'load' },
  truck: { column: 'truckId', model: 'truck' },
  trailer: { column: 'trailerId', model: 'trailer' },
  driver: { column: 'driverId', model: 'driver' },
  customer: { column: 'customerId', model: 'customer' },
  invoice: { column: 'invoiceId', model: 'invoice' },
  settlement: { column: 'settlementId', model: 'settlement' },
  expense: { column: 'expenseId', model: 'expense' },
  fuelTransaction: { column: 'fuelTransactionId', model: 'fuelTransaction' },
  maintenance: { column: 'maintenanceId', model: 'maintenance' },
  complianceItem: { column: 'complianceItemId', model: 'complianceItem' },
  claim: { column: 'claimId', model: 'claim' },
} as const satisfies Record<string, { column: string; model: string }>

export type TargetEntity = keyof typeof TARGETS

export function isTargetEntity(value: string): value is TargetEntity {
  return Object.hasOwn(TARGETS, value)
}

export class DocumentPolicyError extends Error {
  readonly code:
    | 'unknown_entity'
    | 'entity_not_found'
    | 'file_too_large'
    | 'empty_file'
    | 'mime_not_allowed'
    | 'bad_filename'
    | 'bad_digest'

  constructor(code: DocumentPolicyError['code'], message: string) {
    super(message)
    this.name = 'DocumentPolicyError'
    this.code = code
  }
}

/**
 * Strip a client-supplied filename down to something safe to put in a key and
 * hand back in a Content-Disposition.
 *
 * Path separators, traversal and control characters all go. The uuid in the key
 * is what makes it unique, so this only has to be harmless and recognisable.
 */
export function sanitizeFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? ''
  const cleaned = base
    // An allowlist, so control characters, spaces, quotes, semicolons and
    // anything else that would need escaping in an object key or a
    // Content-Disposition header all collapse to a dash. A denylist here is a
    // list somebody forgets to extend; this one cannot be under-enumerated.
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[.-]+/, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 120)

  return cleaned.length > 0 ? cleaned : 'upload'
}

/**
 * `{organizationId}/{entity}/{entityId}/{uuid}-{filename}`
 *
 * The tenant is the prefix so a bucket-level policy stays expressible — one
 * day a per-organization scoped token is a prefix rule and not a migration.
 */
export function buildObjectKey(input: {
  organizationId: string
  entity: TargetEntity
  entityId: string
  filename: string
  uuid?: string
}): string {
  const uuid = input.uuid ?? crypto.randomUUID()
  return [
    input.organizationId,
    input.entity,
    input.entityId,
    `${uuid}-${sanitizeFilename(input.filename)}`,
  ].join('/')
}

export interface UploadRequest {
  entity: string
  entityId: string
  filename: string
  mimeType: string
  sizeBytes: number
  /** Base64 SHA-256 of the exact bytes, computed by the client. */
  sha256Base64: string
  documentType: DocumentType
}

function assertPolicy(
  request: UploadRequest,
): asserts request is UploadRequest & {
  entity: TargetEntity
} {
  if (!isTargetEntity(request.entity)) {
    throw new DocumentPolicyError(
      'unknown_entity',
      `Cannot attach a document to "${request.entity}".`,
    )
  }
  if (!Number.isInteger(request.sizeBytes) || request.sizeBytes <= 0) {
    throw new DocumentPolicyError('empty_file', 'A file must have a size.')
  }
  if (request.sizeBytes > MAX_UPLOAD_BYTES) {
    throw new DocumentPolicyError(
      'file_too_large',
      `Files are limited to ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB.`,
    )
  }
  if (!ALLOWED_MIME_TYPES.includes(request.mimeType)) {
    throw new DocumentPolicyError(
      'mime_not_allowed',
      `${request.mimeType} is not an accepted file type.`,
    )
  }
  if (
    sanitizeFilename(request.filename) === 'upload' &&
    request.filename.trim() === ''
  ) {
    throw new DocumentPolicyError('bad_filename', 'A file must have a name.')
  }
  // 32 bytes, base64: 44 characters ending in one '='.
  if (!/^[A-Za-z0-9+/]{43}=$/.test(request.sha256Base64)) {
    throw new DocumentPolicyError(
      'bad_digest',
      'sha256 must be a base64 SHA-256 digest.',
    )
  }
}

export interface MintedUpload {
  pendingUploadId: string
  key: string
  url: string
  /** Send these back verbatim on the PUT. The signature covers them. */
  headers: Record<string, string>
  expiresAt: Date
}

/**
 * Authorize, then mint. In that order, and never merged.
 *
 * `tx` is already scoped to the caller's organization by row-level security, so
 * the entity lookup below IS the org check: another tenant's load is not
 * missing-and-forbidden, it is simply not there. That is why this takes a
 * transaction client rather than an organizationId — there is no way to pass
 * the wrong one.
 */
export async function mintUpload(
  tx: TxClient,
  organizationId: string,
  request: UploadRequest,
  options: { requestedByUserId?: string | null; config?: R2Config } = {},
): Promise<MintedUpload> {
  assertPolicy(request)

  const target = TARGETS[request.entity]

  // Read through the tenant-scoped client. A load in another organization
  // returns null here, so no URL is ever minted for it.
  const delegate = (
    tx as unknown as Record<
      string,
      { findUnique(args: unknown): Promise<unknown> }
    >
  )[target.model]
  const entity = (await delegate!.findUnique({
    where: { id: request.entityId },
    select: { id: true, companyId: true },
  })) as { id: string; companyId: string } | null

  if (!entity) {
    throw new DocumentPolicyError(
      'entity_not_found',
      `No ${request.entity} with that id in this organization.`,
    )
  }

  const key = buildObjectKey({
    organizationId,
    entity: request.entity,
    entityId: request.entityId,
    filename: request.filename,
  })

  const config = options.config ?? r2ConfigFromEnv()
  const presigned = await presignPut(config, {
    key,
    sizeBytes: request.sizeBytes,
    contentType: request.mimeType,
    sha256Base64: request.sha256Base64,
    expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
  })

  // Recorded so reconciliation is an indexed query, and so confirm has
  // something to compare against that the client cannot restate.
  const pending = await tx.pendingUpload.create({
    data: {
      organizationId,
      companyId: entity.companyId,
      r2Key: key,
      filename: sanitizeFilename(request.filename),
      mimeType: request.mimeType,
      sizeBytes: request.sizeBytes,
      sha256: request.sha256Base64,
      type: request.documentType,
      targetEntity: request.entity,
      targetId: request.entityId,
      requestedByUserId: options.requestedByUserId ?? null,
      expiresAt: presigned.expiresAt,
    },
    select: { id: true },
  })

  return {
    pendingUploadId: pending.id,
    key,
    url: presigned.url,
    headers: presigned.headers,
    expiresAt: presigned.expiresAt,
  }
}

export class ConfirmError extends Error {
  readonly code: 'unknown_mint' | 'expired' | 'not_uploaded' | 'mismatch'

  constructor(code: ConfirmError['code'], message: string) {
    super(message)
    this.name = 'ConfirmError'
    this.code = code
  }
}

/**
 * Turn a landed object into a Document row.
 *
 * The HEAD is the whole point. Without it, a client that never uploaded — or
 * uploaded something else — still gets a row, and the first person to notice is
 * whoever clicks the POD during a dispute.
 */
export async function confirmUpload(
  tx: TxClient,
  organizationId: string,
  pendingUploadId: string,
  options: { uploadedByUserId?: string | null; config?: R2Config } = {},
): Promise<{ documentId: string; r2Key: string }> {
  // Tenant-scoped: another organization's mint is not found.
  const pending = await tx.pendingUpload.findUnique({
    where: { id: pendingUploadId },
  })

  if (!pending) {
    throw new ConfirmError('unknown_mint', 'No such pending upload.')
  }
  if (pending.expiresAt.getTime() <= Date.now()) {
    throw new ConfirmError(
      'expired',
      'That upload URL has expired. Request another.',
    )
  }

  const config = options.config ?? r2ConfigFromEnv()
  const facts = await headObject(config, pending.r2Key)

  if (!facts) {
    throw new ConfirmError(
      'not_uploaded',
      'Nothing was uploaded to that key. The Document row is not created.',
    )
  }

  // What landed must be what was promised. R2 enforces this by signature at
  // PUT time, so a mismatch here means something stranger than a lying client
  // and is worth refusing loudly.
  if (facts.sizeBytes !== pending.sizeBytes) {
    throw new ConfirmError(
      'mismatch',
      `Uploaded object is ${facts.sizeBytes} bytes, not the ${pending.sizeBytes} that were declared.`,
    )
  }

  const document = await tx.document.create({
    data: {
      organizationId,
      companyId: pending.companyId,
      r2Key: pending.r2Key,
      filename: pending.filename,
      mimeType: pending.mimeType,
      sizeBytes: pending.sizeBytes,
      sha256: facts.checksumSha256 ?? pending.sha256,
      type: pending.type,
      [TARGETS[pending.targetEntity as TargetEntity].column]: pending.targetId,
      uploadedByUserId: options.uploadedByUserId ?? null,
    },
    select: { id: true, r2Key: true },
  })

  // The mint has served its purpose. Deleting it is what keeps the
  // reconciliation query meaningful: what remains is what never landed.
  await tx.pendingUpload.delete({ where: { id: pending.id } })

  // §7: POD received is set automatically when a confirmed Document of type
  // POD attaches, and NEVER by hand. This is that moment — the confirm is
  // what makes the document real, so it is what moves the load.
  //
  // The transition is idempotent and refuses to rewind, which matters here
  // more than anywhere: a confirm retried after a timeout arrives twice, and
  // a POD can be confirmed before the manual Delivered click ever happens.
  // Both are handled by the engine rather than by a condition here.
  if (pending.type === 'POD' && pending.targetEntity === 'load') {
    await podConfirmed(tx, pending.targetId, options.uploadedByUserId ?? null)
  }

  return { documentId: document.id, r2Key: document.r2Key }
}

/**
 * A short-lived read URL for a document the caller is allowed to see.
 *
 * The authorization is the tenant-scoped lookup plus whatever `can()` check the
 * route made. The bucket itself is never public, so this is the only way in.
 */
export async function mintDownloadUrl(
  tx: TxClient,
  documentId: string,
  options: { config?: R2Config } = {},
): Promise<{ url: string; expiresAt: Date; filename: string } | null> {
  const document = await tx.document.findFirst({
    where: { id: documentId, deletedAt: null },
    select: { r2Key: true, filename: true },
  })

  if (!document) return null

  const config = options.config ?? r2ConfigFromEnv()
  const signed = await presignGet(
    config,
    document.r2Key,
    DOWNLOAD_URL_TTL_SECONDS,
    {
      downloadFilename: document.filename,
    },
  )

  return { ...signed, filename: document.filename }
}

export interface ReconciliationResult {
  expiredMints: number
  orphansDeleted: number
  orphansLeft: number
}

/**
 * Sweep mints that expired without being confirmed.
 *
 * An expired mint means one of two things: nothing was uploaded (delete the
 * row, there is nothing else to do) or something was uploaded and never
 * confirmed (an orphan object — delete it too, since no Document will ever
 * reference it).
 *
 * This is an indexed query on `(organizationId, expiresAt)`, not a bucket
 * listing, which is the reason PendingUpload exists as a table.
 */
export async function reconcileExpiredUploads(
  tx: TxClient,
  options: { config?: R2Config; now?: Date; limit?: number } = {},
): Promise<ReconciliationResult> {
  const now = options.now ?? new Date()
  const expired = await tx.pendingUpload.findMany({
    where: { expiresAt: { lt: now } },
    select: { id: true, r2Key: true },
    take: options.limit ?? 200,
  })

  if (expired.length === 0) {
    return { expiredMints: 0, orphansDeleted: 0, orphansLeft: 0 }
  }

  const config = options.config ?? r2ConfigFromEnv()
  let orphansDeleted = 0
  let orphansLeft = 0

  for (const mint of expired) {
    try {
      if (await headObject(config, mint.r2Key)) {
        await deleteObject(config, mint.r2Key)
        orphansDeleted += 1
      }
    } catch {
      // R2 being unreachable must not stop the rows being cleared; the object
      // is garbage only R2 knows about, and the next sweep will find it again
      // only if we keep the row. So count it and leave the row alone.
      orphansLeft += 1
      continue
    }
    await tx.pendingUpload.delete({ where: { id: mint.id } })
  }

  return { expiredMints: expired.length, orphansDeleted, orphansLeft }
}
