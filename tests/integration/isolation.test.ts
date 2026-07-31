import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from '@neondatabase/serverless'
import { createPrismaClient } from '@/lib/db'
import { runAsUser, runInOrg, withOrg, type TxClient } from '@/lib/tenancy'
import { unattributed } from '@/lib/audit'
import type { PrismaClient } from '@/generated/prisma/client'
import { dropOrganization, seedOrganization, type OrgFixture } from './fixtures'

// ---------------------------------------------------------------------------
// §6 ACCEPTANCE TEST
//
// Two organizations, both fully populated, and a client connected as
// zebra_app — the role the application actually uses. The owner connection
// exists only to build and destroy the fixtures; asserting isolation over it
// would prove nothing, because the Neon owner carries BYPASSRLS.
//
// The suite writes to the database, so it is not part of `npm run check`.
// `npm test` runs it.
// ---------------------------------------------------------------------------

// zebra_app, pooled — the application's exact path to the database.
let app: PrismaClient
// The Neon owner, direct — fixtures only.
let owner: PrismaClient

let orgA: OrgFixture
let orgB: OrgFixture
let tenantModels: string[]

// A sweep queries all 38 tenant tables inside one transaction. No request ever
// does that, so Prisma's 5s default is right for the application and wrong
// here. Two shapes because runInOrg names its options in milliseconds.
// No acting user: this suite proves the wall, it does not act for anyone.
const PROBE = unattributed('isolation suite: asserts the tenant boundary')
// This suite stays OFF the retrying client on purpose — it is the one that
// proves the tenant wall, and a retry wrapper between it and the driver is one
// more thing between the assertion and the truth. It still needs the longer
// POOL WAIT, though: running eighth of eight it failed with "Unable to start a
// transaction in the given time", which is congestion and not a leak.
const WAIT = { maxWaitMs: 20_000 } as const
const SWEEP = { timeoutMs: 60_000, ...WAIT, attribution: PROBE } as const
const SWEEP_RAW = { timeout: 60_000 } as const

/** Minimal shape every Prisma model delegate shares, without reaching for `any`. */
interface Delegate {
  findMany(args: {
    select: { id: true }
    where?: { organizationId: string }
  }): Promise<{ id: string }[]>
}

function delegate(tx: TxClient, model: string): Delegate {
  const candidate = (tx as unknown as Record<string, unknown>)[model]
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    !('findMany' in candidate)
  ) {
    throw new Error(`No Prisma delegate named "${model}"`)
  }
  return candidate as Delegate
}

beforeAll(async () => {
  app = createPrismaClient(process.env.DATABASE_URL!)
  owner = createPrismaClient(process.env.DIRECT_DATABASE_URL!)

  // Ask the database which tables carry a tenant rather than keeping a list
  // here that would quietly go stale. Table names and model names match; the
  // delegate is the model with a lowercase initial.
  const pool = new Pool({ connectionString: process.env.DIRECT_DATABASE_URL })
  try {
    const { rows } = await pool.query<{ relname: string }>(`
      SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relkind = 'r'
         AND (
           c.relname = 'Organization'
           OR EXISTS (
             SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = c.oid AND a.attname = 'organizationId'
                AND a.attnum > 0 AND NOT a.attisdropped
           )
         )
       ORDER BY c.relname
    `)
    tenantModels = rows.map(
      (r) => r.relname[0]!.toLowerCase() + r.relname.slice(1),
    )
  } finally {
    await pool.end()
  }

  const nonce = Math.random().toString(36).slice(2, 10)
  orgA = await seedOrganization(owner, 'A', nonce)
  orgB = await seedOrganization(owner, 'B', nonce)
})

afterAll(async () => {
  if (orgA) await dropOrganization(owner, orgA)
  if (orgB) await dropOrganization(owner, orgB)
  await app?.$disconnect()
  await owner?.$disconnect()
})

