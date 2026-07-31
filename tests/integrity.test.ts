import { afterAll, describe, expect, it } from 'vitest'
import { createPrismaClient } from '@/lib/db'
import { findAuthorityDrift } from '@/lib/asset-transfer'
import { runInOrg } from '@/lib/tenancy'
import { unattributed } from '@/lib/audit'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE BACKSTOP UNDER THE LINT RULE.
//
// `eslint.config.mjs` bans `update({ data: { companyId } })` outside
// src/lib/asset-transfer.ts, so an asset cannot be moved between authorities
// without also writing the period rows that record the move. That catches the
// code somebody writes. It does not catch the row somebody writes by hand, a
// migration that backfills a column, or a service written before the rule
// existed.
//
// This does. `Truck.companyId` and the open `AssetAssignment` are two
// representations of one fact; they must agree for every live asset, and this
// asks the database directly. Zero rows or fail — there is no acceptable
// non-zero answer, because each one is an asset with two different answers to
// "whose authority was this under".
//
// Read-only, so it belongs in the node project and runs in `npm run check`
// rather than only in the integration suite. An integrity assertion nobody
// runs is a comment.
// ---------------------------------------------------------------------------

let owner: PrismaClient

afterAll(async () => {
  await owner?.$disconnect()
})

describe('an asset agrees with its own history', () => {
  it('no live asset has a companyId its open period disagrees with', async () => {
    // The OWNER connection on purpose. This is an integrity check over the
    // whole database, not a tenant-scoped query, and row-level security would
    // hide exactly the rows worth finding. Every OTHER test in this project
    // uses the app role for the opposite reason — see tests/integration.
    owner = createPrismaClient(process.env.DIRECT_DATABASE_URL!)

    const organizations = await owner.organization.findMany({
      select: { id: true },
    })

    const drift = []
    for (const organization of organizations) {
      drift.push(
        ...(await runInOrg(
          owner,
          organization.id,
          (tx) => findAuthorityDrift(tx),
          {
            attribution: unattributed('read-only integrity assertion'),
          },
        )),
      )
    }

    // Printed rather than merely counted: an assertion that fails with
    // "expected 3 to be 0" sends somebody hunting. This one names the assets.
    expect(drift, JSON.stringify(drift, null, 2)).toEqual([])
  })
})
