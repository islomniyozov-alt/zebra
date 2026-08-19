import type { TxClient } from './tenancy'
import { optionalText, stateCode } from './reference'
import { unambiguousZone } from './stop-time'

// ---------------------------------------------------------------------------
// CREATE-ON-MISS, for the two typeaheads §9 asks for.
//
// The forty-second target is mostly a story about not leaving the form. A
// dispatcher who has to open Brokers in another tab to add "Meridian Freight"
// before they can book the load has already lost the forty seconds, and will
// go back to the old TMS.
//
// So both resolvers take what was TYPED and return an id, creating the row if
// nothing matched. Matching is case- and whitespace-insensitive, because
// "TQL", "tql " and "Tql" are one broker and three rows is the outcome nobody
// wants from a convenience feature.
// ---------------------------------------------------------------------------

/**
 * A stop typed as free text — "Chicago, IL" — into a reusable `Location`.
 *
 * The comma form is what dispatchers already type, so it is what is parsed.
 * Anything without a comma becomes a name with no city, which is still useful:
 * "Ryder Yard 4" is a real place and the city can be filled in later.
 */
export function parsePlace(typed: string): {
  name: string
  city: string | null
  state: string | null
} {
  const name = typed.trim()
  const match = /^(.*?),\s*([A-Za-z]{2})$/.exec(name)
  if (!match) return { name, city: null, state: null }
  return {
    name,
    city: match[1]!.trim() || null,
    state: match[2]!.toUpperCase(),
  }
}

export async function resolveLocation(
  tx: TxClient,
  organizationId: string,
  typed: string,
): Promise<{
  locationId: string
  city: string | null
  state: string | null
  timezone: string | null
}> {
  const place = parsePlace(typed)

  const existing = await tx.location.findFirst({
    where: {
      name: { equals: place.name, mode: 'insensitive' },
      deletedAt: null,
    },
    select: { id: true, city: true, state: true, timezone: true },
  })
  if (existing) {
    return {
      locationId: existing.id,
      city: existing.city,
      state: existing.state,
      timezone: existing.timezone,
    }
  }

  // A miss creates it, which is what makes the SECOND load down this lane
  // fast: the name is in the list next time.
  const created = await tx.location.create({
    data: {
      organizationId,
      name: place.name,
      city: place.city,
      state: place.state,
      // Recorded where the state has exactly one zone; left NULL for the
      // thirteen that do not, so the interface keeps saying "approximate"
      // rather than storing a guess as a fact. See src/lib/stop-time.ts.
      timezone: unambiguousZone(place.state),
    },
    select: { id: true, city: true, state: true, timezone: true },
  })
  return {
    locationId: created.id,
    city: created.city,
    state: created.state,
    timezone: created.timezone,
  }
}

/** The same, for brokers. A miss creates one at the schema's defaults. */
export async function resolveBroker(
  tx: TxClient,
  organizationId: string,
  typed: unknown,
): Promise<string> {
  const name = optionalText(typed)
  if (name === null) {
    throw new Error('A broker is required.')
  }

  const existing = await tx.customer.findFirst({
    where: { name: { equals: name, mode: 'insensitive' }, deletedAt: null },
    select: { id: true },
  })
  if (existing) return existing.id

  const created = await tx.customer.create({
    data: { organizationId, name },
    select: { id: true },
  })
  return created.id
}

export { stateCode }

// ---------------------------------------------------------------------------
// AN ADDRESS, AS ONE LINE, FOR A HUMAN WHO HAS TO SAY IT OUT LOUD.
//
// A facility code is an exact key and it is meaningless to the person driving
// to it. "MEM1" is a row in the location book; "3639 E Holmes Rd, Memphis, TN
// 38118" is a thing you can hand to a driver, read down a phone, or paste into
// a map. The seed put 4,367 of these in the database and no screen showed one.
//
// SHARED RATHER THAN INLINE because more than one surface needs it and two
// implementations of "which parts of an address, in what order" is how two
// screens come to disagree about one dock.
// ---------------------------------------------------------------------------

export interface AddressParts {
  addressLine1?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
}

/**
 * The address on one line, or null when there is nothing to show.
 *
 * WHATEVER IS MISSING IS SIMPLY ABSENT. Most imported facilities have a street
 * and a city; some have only a city and a state; the ones the seed could not
 * read have a street and nothing else. Each of those is a useful sentence and
 * none of them should render a stray comma or the word "null".
 *
 * NULL, NOT THE EMPTY STRING. The caller decides what an absent address looks
 * like — the load detail falls back to the facility code, which is better than
 * a blank line where an address should be.
 */
export function formatAddress(parts: AddressParts | null): string | null {
  if (!parts) return null

  const street = optionalText(parts.addressLine1)
  const city = optionalText(parts.city)
  const state = optionalText(parts.state)
  const postal = optionalText(parts.postalCode)

  // "Hammond, LA 70401" — the postcode belongs to the state, without a comma
  // between them, which is how a US address is written and read aloud.
  const region = [city, [state, postal].filter(Boolean).join(' ') || null]
    .filter(Boolean)
    .join(', ')

  const line = [street, region || null].filter(Boolean).join(', ')
  return line === '' ? null : line
}
