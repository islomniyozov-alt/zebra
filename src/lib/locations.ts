import type { TxClient } from './tenancy'
import { optionalText, stateCode } from './reference'

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
): Promise<{ locationId: string; city: string | null; state: string | null }> {
  const place = parsePlace(typed)

  const existing = await tx.location.findFirst({
    where: {
      name: { equals: place.name, mode: 'insensitive' },
      deletedAt: null,
    },
    select: { id: true, city: true, state: true },
  })
  if (existing) {
    return {
      locationId: existing.id,
      city: existing.city,
      state: existing.state,
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
    },
    select: { id: true, city: true, state: true },
  })
  return { locationId: created.id, city: created.city, state: created.state }
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
