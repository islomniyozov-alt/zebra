import type { TxClient } from './tenancy'
import { unambiguousZone } from './stop-time'

// ---------------------------------------------------------------------------
// FACILITY MEMORY (Phase 5 §3 step 4).
//
// The same shape as broker aliases and the same restraint (§1.4: "'Learning'
// is data, not ML"): a dock the office has been to before is recognised by its
// address, and what somebody wrote down about it last time — gate code, dock
// notes, hours, check-in instructions, contact — arrives with the address
// instead of being remembered by whoever happens to be on shift.
//
// The value is entirely in the second load down a lane. The first one types
// "Salem, OR" and gets nothing; the fifth one arrives knowing the gate code.
// ---------------------------------------------------------------------------

/**
 * Street types this fold treats as one word.
 *
 * NOT A GENERAL ADDRESS PARSER. This is the specific variance the corpus shows:
 * the same dock printed as "Turner Road SE" on one confirmation and "Turner Rd
 * SE" on the next. Both spellings are the same place and a matcher that misses
 * it teaches the office nothing.
 *
 * A street suffix is safe to canonicalise in a way a COMPANY suffix is not —
 * "ITS Logistics LLC" and "ITS National LLC" are two brokers, while "Turner
 * Road" and "Turner Rd" are one street. That asymmetry is the whole reason
 * this table exists here and nothing like it exists in correction-memory.ts.
 */
const STREET_WORDS: Record<string, string> = {
  ROAD: 'RD',
  STREET: 'ST',
  AVENUE: 'AVE',
  AV: 'AVE',
  BOULEVARD: 'BLVD',
  DRIVE: 'DR',
  LANE: 'LN',
  HIGHWAY: 'HWY',
  PARKWAY: 'PKWY',
  COURT: 'CT',
  PLACE: 'PL',
  TERRACE: 'TER',
  CIRCLE: 'CIR',
  TRAIL: 'TRL',
  EXPRESSWAY: 'EXPY',
  TURNPIKE: 'TPKE',
  SUITE: 'STE',
  BUILDING: 'BLDG',
  NORTH: 'N',
  SOUTH: 'S',
  EAST: 'E',
  WEST: 'W',
  NORTHEAST: 'NE',
  NORTHWEST: 'NW',
  SOUTHEAST: 'SE',
  SOUTHWEST: 'SW',
}

export interface AddressParts {
  addressLine1?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
}

/**
 * The key two documents printing the same dock will agree on — or null.
 *
 * NULL IS THE COMMON ANSWER AND THE IMPORTANT ONE. Most Locations in this
 * system are lane endpoints typed as "Salem, OR": no street, so no key, so no
 * match. A fold that returned something for those would match every load into
 * Salem to the first Salem facility anybody saved, and prefill a gate code for
 * a dock on the other side of town.
 *
 * STREET LINE AND STATE, AND NOTHING ELSE IN THE KEY. The first version put the
 * postal code in it when the document printed one and the city when it did not
 * — which meant the same dock got two different keys depending on whether that
 * broker's template prints zips, and never matched itself. The integration test
 * caught it on the second document.
 *
 * So the key is the coarse part, and the rest of the address is compared in
 * `placeAgrees` where it can be conditional: two values only disagree if BOTH
 * documents printed them. Suite and unit numbers stay in the key — two tenants
 * at one address are two facilities with two gate codes — and directionals are
 * kept and only spelled consistently, because "100 Main St N" and "100 Main
 * St S" are a mile apart.
 */
export function normalizeAddress(parts: AddressParts): string | null {
  const line = fold(parts.addressLine1)
  if (!line) return null

  const state = (parts.state ?? '').trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(state)) return null

  return `${line}|${state}`
}

/** Five digits, or null. ZIP+4 is the same zip. */
function postal5(value: string | null | undefined): string | null {
  const digits = (value ?? '').replace(/\D/g, '').slice(0, 5)
  return digits.length === 5 ? digits : null
}

/**
 * Whether two printings of one street line are the same place.
 *
 * Only what BOTH documents said can disagree. A zip on one and none on the
 * other is not a contradiction — it is the ordinary difference between two
 * brokers' templates — and treating it as one is what kept a dock from
 * recognising itself.
 *
 * The zip wins when both have one, because a document can print "Salem" for a
 * dock that is legally in Keizer and both spell the zip the same way. When
 * neither prints a zip, the city decides: "100 Main St" exists in every town in
 * the state, and two towns are two docks.
 */
export function placeAgrees(a: AddressParts, b: AddressParts): boolean {
  const zipA = postal5(a.postalCode)
  const zipB = postal5(b.postalCode)
  if (zipA && zipB) return zipA === zipB

  const cityA = fold(a.city)
  const cityB = fold(b.city)
  if (cityA && cityB) return cityA === cityB

  // Same street line, same state, and nothing else printed on either. Accepted,
  // and it is the weakest match this makes: it needs both documents to omit the
  // city AND the zip, with a street line that folds identically.
  return true
}

