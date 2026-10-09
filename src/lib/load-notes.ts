import type { TxClient } from './tenancy'

// ---------------------------------------------------------------------------
// A LOAD'S NOTES, FOR THE LOADS LIST'S ROW EXPAND (TMS-DESIGN-SYSTEM.md §6.7
// item 8).
//
// A note is a `Communication` of type NOTE on the load — what the load
// detail's note composer writes and its timeline shows (§7.10). Read when the
// row opens rather than for every row on every render, because a hundred rows
// of notes would be a statement nobody asked for.
// ---------------------------------------------------------------------------

export interface LoadNote {
  id: string
  body: string
  /** ISO instant; the client renders it. */
  at: string
  author: string | null
}

/** How many notes the expand shows. The load detail has the rest. */
export const EXPAND_NOTE_LIMIT = 5

/** The newest notes on a load, newest first. RLS walls it to the org. */
export async function recentLoadNotes(
  tx: TxClient,
  loadId: string,
  limit: number = EXPAND_NOTE_LIMIT,
): Promise<LoadNote[]> {
  const notes = await tx.communication.findMany({
    where: { loadId, type: 'NOTE' },
    orderBy: { occurredAt: 'desc' },
    take: limit,
    select: {
      id: true,
      body: true,
      occurredAt: true,
      user: { select: { name: true } },
    },
  })
  return notes.map((note) => ({
    id: note.id,
    body: note.body,
    at: note.occurredAt.toISOString(),
    author: note.user?.name ?? null,
  }))
}