describe('fixture coverage', () => {
  it('populates every table that carries a tenant', () => {
    // Without this, "sees no rows from the other organization" would pass for
    // any table the fixture forgot — the most comfortable way to be wrong.
    const uncovered = tenantModels.filter(
      (model) =>
        (orgA.ids[model]?.length ?? 0) === 0 ||
        (orgB.ids[model]?.length ?? 0) === 0,
    )
    expect(uncovered).toEqual([])
    expect(tenantModels.length).toBeGreaterThan(30)
  })
})

describe('cross-organization isolation', () => {
  // Both directions. A wall that only holds one way is a wall with a door.
  const directions: [string, () => OrgFixture, () => OrgFixture][] = [
    ['A cannot see B', () => orgA, () => orgB],
    ['B cannot see A', () => orgB, () => orgA],
  ]

  for (const [label, self, other] of directions) {
    it(`${label} — on every model`, async () => {
      const mine = self()
      const theirs = other()

      const leaks = await runInOrg(
        app,
        mine.organizationId,
        async (tx) => {
          const found: string[] = []
          for (const model of tenantModels) {
            const rows = await delegate(tx, model).findMany({
              select: { id: true },
            })
            const visible = new Set(rows.map((r) => r.id))

            const foreign = (theirs.ids[model] ?? []).filter((id) =>
              visible.has(id),
            )
            if (foreign.length > 0) {
              found.push(
                `${model}: leaked ${foreign.length} row(s) from the other organization`,
              )
            }

            const ownMissing = (mine.ids[model] ?? []).filter(
              (id) => !visible.has(id),
            )
            if (ownMissing.length > 0) {
              found.push(
                `${model}: cannot see ${ownMissing.length} of its own row(s)`,
              )
            }
          }
          return found
        },
        // Thirty-eight round trips to Neon in one transaction. No request does
        // this; the sweep does, and it must not die on the default 5s cap.
        SWEEP,
      )

      expect(leaks).toEqual([])
    })
  }

  it('returns nothing when the org variable was never set', async () => {
    // Unset must mean invisible. If current_setting defaulted to something
    // permissive, a request that skipped withOrg would read the whole table.
    const counts = await app.$transaction(async (tx) => {
      const out: Record<string, number> = {}
      for (const model of tenantModels) {
        out[model] = (
          await delegate(tx, model).findMany({ select: { id: true } })
        ).length
      }
      return out
    }, SWEEP_RAW)

    expect(Object.entries(counts).filter(([, n]) => n !== 0)).toEqual([])
  })

  it('does not carry one transaction’s organization into the next', async () => {
    // Connections are pooled. SET LOCAL is transaction-scoped precisely so
    // that the next request on the same physical connection starts blind.
    await runInOrg(
      app,
      orgA.organizationId,
      async (tx) => {
        expect(
          await delegate(tx, 'load').findMany({ select: { id: true } }),
        ).toHaveLength(1)
      },
      { ...WAIT, attribution: PROBE },
    )

    const afterwards = await app.$transaction((tx) =>
      delegate(tx, 'load').findMany({ select: { id: true } }),
    )
    expect(afterwards).toEqual([])
  })
})

