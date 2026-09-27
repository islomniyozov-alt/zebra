// ---------------------------------------------------------------------------
// THE KEY TWO SYSTEMS COMPARE A NAME ON.
//
// ── WHY THIS IS A MODULE AND NOT A ONE-LINER IN EACH IMPORTER ─────────────
//
// It was a one-liner in each importer, and the second one was written
// UPPER-CASING while the first lower-cased. Both are correct on their own and
// the pair is not: two importers that normalise a name differently seat the
// same person on one path and refuse them on the other, and the failure is
// invisible because each side agrees with itself. The Datatruck seed matches
// drivers, trucks, customers and companies through this; the Relay trips
// import matches drivers and tractors through it.
//
// A COMMENT SAYING "THE SAME KEY THE OTHER IMPORTER USES" IS NOT THAT KEY.
// That comment was written, and it was false the moment it was written. The
// durable form of the claim is one function both sides call.
//
// TRIM, THEN COLLAPSE, THEN FOLD CASE — in that order, because collapsing
// before trimming leaves a single leading space. Nothing else: no initial
// expansion, no punctuation stripping, no surname reordering. Every one of
// those would make two different people compare equal, and the importers'
// whole posture is that an ambiguous match is refused rather than guessed.
// ---------------------------------------------------------------------------

/** A name or unit number reduced to what a match may compare. */
export function nameKey(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase()
}
