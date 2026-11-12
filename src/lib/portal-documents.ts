import type { DocumentType } from '@/generated/prisma/client'
import type { TxClient } from './tenancy'
import { ownDriver, ownLoadsWhere } from './portal'

// ---------------------------------------------------------------------------
// THE DRIVER'S UPLOAD (Phase 7 step 5; §9 "Camera-first upload"; brief §1.3).
//
// What a driver may attach, and to what: one of SEVEN document types, onto a
// load they are on — either seat, because §4.5 lets a co-driver upload what
// they never set the status of. The rate confirmation is the dispatcher's
// and is not in the list; a type outside the seven is refused by name before
// a URL is minted.
//
// THE MINT AND THE CONFIRM ARE THE OFFICE'S OWN (`documents.ts`): the same
// presigned PUT, the same HEAD before the row, the same POD→POD_RECEIVED
// automation. What differs is the gate — `portal.document:create` and these
// two predicates — so the portal's routes are thin and the policy lives here,
// where the integration test reaches it.
// ---------------------------------------------------------------------------

/** The seven, in the order the picker shows them. */
export const PORTAL_DOCUMENT_TYPES = [
  'POD',
  'BOL',
  'LUMPER_RECEIPT',
  'SCALE_TICKET',
  'FUEL_RECEIPT',
  'DETENTION_PROOF',
  'PHOTO',
] as const satisfies readonly DocumentType[]

export type PortalDocumentType = (typeof PORTAL_DOCUMENT_TYPES)[number]

export function isPortalDocumentType(
  value: unknown,
): value is PortalDocumentType {
  return (
    typeof value === 'string' &&
    (PORTAL_DOCUMENT_TYPES as readonly string[]).includes(value)
  )
}

export type UploadTargetOutcome =
  | { ok: true; driverId: string; companyId: string }
  | { ok: false; reason: 'no_driver_row' | 'not_own_load' }

/**
 * May this sign-in attach a document to this load? Own roster row, and the
 * load on either of the driver's seats.
 */
export async function uploadTargetFor(
  tx: TxClient,
  session: { userId: string },
  loadId: string,
): Promise<UploadTargetOutcome> {
  const driver = await ownDriver(tx, session)
  if (!driver) return { ok: false, reason: 'no_driver_row' }
  const load = await tx.load.findFirst({
    where: { id: loadId, ...ownLoadsWhere(driver.id) },
    select: { companyId: true },
  })
  if (!load) return { ok: false, reason: 'not_own_load' }
  return { ok: true, driverId: driver.id, companyId: load.companyId }
}

/**
 * Is this pending upload one the driver minted onto their own load? Read
 * before confirm, so a pending id guessed or borrowed never becomes a row on
 * somebody else's freight.
 */
export async function ownPendingUpload(
  tx: TxClient,
  session: { userId: string },
  pendingUploadId: string,
): Promise<boolean> {
  const pending = await tx.pendingUpload.findUnique({
    where: { id: pendingUploadId },
    select: { targetEntity: true, targetId: true, type: true },
  })
  if (!pending) return false
  if (pending.targetEntity !== 'load' || pending.targetId === null) return false
  if (!isPortalDocumentType(pending.type)) return false
  const target = await uploadTargetFor(tx, session, pending.targetId)
  return target.ok
}
