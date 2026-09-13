import type { TxClient } from './tenancy'

// ---------------------------------------------------------------------------
// THIS DOCUMENT HAS A BETTER COPY, AND HERE IT IS.
//
// ── WHAT IT IS FOR ────────────────────────────────────────────────────────
//
// Rotate-and-read stores the turned card as a NEW object and never touches the
// original, because a document is evidence and DOT retention is statutory. The
// original was then flagged "not read — needs rotation" for ever, nagging about
// work somebody had already done.
//
// ── WHY NOT JUST CHANGE THE ORIGINAL'S STATUS ────────────────────────────
//
// Because it would be a lie about a reading. `ocrStatus` says what happened
// when an engine was asked to read THOSE BYTES, and nothing ever was — the
// engine read a different object. Marking it COMPLETED would put a reading on
// a document that has none; marking it NOT_QUEUED would erase the fact that
// somebody was once asked to turn it.
//
// What is true is narrower and is all this records: a better copy exists.
// ---------------------------------------------------------------------------

export type SupersedeRefusal =
  | 'original_not_found'
  | 'replacement_not_found'
  | 'different_subject'
  | 'self'

export type SupersedeOutcome =
  | { ok: true; alreadyLinked: boolean }
  | { ok: false; reason: SupersedeRefusal }

/**
 * Record that `replacementId` supersedes `originalId`.
 *
 * ── BOTH ROWS ARE READ THROUGH THE TENANT-SCOPED CLIENT ──────────────────
 *
 * The ids arrive from a browser, which makes them claims rather than
 * permissions. Row-level security decides whether they exist to be linked at
 * all, so a document in another organization is `not_found` — the same answer
 * as one that was never there, which is the correct thing to say because
 * distinguishing them would confirm the row.
 *
 * AND THEY MUST BE THE SAME SUBJECT. A link between two unrelated documents
 * would let somebody mark any card superseded by any other, which is a way to
 * silence a compliance warning without doing anything about it. The driver is
 * the thing both ends of this hang off.
 *
 * IDEMPOTENT, because the client may retry. Re-recording the link that already
 * exists is success and says so; pointing at a DIFFERENT replacement overwrites
 * it, because the newest better copy is the one worth having.
 */
export async function supersedeDocument(
  tx: TxClient,
  originalId: string,
  replacementId: string,
): Promise<SupersedeOutcome> {
  // A DOCUMENT CANNOT SUPERSEDE ITSELF. Cheap to check, and the self-relation
  // would otherwise happily record a row that makes the list say a card has
  // been replaced by the card.
  if (originalId === replacementId) return { ok: false, reason: 'self' }

  const original = await tx.document.findFirst({
    where: { id: originalId, deletedAt: null },
    select: { id: true, driverId: true, supersededByDocumentId: true },
  })
  if (!original) return { ok: false, reason: 'original_not_found' }

  const replacement = await tx.document.findFirst({
    where: { id: replacementId, deletedAt: null },
    select: { id: true, driverId: true },
  })
  if (!replacement) return { ok: false, reason: 'replacement_not_found' }

  // BOTH ON THE SAME DRIVER, and a document on NO driver never matches — two
  // nulls are not an agreement about a subject, they are two absences.
  if (
    original.driverId === null ||
    original.driverId !== replacement.driverId
  ) {
    return { ok: false, reason: 'different_subject' }
  }

  if (original.supersededByDocumentId === replacementId) {
    return { ok: true, alreadyLinked: true }
  }

  await tx.document.update({
    where: { id: originalId },
    data: { supersededByDocumentId: replacementId },
  })
  return { ok: true, alreadyLinked: false }
}