describe('a forged organizationId in the request', () => {
  it('reads nothing, on every model', async () => {
    // The session says A. The request body says B. Postgres has already
    // decided, and the extra predicate simply narrows an empty set.
    const found = await runInOrg(
      app,
      orgA.organizationId,
      async (tx) => {
        const out: string[] = []
        for (const model of tenantModels) {
          // Organization's tenant column is its own id, not organizationId.
          if (model === 'organization') continue
          const rows = await delegate(tx, model).findMany({
            select: { id: true },
            where: { organizationId: orgB.organizationId },
          })
          if (rows.length > 0) out.push(`${model}: ${rows.length}`)
        }
        return out
      },
      SWEEP,
    )

    expect(found).toEqual([])
  })

  it('cannot write a row into the other organization', async () => {
    await expect(
      runInOrg(
        app,
        orgA.organizationId,
        (tx) =>
          tx.company.create({
            data: {
              organizationId: orgB.organizationId,
              name: 'Forged authority',
            },
          }),
        { ...WAIT, attribution: PROBE },
      ),
    ).rejects.toThrow()

    // And nothing landed.
    const count = await owner.company.count({
      where: { name: 'Forged authority' },
    })
    expect(count).toBe(0)
  })

  it('cannot update a row in the other organization', async () => {
    const updated = await runInOrg(
      app,
      orgA.organizationId,
      (tx) =>
        tx.load.updateMany({
          where: { organizationId: orgB.organizationId },
          data: { linehaulCents: 1 },
        }),
      { ...WAIT, attribution: PROBE },
    )
    expect(updated.count).toBe(0)

    const theirLoad = await owner.load.findFirstOrThrow({
      where: { organizationId: orgB.organizationId },
    })
    expect(theirLoad.linehaulCents).toBe(250000)
  })

  it('cannot delete a row in the other organization', async () => {
    const deleted = await runInOrg(
      app,
      orgA.organizationId,
      (tx) =>
        tx.load.deleteMany({ where: { organizationId: orgB.organizationId } }),
      { ...WAIT, attribution: PROBE },
    )
    expect(deleted.count).toBe(0)
    expect(
      await owner.load.count({
        where: { organizationId: orgB.organizationId },
      }),
    ).toBe(1)
  })

  it('cannot reach the other organization through a relation', async () => {
    // Traversal is where a denormalized column earns itself: the join hits
    // LoadStop directly, and LoadStop has its own policy.
    const stops = await runInOrg(
      app,
      orgA.organizationId,
      (tx) =>
        tx.loadStop.findMany({
          select: { id: true },
          where: { load: { organizationId: orgB.organizationId } },
        }),
      { ...WAIT, attribution: PROBE },
    )
    expect(stops).toEqual([])
  })
})

describe('child tables inherit the wall', () => {
  it('overwrites a forged organizationId with the parent’s', async () => {
    const created = await runInOrg(
      app,
      orgA.organizationId,
      (tx) =>
        tx.loadStop.create({
          data: {
            loadId: orgA.ids.load![0]!,
            organizationId: orgB.organizationId, // a lie
            sequence: 99,
            type: 'DELIVERY',
          },
          select: { id: true, organizationId: true },
        }),
      { ...WAIT, attribution: PROBE },
    )

    expect(created.organizationId).toBe(orgA.organizationId)
    await owner.loadStop.delete({ where: { id: created.id } })
  })

  it('refuses to attach a child to the other organization’s parent', async () => {
    await expect(
      runInOrg(
        app,
        orgA.organizationId,
        (tx) =>
          tx.loadStop.create({
            data: {
              loadId: orgB.ids.load![0]!,
              organizationId: orgA.organizationId,
              sequence: 98,
              type: 'DELIVERY',
            },
          }),
        { ...WAIT, attribution: PROBE },
      ),
    ).rejects.toThrow()

    expect(await owner.loadStop.count({ where: { sequence: 98 } })).toBe(0)
  })

  it('refuses a payment application joining two organizations', async () => {
    await expect(
      runInOrg(
        app,
        orgA.organizationId,
        (tx) =>
          tx.paymentApplication.create({
            data: {
              paymentId: orgA.ids.payment![0]!,
              invoiceId: orgB.ids.invoice![0]!,
              organizationId: orgA.organizationId,
              amountCents: 1,
            },
          }),
        { ...WAIT, attribution: PROBE },
      ),
    ).rejects.toThrow()
  })
})

