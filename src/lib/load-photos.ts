import type { PhotoStage } from '@/generated/prisma/client'
import type { TxClient } from './tenancy'

// ---------------------------------------------------------------------------
// THE BROKER LOAD'S TWO PHOTO FOLDERS (TMS §7.14 item 4; migration 76).
//
// A photo is a `PHOTO` document; its folder is `Document.photoStage`. One
// grouping, here, read by the page; one writer, here, called after an upload
// lands in a folder. A photo with no stage belongs to neither folder and is
// left where it always was — in Documents — rather than guessed into one.
// ---------------------------------------------------------------------------

export const PHOTO_STAGES = [
  'PICKUP',
  'DELIVERY',
] as const satisfies readonly PhotoStage[]

/** The load's live photos by folder, newest first as given. */
export function photoFolders<
  T extends {
    type: string
    photoStage: PhotoStage | null
    deletedAt: Date | null
  },
>(documents: readonly T[]): Record<PhotoStage, T[]> {
  const folders: Record<PhotoStage, T[]> = { PICKUP: [], DELIVERY: [] }
  for (const document of documents) {
    if (document.type !== 'PHOTO' || document.deletedAt !== null) continue
    if (document.photoStage === null) continue
    folders[document.photoStage].push(document)
  }
  return folders
}

export function isPhotoStage(value: string): value is PhotoStage {
  return (PHOTO_STAGES as readonly string[]).includes(value)
}

export type SetPhotoStageOutcome =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'not_a_photo' | 'bad_stage' }

/**
 * File one of THIS load's photos into a folder. Refused for a document on
 * another load, one that is not a photo, or a stage that is not a folder — so
 * a stale page or a hand-built request cannot re-file a POD as a photo.
 */
export async function setPhotoStage(
  tx: TxClient,
  loadId: string,
  documentId: string,
  stage: string,
): Promise<SetPhotoStageOutcome> {
  if (!isPhotoStage(stage)) return { ok: false, reason: 'bad_stage' }
  const document = await tx.document.findFirst({
    where: { id: documentId, loadId, deletedAt: null },
    select: { id: true, type: true },
  })
  if (!document) return { ok: false, reason: 'not_found' }
  if (document.type !== 'PHOTO') return { ok: false, reason: 'not_a_photo' }
  await tx.document.update({
    where: { id: documentId },
    data: { photoStage: stage },
  })
  return { ok: true }
}
