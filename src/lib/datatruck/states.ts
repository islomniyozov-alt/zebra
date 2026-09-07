// ---------------------------------------------------------------------------
// STATE NAMES AS THE DATATRUCK EXPORTS SPELL THEM.
//
// NOT `stateCode`, AND THIS IS THE WHOLE REASON THE FILE EXISTS. The shared
// helper TRUNCATES to two characters — right on a stop label, silently wrong
// here. "Texas" through it is "TE": a plate state that matches no
// registration, and a CDL state that matches no licensing authority.
// `companies.ts` records the same hazard on the same helper and refuses rather
// than shortens.
//
// ONE TABLE, TWO IMPORTERS. The trucks export spells three states out and the
// drivers export spells eight, overlapping. Two tables would be two places to
// add Wisconsin to, and one of them would get missed.
//
// IT IS A TABLE, NOT A RULE. Nothing here infers a state from a phone number,
// an authority, or the first two letters of anything. A spelling that is not
// written below is refused and named in the seed report, because the cost of
// getting this wrong is a compliance lookup against the wrong state and the
// cost of refusing is one line in a report somebody reads.
// ---------------------------------------------------------------------------

/** Every spelling seen in the two exports, upper-cased for lookup. */
const BY_NAME: Readonly<Record<string, string>> = {
  ALABAMA: 'AL',
  COLORADO: 'CO',
  FLORIDA: 'FL',
  ILLINOIS: 'IL',
  'NEW JERSEY': 'NJ',
  'NEW YORK': 'NY',
  OHIO: 'OH',
  OKLAHOMA: 'OK',
  TEXAS: 'TX',
}

export type StateResult =
  | { ok: true; code: string; rewritten: boolean }
  | { ok: false; raw: string }

/**
 * A two-letter code from whatever the export holds.
 *
 * A two-letter input is upper-cased and passed through — it is already a code,
 * and validating it against a list of the fifty would refuse a territory this
 * table has no opinion about. Anything longer must be in the table by name.
 */
export function resolveState(raw: string | null | undefined): StateResult {
  const value = (raw ?? '').trim()
  if (value === '') return { ok: false, raw: value }

  if (/^[A-Za-z]{2}$/.test(value)) {
    return { ok: true, code: value.toUpperCase(), rewritten: false }
  }

  const code = BY_NAME[value.toUpperCase().replace(/\s+/g, ' ')]
  if (!code) return { ok: false, raw: value }
  return { ok: true, code, rewritten: true }
}
