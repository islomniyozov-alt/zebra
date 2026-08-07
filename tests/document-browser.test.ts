import { describe, expect, it } from 'vitest'
import {
  BROWSER_ENTITIES,
  ENTITY_RESOURCE,
  permissionWhere,
  readableEntities,
} from '@/lib/document-browser'
import { TARGETS } from '@/lib/documents'
import { RESOURCES, type AuthorizedSession } from '@/lib/permissions'
import type { Role } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE THIRD WALL.
//
// Postgres decides the tenant, `companyScopeFilter` decides the authority, and
// this decides the KIND. It is the only one of the three that varies row by row
// on a single screen, and the failure it prevents is specific: a settlement PDF
// listed next to a rate confirmation is a dispatcher reading driver pay.
// ---------------------------------------------------------------------------

const session = (role: Role): AuthorizedSession => ({
  userId: 'u',
  organizationId: 'o',
  role,
  companyScopes: [],
})

describe('the entity-to-resource map', () => {
  it('covers every place a document can hang', () => {
    // Keyed off TARGETS so the two cannot drift. A new attachment target that
    // nobody maps would otherwise fall out of `readableEntities` — and a
    // document hanging off it would be invisible to everyone, or worse,
    // visible to everyone depending on how the omission was written.
    expect([...BROWSER_ENTITIES].sort()).toEqual(Object.keys(TARGETS).sort())
  })

  it('names only resources that exist', () => {
    const known = new Set<string>(RESOURCES)
    for (const entity of BROWSER_ENTITIES) {
      expect(known.has(ENTITY_RESOURCE[entity]), entity).toBe(true)
    }
  })
})

describe('what a dispatcher may browse', () => {
  const allowed = readableEntities(session('DISPATCHER'))

  it('includes the things they work on all day', () => {
    // They upload PODs and read compliance dates; hiding those would make the
    // screen useless to the role most likely to open it.
    expect(allowed).toContain('load')
    expect(allowed).toContain('truck')
    expect(allowed).toContain('driver')
    expect(allowed).toContain('complianceItem')
    expect(allowed).toContain('inspection')
  })

  it('and excludes every kind that carries money or a dispute', () => {
    // THE PAIR. A settlement PDF is driver pay in a wrapper; an invoice is the
    // rate. Neither is theirs, and §2.5 does not put claims on their list.
    expect(allowed).not.toContain('settlement')
    expect(allowed).not.toContain('invoice')
    expect(allowed).not.toContain('expense')
    expect(allowed).not.toContain('fuelTransaction')
    expect(allowed).not.toContain('claim')
    expect(allowed).not.toContain('dataQs')
  })

  it('while an owner may browse all of them', () => {
    // Without this, "the dispatcher sees eight kinds" could be satisfied by a
    // map that hid the other six from everybody.
    expect(readableEntities(session('OWNER')).sort()).toEqual(
      [...BROWSER_ENTITIES].sort(),
    )
  })
})

describe('the WHERE clause it produces', () => {
  it('names one column per readable kind', () => {
    const where = permissionWhere(session('DISPATCHER'))
    const columns = (where.OR as Record<string, unknown>[]).map(
      (clause) => Object.keys(clause)[0],
    )

    expect(columns).toContain('loadId')
    expect(columns).toContain('truckId')
    // The one that matters: no column for the kinds they cannot read, so the
    // rows are not in the result set at all rather than fetched and filtered.
    expect(columns).not.toContain('settlementId')
    expect(columns).not.toContain('invoiceId')
  })

  it('matches NOTHING for a session that may read no kind at all', () => {
    // A DRIVER holds nothing in the operator vocabulary. `{}` here would list
    // every document in the tenant, which is the exact failure this function
    // exists to prevent — so the empty case is written out rather than left to
    // fall through.
    const where = permissionWhere(session('DRIVER'))
    expect(where).toEqual({ id: { equals: '' } })
    expect(where.OR).toBeUndefined()
  })

  it('and for no session at all', () => {
    expect(permissionWhere(null)).toEqual({ id: { equals: '' } })
    expect(readableEntities(undefined)).toEqual([])
  })
})
