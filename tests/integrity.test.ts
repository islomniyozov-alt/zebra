import { afterAll, describe, expect, it } from 'vitest'
import { createPrismaClient } from '@/lib/db'
import { LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'
import { findAuthorityDrift } from '@/lib/asset-transfer'
import { findFactoringDrift } from '@/lib/factoring'
import { findPaymentDrift } from '@/lib/payments'
import { findBillingStatusDrift } from '@/lib/billing-status'
import { findSettlementDrift } from '@/lib/settlements'
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
        // ── THE BUDGET, NAMED AND IMPORTED ─────────────────────────────
        //
        // This ran on Prisma's 5s DEFAULT, which is exactly the state
        // `tests/transaction-budget.test.ts` exists to prevent — and it is
        // outside the `tests/integration/` directory that guard scans, which is
        // why it survived. It has been marginal for a while and tipped over on
        // 2026-09-29: three runs at 8.9s, 11.8s and 13.3s.
        //
        // NOTHING IS BEING HIDDEN BY THE LONGER BUDGET. These checks are
        // read-only — they recompute a cached column and assert it agrees — so
        // the assertion is unchanged and only the clock moved. What was failing
        // was the transaction expiring mid-read over 14,464 loads at roughly
        // 200ms to us-east-2, which is the arithmetic that file already states.
        timeoutMs: LOAD_WRITE_TIMEOUT_MS,
      })),
    )
  }
  return found
}

afterAll(async () => {
  await owner?.$disconnect()
})

// ---------------------------------------------------------------------------
// AN EMPTY DATABASE IS NOT A CLEAN ONE.
//
// Every assertion in this file has the shape "find the inconsistencies, expect
// none". That is trivially satisfied by a database with nothing in it, and on
// 2026-08-20 that is exactly what happened: a routing change pointed this
// project at a per-worker database — a fresh copy of the migration template —
// and all five checks passed against zero loads, zero invoices and zero
// payments. The suite reported a clean bill of health for a database it had
// never seen the contents of.
//
// SO THE FILE PROVES IT CAN SEE ROWS BEFORE IT PROVES ANYTHING ABOUT THEM.
// This is a precondition, not a check of the data: it asserts the connection
// reaches a populated database, and it fails LOUDLY rather than passing
// quietly, which is the difference between the two outcomes that matter.
//
// The tables are the ones the checks below actually read. A database holding
// organizations and no loads would still satisfy a bare "is anything here",
// while telling the factoring and payment checks nothing.
// ---------------------------------------------------------------------------
describe('the backstop can see the database it is judging', () => {
  it('reaches rows in the tables these checks read', async () => {
    owner ??= createPrismaClient(process.env.DIRECT_DATABASE_URL!)

    const counts = {
      organizations: await owner.organization.count(),
      companies: await owner.company.count(),
      loads: await owner.load.count(),
    }

    const empty = Object.entries(counts)
      .filter(([, n]) => n === 0)
      .map(([table]) => table)

    expect(
      empty,
      `these checks report "no inconsistencies" by finding nothing, so an ` +
        `empty table makes them meaningless. Counts: ${JSON.stringify(counts)}. ` +
        `If this is a fresh database, this file is pointed at the wrong one — ` +
        `see tests/setup.ts.`,
    ).toEqual([])
  })
})

describe('an asset agrees with its own history', () => {
  it('no live asset has a companyId its open period disagrees with', async () => {
    const drift = await acrossEveryOrg((tx) => findAuthorityDrift(tx))

    // Printed rather than merely counted: an assertion that fails with
    // "expected 3 to be 0" sends somebody hunting. This one names the assets.
    //
    // AND NAMES THE INNOCENT EXPLANATION FIRST. This check reads the WHOLE
    // database across every organization, so an integration suite running at
    // the same time — whose fixtures live between `beforeAll` and `afterAll` —
    // shows up here as drift that vanishes on its own. Real drift persists;
    // `npm run check` and `npm run test:integration` should not be run
    // concurrently against the same branch.
    expect(
      drift,
      `${JSON.stringify(drift, null, 2)}

` +
        'If an integration run is in flight against this branch, these are its ' +
        'live fixtures rather than drift. Re-run when it finishes.',
    ).toEqual([])
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

describe('a payment agrees with what it was applied to', () => {
  // Phase 3 §5 step 5. `Payment.unappliedCents` is a cache of
  // `amountCents − sum(applications) − sum(loadApplications)`.
  //
  // A cache that disagrees with its source is money the carrier believes it
  // can still allocate but cannot — or, the other way round, money it has
  // allocated twice. Neither shows up on a screen as wrong; both show up on a
  // bank reconciliation months later.
  it('no payment has an unapplied figure its applications disagree with', async () => {
    const drift = await acrossEveryOrg((tx) => findPaymentDrift(tx))

    expect(drift, JSON.stringify(drift, null, 2)).toEqual([])
  })
})

describe('a load’s billing status agrees with the money', () => {
  // The billing axis is a CACHE (billing-status.ts). A load whose stored
  // status has drifted is a load in the wrong queue: invisible in
  // ready-to-invoice, or offered for invoicing a second time.
  //
  // DISPUTED and WRITTEN_OFF are excluded by the check itself — they are
  // decisions somebody made, not arithmetic, and recomputing over them would
  // erase the only record that the argument is still open.
  it('no load says something the invoices and payments do not', async () => {
    const drift = await acrossEveryOrg((tx) => findBillingStatusDrift(tx))

    expect(drift, JSON.stringify(drift, null, 2)).toEqual([])
  })
})

describe('a settlement still reproduces from its own snapshots', () => {
  // Phase 3 §5 step 6, and the strongest form of the claim "approve freezes
  // it". Every LOAD_PAY line carries the rule, the basis and the result;
  // recomputing from the snapshot ALONE — no lookup of a rule that may since
  // have been closed, edited or deleted — must give back the stored figure.
  //
  // It also checks the four totals against the lines, because a settlement
  // whose net does not add up is a cheque for the wrong amount.
  //
  // A frozen document that nothing checks is a document somebody will
  // eventually edit.
  it('no settlement line disagrees with the snapshot beside it', async () => {
    const drift = await acrossEveryOrg((tx) => findSettlementDrift(tx))

    expect(drift, JSON.stringify(drift, null, 2)).toEqual([])
  })
})
