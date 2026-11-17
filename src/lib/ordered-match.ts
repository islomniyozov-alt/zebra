// ---------------------------------------------------------------------------
// ONE MATCHER, AN ORDERED LIST OF KEYS (MONEY-DESIGN §2, amended 2026-11-17).
//
// Both Amazon importers ask the same question — which record does this value
// in the file mean? — and both must answer it the same way:
//
//   * the keys are tried IN ORDER, and the first key that finds anything
//     DECIDES: one hit is a match, recorded with the key that made it;
//   * two or more hits on that key are AMBIGUOUS, refused with every
//     candidate, and NOT passed on to the next key — a later key "breaking the
//     tie" would be a guess about which of two trucks drove, dressed as a rule;
//   * no hit on any key is `none`.
//
// A seat filled by a guess is money paid to somebody who did not drive, which
// is the posture `trips-crew.ts` already states for names.
// ---------------------------------------------------------------------------

/** One key: its name, and what it resolves a value to (ids, any number). */
export interface MatchKey<K extends string> {
  key: K
  idsFor: (value: string) => readonly string[]
}

export type KeyedMatch<K extends string> =
  | { kind: 'one'; id: string; key: K }
  | { kind: 'ambiguous'; ids: readonly string[]; key: K }
  | { kind: 'none' }

export function matchByKeys<K extends string>(
  value: string,
  keys: readonly MatchKey<K>[],
): KeyedMatch<K> {
  for (const { key, idsFor } of keys) {
    const ids = [...new Set(idsFor(value))]
    if (ids.length === 1) return { kind: 'one', id: ids[0]!, key }
    if (ids.length > 1) return { kind: 'ambiguous', ids, key }
  }
  return { kind: 'none' }
}

/**
 * A licence plate as both sides are compared on: upper case, no spaces, no
 * dashes. `ABC-1234`, `abc 1234` and `ABC1234` are one plate; the state is
 * not part of it (the Relay column prints none).
 */
export function plateKey(value: string): string {
  return value.toUpperCase().replace(/[\s-]+/g, '')
}
