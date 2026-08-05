import { afterAll, describe, expect, it } from 'vitest'
import { createPrismaClient } from '@/lib/db'
import { findAuthorityDrift } from '@/lib/asset-transfer'
import { findFactoringDrift } from '@/lib/factoring'
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

/**
 * Run a read-only check across every organization in the database.
 *
 * The OWNER connection on purpose. These are integrity checks over the whole
 * database, not tenant-scoped queries, and row-level security would hide
 * exactly the rows worth finding. Every OTHER test in this project uses the app
 * role for the opposite reason — see tests/integration.
 */
async function acrossEveryOrg<T>(
  check: (tx: Parameters<Parameters<typeof runInOrg>[2]>[0]) => Promise<T[]>,
): Promise<T[]> {
  owner ??= createPrismaClient(process.env.DIRECT_DATABASE_URL!)

  const organizations = await owner.organization.findMany({
    select: { id: true },
  })

  const found: T[] = []
  for (const organization of organizations) {
    found.push(
      ...(await runInOrg(owner, organization.id, check, {
        attribution: unattributed('read-only integrity assertion'),
      })),
    )
  }
  return found
}

afterAll(async () => {
  await owner?.$disconnect()
})

describe('an asset agrees with its own history', () => {
  it('no live asset has a companyId its open period disagrees with', async () => {
    const drift = await acrossEveryOrg((tx) => findAuthorityDrift(tx))

    // Printed rather than merely counted: an assertion that fails with
    // "expected 3 to be 0" sends somebody hunting. This one names the assets.
    expect(drift, JSON.stringify(drift, null, 2)).toEqual([])
  })
})

describe('a factored invoice agrees with the loads it covers', () => {
  // Phase 3 §5 step 4. The SAME argument as the check above, one table over.
  //
  // `Invoice.factoringFeeCents` is what the factor charged; each covered load
  // carries its apportioned share, so per-load profitability includes a fee
  // charged once across several loads. The share is DERIVED, and a derived
  // column with no check is a column that drifts silently — an apportionment
  // bug or a hand-edited row makes every margin on that load wrong forever and
  // neither announces itself.
  //
  // Zero rows or fail. A missing cent is not a rounding difference to tolerate:
  // `apportionCents` distributes the remainder by construction, so any gap at
  // all means the stored shares are not what the arithmetic produces.
  it('every factored invoice fee sums exactly from its loads', async () => {
    const drift = await acrossEveryOrg((tx) => findFactoringDrift(tx))

    expect(drift, JSON.stringify(drift, null, 2)).toEqual([])
  })
})
