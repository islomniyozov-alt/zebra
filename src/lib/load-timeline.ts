// ---------------------------------------------------------------------------
// ONE TIMELINE, OUT OF TWO TABLES.
//
// A load's history is `LoadStatusEvent` rows and `Communication` rows of type
// NOTE. Both carry `occurredAt` and an author, so they interleave with nothing
// invented — item 8 asked for one timeline and this is the whole of what that
// costs.
//
// IT LIVES HERE RATHER THAN IN THE PAGE for the reason flag 85 records: a
// server component has a screen, not a guard. The thing that can silently go
// wrong is the ORDER, and an order that is subtly wrong looks exactly like an
// order that is right — the entries are all present, all real, and reading in
// a sequence nobody checked.
//
// THE PARTICULAR TRAP: by the time an entry reaches the component its time is a
// RENDERED STRING — "Sep 2, 8:04 PM". Sorting those is alphabetical order
// wearing a chronology's clothes, and it is stable, plausible and wrong. So the
// sort happens while the times are still Dates and the rendered string is never
// the sort key.
// ---------------------------------------------------------------------------

/** A thing to be placed on the timeline, with the instant it happened. */
export interface Timed<T> {
  at: Date
  value: T
}

/**
 * Every group merged, newest first.
 *
 * STABLE WITHIN A TIE, and the tie is not hypothetical: a status event and the
 * note explaining it are written in the same transaction and can land on the
 * same millisecond. Ties keep the order the groups were passed in, so the
 * caller decides which reads first and gets the same answer on every render —
 * a timeline that reshuffles between page loads is one nobody trusts.
 *
 * `Array.prototype.sort` is specified as stable, so this relies on the language
 * rather than on a comparator that pretends to break ties it cannot see.
 */
export function newestFirst<T>(
  ...groups: readonly (readonly Timed<T>[])[]
): T[] {
  return groups
    .flat()
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .map((entry) => entry.value)
}
