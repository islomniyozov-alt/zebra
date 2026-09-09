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
// ONE TABLE, FOUR IMPORTERS NOW — trucks, drivers, terminated drivers and the
// load history. Two tables would be two places to add Wisconsin to, and one of
// them would get missed. Which is exactly what nearly happened: the table held
// the nine states the fleet rosters mentioned, and the load import needed all
// fifty.
//
// IT IS A TABLE, NOT A RULE. Nothing here infers a state from a phone number,
// an authority, or the first two letters of anything. A spelling that is not
// written below is refused and named in the seed report, because the cost of
// getting this wrong is a compliance lookup against the wrong state and the
// cost of refusing is one line in a report somebody reads.
// ---------------------------------------------------------------------------

/**
 * Every US state and territory, by name.
 *
 * ── IT WAS NINE ENTRIES AND THAT WAS ENOUGH UNTIL IT WAS NOT ──────────────
 *
 * The table began as "every spelling seen in the two exports" — three states
 * from the trucks file and eight from the drivers file. That was honest for a
 * fleet roster, where a state appears only where somebody is licensed.
 *
 * THE LOAD HISTORY IS A MAP OF THE COUNTRY. 14,451 loads pick up and deliver
 * in every state the group has ever run, and 4,208 of those stops carry their
 * state ONLY in the spelled-out column — so a missing name is not a refusal
 * anybody reads, it is a stop filed with no state at all. `Tennessee`,
 * `Nebraska` and `Michigan` were all missing, each found by a test rather than
 * by a report.
 *
 * SO IT IS COMPLETE NOW, rather than complete-for-what-we-have-seen. The list
 * is closed and public: fifty states, the District of Columbia, and the five
 * inhabited territories a DOT-regulated carrier can be licensed in. Adding
 * every one costs nothing and removes the class of bug entirely — which is
 * better than a table that is correct until the fleet takes a load to Maine.
 *
 * STILL A TABLE, NOT A RULE. Nothing here infers a state from a phone number,
 * an authority, or the first two letters of anything.
 */
const BY_NAME: Readonly<Record<string, string>> = {
  ALABAMA: 'AL',
  ALASKA: 'AK',
  ARIZONA: 'AZ',
  ARKANSAS: 'AR',
  CALIFORNIA: 'CA',
  COLORADO: 'CO',
  CONNECTICUT: 'CT',
  DELAWARE: 'DE',
  'DISTRICT OF COLUMBIA': 'DC',
  FLORIDA: 'FL',
  GEORGIA: 'GA',
  HAWAII: 'HI',
  IDAHO: 'ID',
  ILLINOIS: 'IL',
  INDIANA: 'IN',
  IOWA: 'IA',
  KANSAS: 'KS',
  KENTUCKY: 'KY',
  LOUISIANA: 'LA',
  MAINE: 'ME',
  MARYLAND: 'MD',
  MASSACHUSETTS: 'MA',
  MICHIGAN: 'MI',
  MINNESOTA: 'MN',
  MISSISSIPPI: 'MS',
  MISSOURI: 'MO',
  MONTANA: 'MT',
  NEBRASKA: 'NE',
  NEVADA: 'NV',
  'NEW HAMPSHIRE': 'NH',
  'NEW JERSEY': 'NJ',
  'NEW MEXICO': 'NM',
  'NEW YORK': 'NY',
  'NORTH CAROLINA': 'NC',
  'NORTH DAKOTA': 'ND',
  OHIO: 'OH',
  OKLAHOMA: 'OK',
  OREGON: 'OR',
  PENNSYLVANIA: 'PA',
  'RHODE ISLAND': 'RI',
  'SOUTH CAROLINA': 'SC',
  'SOUTH DAKOTA': 'SD',
  TENNESSEE: 'TN',
  TEXAS: 'TX',
  UTAH: 'UT',
  VERMONT: 'VT',
  VIRGINIA: 'VA',
  WASHINGTON: 'WA',
  'WEST VIRGINIA': 'WV',
  WISCONSIN: 'WI',
  WYOMING: 'WY',
  'PUERTO RICO': 'PR',
  GUAM: 'GU',
  'AMERICAN SAMOA': 'AS',
  'U.S. VIRGIN ISLANDS': 'VI',
  'VIRGIN ISLANDS': 'VI',
  'NORTHERN MARIANA ISLANDS': 'MP',
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