describe('the own_membership escape hatch', () => {
  // Login needs to read Membership before it knows an organization, so
  // Membership answers to `app.current_user_id` too. That is a second key to
  // the same door and it gets tested like one.

  it('shows a user their own memberships and nobody else’s', async () => {
    const seen = await runAsUser(app, orgA.userId, (tx) =>
      tx.membership.findMany({ select: { id: true, userId: true } }),
    )

    expect(seen.map((m) => m.id)).toEqual(orgA.ids.membership)
    expect(seen.every((m) => m.userId === orgA.userId)).toBe(true)
    expect(seen.map((m) => m.id)).not.toContain(orgB.ids.membership![0])
  })

  it('shows the scope list that belongs to those memberships only', async () => {
    const seen = await runAsUser(app, orgA.userId, (tx) =>
      tx.membershipCompany.findMany({ select: { id: true } }),
    )

    expect(seen.map((m) => m.id)).toEqual(orgA.ids.membershipCompany)
  })

  it('unlocks nothing else', async () => {
    // Asserting a user id must not become a way to read tenant data. Only
    // Membership and MembershipCompany have the second policy.
    const leaked = await runAsUser(app, orgA.userId, async (tx) => ({
      loads: await tx.load.count(),
      companies: await tx.company.count(),
      invoices: await tx.invoice.count(),
      organizations: await tx.organization.count(),
    }))

    expect(leaked).toEqual({
      loads: 0,
      companies: 0,
      invoices: 0,
      organizations: 0,
    })
  })

  it('cannot be used to write a membership into any organization', async () => {
    // The policy is FOR SELECT. Writes still answer to org_isolation, which
    // has no org set inside runAsUser, so there is nothing to write into.
    await expect(
      runAsUser(app, orgA.userId, (tx) =>
        tx.membership.create({
          data: {
            userId: orgA.userId,
            organizationId: orgB.organizationId,
            role: 'OWNER',
          },
        }),
      ),
    ).rejects.toThrow()

    expect(
      await owner.membership.count({
        where: { userId: orgA.userId, organizationId: orgB.organizationId },
      }),
    ).toBe(0)
  })

  it('cannot be used to promote an existing membership', async () => {
    const changed = await runAsUser(app, orgA.userId, (tx) =>
      tx.membership.updateMany({
        where: { userId: orgA.userId },
        data: { role: 'OWNER' },
      }),
    )
    expect(changed.count).toBe(0)
  })

  it('does not linger into the next transaction', async () => {
    await runAsUser(app, orgA.userId, async (tx) => {
      expect(await tx.membership.count()).toBe(1)
    })

    const afterwards = await app.$transaction((tx) => tx.membership.count())
    expect(afterwards).toBe(0)
  })

  it('refuses an id that is not a cuid', async () => {
    await expect(
      runAsUser(app, `' OR '1'='1`, async () => 'reached the callback'),
    ).rejects.toThrow(/Not a user id/)
  })
})

describe('an organization can be removed', () => {
  it('cascades through every child table without a trigger objecting', async () => {
    // Regression test for 20260728233000. Deleting an Organization cascades to
    // Truck, which nulls LoadAssignment.truckId, which is an UPDATE on a child
    // whose Load the same cascade has already removed. A trigger that fires on
    // every UPDATE raises there, and nothing can ever be deleted.
    const doomed = await seedOrganization(
      owner,
      'C',
      Math.random().toString(36).slice(2, 10),
    )

    await expect(dropOrganization(owner, doomed)).resolves.toBeUndefined()

    expect(
      await owner.organization.count({ where: { id: doomed.organizationId } }),
    ).toBe(0)
    expect(
      await owner.load.count({
        where: { organizationId: doomed.organizationId },
      }),
    ).toBe(0)
    expect(
      await owner.loadAssignment.count({
        where: { organizationId: doomed.organizationId },
      }),
    ).toBe(0)
  })
})

describe('the org id is never concatenated into SQL', () => {
  it('rejects an injection attempt before it reaches the database', async () => {
    await expect(
      runInOrg(app, `' OR '1'='1`, async () => 'reached the callback', {
        attribution: PROBE,
      }),
    ).rejects.toThrow(/Not an organization id/)
  })

  it('applies the same guard to withOrg', async () => {
    // withOrg binds runInOrg to the request-scoped client. Validation happens
    // before any client is touched, so this asserts the guard without opening
    // a connection that the test could not then close.
    await expect(
      withOrg('not-a-cuid', async () => 'reached the callback', {
        attribution: PROBE,
      }),
    ).rejects.toThrow(/Not an organization id/)
  })
})
