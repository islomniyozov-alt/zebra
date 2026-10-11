import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Role } from '@/generated/prisma/client'
import { drawsForDriver } from '@/lib/driver-record'
import type { AuthorizedSession } from '@/lib/permissions'

// ---------------------------------------------------------------------------
// THE POOL'S SECOND DOOR (TMS-DESIGN-SYSTEM.md §6.9, 2026-10-11).
//
// The driver record's Safety tab listed that driver's random selections to any
// role with `compliance:read` — a dispatcher and accounting included — after
// rulings 17 and 18 had made the pool owner/safety only under 49 CFR Part 40.
// These hold the door shut at both ends: the reader refuses before it queries,
// and the page renders the panel only for a role that reads the pool.
// ---------------------------------------------------------------------------

const session = (role: Role): AuthorizedSession => ({
  userId: 'cms59hb1s0000tgvsyq75inm2',
  organizationId: 'cms59hc0u0002tgvsqcq9ehtx',
  role,
  companyScopes: [],
})

/** A transaction that fails the test the moment anything touches it. */
const untouchable = new Proxy(
  {},
  {
    get(_target, prop) {
      throw new Error(`the database was touched: ${String(prop)}`)
    },
  },
) as never

describe('a driver’s selections are the pool, one person at a time', () => {
  it.each(['DISPATCHER', 'ACCOUNTING', 'DRIVER'] as const)(
    '%s gets nothing, and the database is never asked',
    async (role) => {
      await expect(
        drawsForDriver(untouchable, 'd1', session(role)),
      ).resolves.toEqual([])
    },
  )

  it.each(['OWNER', 'ADMIN', 'MANAGER'] as const)(
    '%s is let through to the query',
    async (role) => {
      // The untouchable transaction throws on the first property read, which
      // is the proof the reader went to the database for this role.
      await expect(
        drawsForDriver(untouchable, 'd1', session(role)),
      ).rejects.toThrow(/the database was touched/)
    },
  )

  it('and the driver page renders the panel only behind the pool permission', () => {
    const page = readFileSync('src/app/(app)/drivers/[id]/page.tsx', 'utf8')
    expect(page).toMatch(
      /const maySeeRandom = await currentUserCan\('read', 'randomTesting'\)/,
    )
    expect(page).toMatch(
      /\{tab === 'safety' && maySeeRandom \? \(\s*<div className="mt-z4 max-w-\[900px\]">\s*<DrawsPanel/,
    )
  })
})
