import { describe, expect, it } from 'vitest'
import {
  addCompany,
  deleteCompany,
  retiredRemovalRefusal,
  SPENDS_CAP,
  spendsCap,
} from '@/lib/companies'
import { can, type AuthorizedSession } from '@/lib/permissions'
import type { Role } from '@/generated/prisma/client'
import type { TxClient } from '@/lib/tenancy'

// ---------------------------------------------------------------------------
// THE AUTHORITY CAP COUNTS WORKING AUTHORITIES, AND A RETIRED PLACEHOLDER IS
// THE OWNER'S TO REMOVE (TMS §6.3 v11.40; owner's ruling 2026-11-21).
//
// Dev's Authorities page read "5 of 5 used" with three of the five Retired
// placeholders, so the group could not add the next authority it runs under.
// These tests drive `addCompany` and `deleteCompany` through a recording
// transaction and read what each asked the database, so a count that goes
// back to every row, or a delete that stops asking who and what, fails here
// by name.
// ---------------------------------------------------------------------------

const ORG = 'org_1'

describe('what spends the cap', () => {
  it('is every authority that is not retired, in both shapes', () => {
    expect(spendsCap({ retired: false })).toBe(true)
    expect(spendsCap({ retired: true })).toBe(false)
    // The `where` addCompany counts with says the same thing as the
    // predicate the page counts with.
    for (const retired of [true, false]) {
      expect(spendsCap({ retired })).toBe(retired === SPENDS_CAP.retired)
    }
  })

  it('addCompany counts only authorities that are not retired', async () => {
    const counted: unknown[] = []
    const tx = {
      organization: { findFirst: async () => ({ maxCompanies: 5 }) },
      company: {
        count: async (args: unknown) => {
          counted.push(args)
          // Five authorities exist; two of them working.
          return 2
        },
        findFirst: async () => ({ id: 'clash' }),
      },
    } as unknown as TxClient
    const outcome = await addCompany(tx, ORG, { name: 'Next Carrier' })
    expect(counted).toEqual([
      { where: { organizationId: ORG, retired: false } },
    ])
    // Past the cap check, into the next refusal.
    expect(outcome).toEqual({ ok: false, reason: 'duplicate_name' })
  })

  it('and still refuses at the cap when the working ones fill it', async () => {
    const tx = {
      organization: { findFirst: async () => ({ maxCompanies: 2 }) },
      company: { count: async () => 2 },
    } as unknown as TxClient
    expect(await addCompany(tx, ORG, { name: 'Third' })).toEqual({
      ok: false,
      reason: 'limit_reached',
      limit: 2,
    })
  })
})

const placeholder = { retired: true, mcNumber: null, dotNumber: null }

describe('retiredRemovalRefusal', () => {
  it('passes a working authority whoever asks', () => {
    const working = { retired: false, mcNumber: 'MC-1', dotNumber: '1' }
    expect(retiredRemovalRefusal(working, false)).toBeNull()
  })

  it('is the owner’s alone for a retired one', () => {
    expect(retiredRemovalRefusal(placeholder, false)).toBe('owner_only')
    expect(retiredRemovalRefusal(placeholder, true)).toBeNull()
  })

  it('refuses a retired authority that carries an MC or a DOT number', () => {
    expect(
      retiredRemovalRefusal({ ...placeholder, mcNumber: 'MC-885668' }, true),
    ).toBe('has_numbers')
    expect(
      retiredRemovalRefusal({ ...placeholder, dotNumber: '2544585' }, true),
    ).toBe('has_numbers')
    // A blank is no number.
    expect(
      retiredRemovalRefusal({ ...placeholder, mcNumber: '  ' }, true),
    ).toBeNull()
  })
})

function deletingTx(
  row: { retired: boolean; mcNumber: string | null; dotNumber: string | null },
  usage: Record<string, number> = {},
): { tx: TxClient; deleted: unknown[] } {
  const deleted: unknown[] = []
  const tx = {
    company: {
      findFirst: async (args: { select: Record<string, unknown> }) =>
        '_count' in args.select
          ? { _count: usage }
          : { id: 'co_retired', ...row },
      delete: async (args: unknown) => {
        deleted.push(args)
        return {}
      },
    },
  } as unknown as TxClient
  return { tx, deleted }
}

describe('deleteCompany on a retired authority', () => {
  it('removes a placeholder with nothing filed under it, for the owner', async () => {
    const { tx, deleted } = deletingTx(placeholder)
    const outcome = await deleteCompany(tx, 'co_retired', {
      mayRemoveRetired: true,
    })
    expect(outcome).toEqual({ ok: true })
    expect(deleted).toEqual([{ where: { id: 'co_retired' } }])
  })

  it('refuses anyone else, by default', async () => {
    const { tx, deleted } = deletingTx(placeholder)
    expect(await deleteCompany(tx, 'co_retired')).toEqual({
      ok: false,
      reason: 'owner_only',
    })
    expect(deleted).toEqual([])
  })

  it('refuses one with a number, even for the owner', async () => {
    const { tx, deleted } = deletingTx({ ...placeholder, dotNumber: '1234567' })
    expect(
      await deleteCompany(tx, 'co_retired', { mayRemoveRetired: true }),
    ).toEqual({ ok: false, reason: 'has_numbers' })
    expect(deleted).toEqual([])
  })

  it('refuses one that ever held a driver, a truck or a load', async () => {
    for (const relation of ['drivers', 'trucks', 'loads', 'assetHistory']) {
      const { tx, deleted } = deletingTx(placeholder, { [relation]: 1 })
      const outcome = await deleteCompany(tx, 'co_retired', {
        mayRemoveRetired: true,
      })
      expect(outcome).toMatchObject({ ok: false, reason: 'has_history' })
      expect(deleted).toEqual([])
    }
  })
})

const session = (role: Role): AuthorizedSession => ({
  userId: 'u',
  organizationId: ORG,
  role,
  companyScopes: [],
})

describe('who may remove a retired authority', () => {
  it('is the OWNER and nobody else', () => {
    const roles: Role[] = [
      'OWNER',
      'ADMIN',
      'MANAGER',
      'DISPATCHER',
      'ACCOUNTING',
      'DRIVER',
    ]
    const may = roles.filter((role) =>
      can(session(role), 'delete', 'company.retired'),
    )
    expect(may).toEqual(['OWNER'])
  })

  it('while an ADMIN still removes a working authority', () => {
    expect(can(session('ADMIN'), 'delete', 'company')).toBe(true)
  })
})