/** Upper, unpunctuated, one space, street words spelled one way. */
function fold(value: string | null | undefined): string {
  if (!value) return ''
  return value
    .toUpperCase()
    .replace(/[.,#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((word) => STREET_WORDS[word] ?? word)
    .join(' ')
}

/** What the office knows about a dock. Every field optional; most are null. */
export interface FacilityMemory {
  gateCode: string | null
  dockNotes: string | null
  hours: string | null
  instructions: string | null
  contactName: string | null
  contactPhone: string | null
  notes: string | null
}

export interface FacilityMatch {
  locationId: string
  name: string
  city: string | null
  state: string | null
  timezone: string | null
  memory: FacilityMemory
  /** True when the office actually wrote something down. */
  hasMemory: boolean
}

const MEMORY_SELECT = {
  id: true,
  name: true,
  city: true,
  state: true,
  timezone: true,
  gateCode: true,
  dockNotes: true,
  hours: true,
  instructions: true,
  contactName: true,
  contactPhone: true,
  notes: true,
} as const

/**
 * The known facility an extracted stop is, if the office has been there.
 *
 * Matched on the folded address and nothing else. Not on name: "Golden State
 * Distribution" and "Golden State Distribution Center" are the same dock and
 * "Ryder Yard 4" is four different ones, so a name match is wrong in both
 * directions — which is exactly the mistake the broker aliases refuse to make
 * for the same reason.
 */
export async function matchFacility(
  tx: TxClient,
  parts: AddressParts,
): Promise<FacilityMatch | null> {
  const normalized = normalizeAddress(parts)
  if (!normalized) return null

  // Candidates, then the conditional half of the comparison. The key is
  // deliberately coarse — street line and state — so this is where "same
  // street, different town" is separated from "same dock, one document
  // printed the zip".
  const candidates = await tx.location.findMany({
    where: { normalizedAddress: normalized, deletedAt: null },
    select: { ...MEMORY_SELECT, postalCode: true },
    // Oldest wins if a duplicate ever appears: it is the one the office has
    // been adding notes to.
    orderBy: { createdAt: 'asc' },
    take: 20,
  })

  const found = candidates.find((candidate) => placeAgrees(candidate, parts))
  return found ? asMatch(found) : null
}

function asMatch(row: {
  id: string
  name: string
  city: string | null
  state: string | null
  timezone: string | null
  gateCode: string | null
  dockNotes: string | null
  hours: string | null
  instructions: string | null
  contactName: string | null
  contactPhone: string | null
  notes: string | null
}): FacilityMatch {
  const memory: FacilityMemory = {
    gateCode: row.gateCode,
    dockNotes: row.dockNotes,
    hours: row.hours,
    instructions: row.instructions,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    notes: row.notes,
  }
  return {
    locationId: row.id,
    name: row.name,
    city: row.city,
    state: row.state,
    timezone: row.timezone,
    memory,
    hasMemory: Object.values(memory).some((value) => Boolean(value)),
  }
}

export interface FacilityInput extends AddressParts {
  name?: string | null
  addressLine2?: string | null
  contactName?: string | null
  contactPhone?: string | null
  instructions?: string | null
}

/**
 * Save a facility the office has not been to before.
 *
 * Only ever called because somebody ticked the box at confirm — §3 says
 * unknown facilities are OFFERED for saving, and the offer is the point. A
 * system that saved every extracted address would fill the list with docks
 * nobody chose, and a list nobody trusts is a list nobody reads.
 *
 * What it saves is what the DOCUMENT said, read from the server's own copy of
 * the extraction. The gate code and the dock notes stay empty: those are what
 * the office learns by going, and inventing them from a rate confirmation
 * would be the "learning" §1.4 rules out.
 *
 * Returns the existing facility instead if one appeared in between — two
 * dispatchers booking the same new lane at the same time is ordinary, and a
 * duplicate dock with half the notes on each is not recoverable by looking.
 */
export async function saveFacility(
  tx: TxClient,
  organizationId: string,
  input: FacilityInput,
): Promise<FacilityMatch | null> {
  const normalized = normalizeAddress(input)
  if (!normalized) return null

  const existing = await matchFacility(tx, input)
  if (existing) return existing

  const name = (input.name ?? '').trim() || placeName(input)
  const state = (input.state ?? '').trim().toUpperCase() || null

  const created = await tx.location.create({
    data: {
      organizationId,
      name,
      addressLine1: (input.addressLine1 ?? '').trim() || null,
      addressLine2: (input.addressLine2 ?? '').trim() || null,
      city: (input.city ?? '').trim() || null,
      state,
      postalCode: (input.postalCode ?? '').trim() || null,
      normalizedAddress: normalized,
      contactName: (input.contactName ?? '').trim() || null,
      contactPhone: (input.contactPhone ?? '').trim() || null,
      // The document's own words for what to do on arrival. A rate
      // confirmation that says "check in at the guard shack" is saying
      // something worth keeping; it is not saying the gate code.
      instructions: (input.instructions ?? '').trim() || null,
      timezone: unambiguousZone(state),
    },
    select: MEMORY_SELECT,
  })
  return asMatch(created)
}

/** "Salem, OR" — a facility with no printed name still needs one. */
function placeName(input: FacilityInput): string {
  const city = (input.city ?? '').trim()
  const state = (input.state ?? '').trim().toUpperCase()
  if (city && state) return `${city}, ${state}`
  return (input.addressLine1 ?? '').trim() || city || state || 'Facility'
}
