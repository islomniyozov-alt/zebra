import type { TxClient } from './tenancy'

// ---------------------------------------------------------------------------
// A FACILITY CODE IS AN EXACT KEY, AND THAT IS THE WHOLE POINT OF IT.
//
// `facility-memory.ts` matches ADDRESSES, and it is careful and fuzzy because
// it has to be: "11077 US-190" and "11077 US Highway 190" and "11077 Hwy 190"
// are one dock written three ways, and a matcher that demanded equality would
// mint a new location every week.
//
// A CODE IS NOT LIKE THAT. "MEM1" is Memphis 1 or it is a different building.
// There is no near-miss to be generous about, so this file does no
// normalising beyond trimming: a code that differs by a character IS a
// different code, and pretending otherwise would attach a load to the wrong
// dock silently.
//
// WHERE THEY COME FROM: the carrier's own Datatruck export calls the column
// "Company" and fills it with the code Relay paperwork prints — "MEM1",
// "DXH5", "KCDC_WAR_740370001_656". So a trip CSV and a dispatcher reading a
// booking email both have this string in hand when nothing else agrees.
//
// CASE IS PRESERVED, NOT FOLDED. Every code in the 3,599-row export is upper
// case, and lowering or uppering here would be a rule invented for data that
// has never needed it. If a lower-case code ever arrives, that is a fact worth
// seeing rather than one worth hiding.
// ---------------------------------------------------------------------------

/**
 * The code as it will be stored and compared, or null if there is no code.
 *
 * Trimming only. Empty and whitespace-only are ABSENCE, not a code — the
 * export has 423 rows with no facility at all, and a row that stored `""`
 * would take the one unique slot a null can never occupy.
 */
export function facilityCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * The location this code names, or null.
 *
 * Scoped by the caller's transaction, so row-level security answers "whose
 * facility?" before this function ever sees a row.
 */
export async function locationByFacilityCode(
  tx: TxClient,
  code: unknown,
): Promise<{
  id: string
  name: string
  addressLine1: string | null
  city: string | null
  state: string | null
  postalCode: string | null
} | null> {
  const exact = facilityCode(code)
  if (exact === null) return null

  return tx.location.findFirst({
    where: { facilityCode: exact, deletedAt: null },
    select: {
      id: true,
      name: true,
      addressLine1: true,
      city: true,
      state: true,
      postalCode: true,
    },
  })
}

// ---------------------------------------------------------------------------
// THE SEED'S PARSING, HERE RATHER THAN IN THE SCRIPT.
//
// The script is a one-time import; these rules are not. The trips importer
// meets the same address strings in its own CSVs, and a second implementation
// of "which part of this is the street" is how two importers come to disagree
// about one dock.
// ---------------------------------------------------------------------------

/** Full state names to the two-letter code `Location.state` actually holds. */
const STATE_CODES: Record<string, string> = {
  alabama: 'AL',
  alaska: 'AK',
  arizona: 'AZ',
  arkansas: 'AR',
  california: 'CA',
  colorado: 'CO',
  connecticut: 'CT',
  delaware: 'DE',
  'district of columbia': 'DC',
  florida: 'FL',
  georgia: 'GA',
  hawaii: 'HI',
  idaho: 'ID',
  illinois: 'IL',
  indiana: 'IN',
  iowa: 'IA',
  kansas: 'KS',
  kentucky: 'KY',
  louisiana: 'LA',
  maine: 'ME',
  maryland: 'MD',
  massachusetts: 'MA',
  michigan: 'MI',
  minnesota: 'MN',
  mississippi: 'MS',
  missouri: 'MO',
  montana: 'MT',
  nebraska: 'NE',
  nevada: 'NV',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'north carolina': 'NC',
  'north dakota': 'ND',
  ohio: 'OH',
  oklahoma: 'OK',
  oregon: 'OR',
  pennsylvania: 'PA',
  'rhode island': 'RI',
  'south carolina': 'SC',
  'south dakota': 'SD',
  tennessee: 'TN',
  texas: 'TX',
  utah: 'UT',
  vermont: 'VT',
  virginia: 'VA',
  washington: 'WA',
  'west virginia': 'WV',
  wisconsin: 'WI',
  wyoming: 'WY',
  'puerto rico': 'PR',
}

/**
 * A state as the two letters this schema stores, or null.
 *
 * TWO LETTERS IN, TWO LETTERS OUT. The export writes "Louisiana"; the column
 * holds "LA"; a trip CSV may write either. Anything that is neither a known
 * name nor a two-letter code is null rather than a guess — flag 11's lesson,
 * where slicing "Texas" to "TE" produced a state that does not exist and
 * nothing noticed.
 */
export function stateCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '') return null

  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase()
  return STATE_CODES[trimmed.toLowerCase()] ?? null
}

export interface ParsedAddress {
  addressLine1: string | null
  postalCode: string | null
}

/**
 * The street and the postcode out of a formatted address.
 *
 * The export's `address` is one Google-shaped string — "11077 US-190,
 * Hammond, LA 70401, USA" — while the schema keeps the parts separate. City
 * and state arrive in their own columns and are trusted from there; only these
 * two have to be recovered.
 *
 * CONSERVATIVE ON PURPOSE. The street is what precedes the first comma, which
 * is true of every row in the export and of Google's format generally. A
 * postcode is taken only when it looks like one. Anything this cannot read
 * stays null, because a wrong street on a dock is worse than a missing one —
 * a driver can be told an address that is absent and cannot be told one that
 * is confidently wrong.
 */
export function parseSeedAddress(address: unknown): ParsedAddress {
  if (typeof address !== 'string' || address.trim() === '') {
    return { addressLine1: null, postalCode: null }
  }

  const parts = address.split(',').map((part) => part.trim())
  const street = parts[0] ?? ''
  // THE ZIP IS THE ONE AFTER THE STATE, not the first five digits in the
  // string. A dry run over the real export caught this: "11077 US-190,
  // Hammond, LA 70401, USA" gave 11077 — the STREET NUMBER — as a
  // postcode, and it would have done so for 451 of 3,383 rows. Anchoring
  // on the two-letter state is what makes it the postcode rather than a
  // number that happens to be five digits long.
  // THE COMMA IS OPTIONAL because the two exports disagree about it. The
  // Datatruck file writes "Hammond, LA 70401"; the Amazon delta writes
  // "Seattle, WA, 98121". Requiring whitespace alone lost the postcode on 11
  // measured rows of the second file while correctly refusing 57 others whose
  // only five-digit run was a street number.
  const zip = /\b[A-Za-z]{2},?\s+(\d{5})(?:-\d{4})?\b/.exec(address)

  return {
    addressLine1: street === '' ? null : street,
    postalCode: zip?.[1] ?? null,
  }
}
