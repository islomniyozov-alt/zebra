import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { retryingClient } from '../retrying-client'
import { prisma } from '@/lib/db'
import { tenantReader, tenantReadText, txReader, withOrg } from '@/lib/tenancy'
import { weekOf } from '@/lib/settlement-week'
import { readPayrollBatchesPage } from '@/lib/payroll-batches-page'
import { Prisma, type PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// THE TENANT AND ONE READ IN ONE ROUND TRIP, AND STILL NOTHING ACROSS TENANTS
// (§6.2.9 v11.03; migration 72, `zebra_tenant_read`).
//
// The function sets `app.current_org_id` and runs the read as its caller. The
// claim this file holds is that row-level security does exactly what it did
// inside `runInOrg`:
//
//   - the reader runs as `zebra_app`, a role without BYPASSRLS;
//   - the payroll page's read as A returns A's batches and none of B's;
//   - a bare `SELECT count(*) FROM "SettlementBatch"` through the function as
//     A counts A's alone — no WHERE of ours, only the policy;
//   - an organization with no rows reads nothing;
//   - the setting is gone on the same connection once the call returns;
//   - and the read agrees with the same read inside a tenant transaction.
//
// WATCHED FAILING WITH ROW-LEVEL SECURITY OFF on `SettlementBatch` (the owner
// turns it off in setup under the break) and with the reader handed the other
// tenant's id. A cross-tenant test that passes with RLS off is testing the
// WHERE clauses, not the policy.
//
// BOTH TENANTS HOLD ROWS, and B holds more than A, so "A sees only A's" can
// tell a policy from an empty table.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let orgA = ''
let orgB = ''
let userA = ''
const batchesOf: Record<'A' | 'B', string[]> = { A: [], B: [] }
const nonce = Math.random().toString(36).slice(2, 8)

const WEEKS = [5, 12, 19].map((day) => weekOf(new Date(Date.UTC(2026, 6, day))))

const asA = () => tenantReader(prisma, orgA)
const asB = () => tenantReader(prisma, orgB)

const pageInput = (organizationId: string, userId: string) => ({
  organizationId,
  userId,
  companyScopes: [] as string[],
  period: WEEKS[0]!,
  offered: WEEKS,
  batchesTab: true,
  grid: 'payroll.batches' as const,
  balancesYear: null,
})

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)

  for (const [name, count] of [
    ['A', 1],
    ['B', 2],
  ] as const) {
    const organization = await owner.organization.create({
      data: {
        name: `Tenant read ${name} ${nonce}`,
        slug: `tenant-read-${name.toLowerCase()}-${nonce}`,
        companies: { create: [{ name: `${name} Carrier ${nonce}` }] },
      },
    })
    if (name === 'A') orgA = organization.id
    else orgB = organization.id
    for (const week of WEEKS.slice(0, count)) {
      const batch = await owner.settlementBatch.create({
        data: {
          organizationId: organization.id,
          periodStart: week.start,
          periodEnd: week.end,
          statementDate: week.end,
          checkDate: week.end,
        },
      })
      batchesOf[name].push(batch.id)
    }
  }

  const user = await owner.user.create({
    data: { email: `tenant-read-${nonce}@example.test`, name: 'Reader A' },
  })
  userA = user.id
  await owner.membership.create({
    data: { userId: userA, organizationId: orgA, role: 'OWNER' },
  })
  await owner.userPreference.create({
    data: {
      organizationId: orgA,
      userId: userA,
      key: 'columns.payroll.batches',
      value: { hidden: ['notes'] },
    },
  })
}, 300_000)

afterAll(async () => {
  await owner?.$disconnect()
})

describe('zebra_tenant_read: one round trip, row-level security unchanged', () => {
  it('runs as zebra_app, a role that cannot bypass row-level security', async () => {
    const [who] = await asA().read<{ who: string; bypass: boolean }>(
      Prisma.sql`SELECT current_user::text AS who,
                        (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass`,
    )
    expect(who).toEqual({ who: 'zebra_app', bypass: false })
  })

  it('reads the payroll page as A and sees none of B’s batches', async () => {
    const read = await readPayrollBatchesPage(asA(), pageInput(orgA, userA))
    expect(read.batches.map((row) => row.id)).toEqual(batchesOf.A)
    expect(read.opened).toEqual([WEEKS[0]!.start.getTime()])
    expect(read.columnsRow?.value).toEqual({ hidden: ['notes'] })

    const asTenantB = await readPayrollBatchesPage(
      asB(),
      pageInput(orgB, userA),
    )
    expect(asTenantB.batches.map((row) => row.id).sort()).toEqual(
      [...batchesOf.B].sort(),
    )
    // A's preference row is A's: B's read of the same user finds none.
    expect(asTenantB.columnsRow).toBeNull()
  }, 120_000)

  it('counts only the tenant’s own rows with no WHERE of ours — the policy alone', async () => {
    const count = Prisma.sql`SELECT COUNT(*)::int AS n FROM "SettlementBatch"`
    const [a] = await asA().read<{ n: number }>(count)
    const [b] = await asB().read<{ n: number }>(count)
    expect({ a: a?.n, b: b?.n }).toEqual({ a: 1, b: 2 })
    // NOT VACUOUS: the owner sees both tenants' rows.
    expect(
      await owner.settlementBatch.count({
        where: { organizationId: { in: [orgA, orgB] } },
      }),
    ).toBe(3)
  }, 120_000)

  it('reads nothing for an organization with no rows', async () => {
    const stranger = 'c' + 'z'.repeat(24)
    const [row] = await tenantReader(prisma, stranger).read<{ n: number }>(
      Prisma.sql`SELECT COUNT(*)::int AS n FROM "SettlementBatch"`,
    )
    expect(row?.n).toBe(0)
  }, 120_000)

  it('leaves no tenant on the connection once the call returns', async () => {
    const { Client } = createRequire(import.meta.url)(
      'pg',
    ) as typeof import('pg')
    const client = new Client({ connectionString: process.env.DATABASE_URL })
    await client.connect()
    try {
      const { text, args } = tenantReadText(
        Prisma.sql`SELECT COUNT(*)::int AS n FROM "SettlementBatch"`,
      )
      const called = await client.query(
        'SELECT zebra_tenant_read($1, $2, $3::jsonb) AS rows',
        [orgA, text, JSON.stringify(args)],
      )
      expect(called.rows[0].rows).toEqual([{ n: 1 }])
      const after = await client.query(
        "SELECT COALESCE(current_setting('app.current_org_id', true), '') AS org",
      )
      expect(after.rows[0].org).toBe('')
      const bare = await client.query(
        'SELECT COUNT(*)::int AS n FROM "SettlementBatch"',
      )
      expect(bare.rows[0].n).toBe(0)
    } finally {
      await client.end()
    }
  }, 120_000)

  it('agrees with the same read inside a tenant transaction', async () => {
    const one = await readPayrollBatchesPage(asA(), pageInput(orgA, userA))
    const inTx = await withOrg(
      orgA,
      (tx) => readPayrollBatchesPage(txReader(tx), pageInput(orgA, userA)),
      {
        attribution: { userId: userA, ip: null, userAgent: 'tenant-read.test' },
      },
    )
    expect(one).toEqual(inTx)
  }, 120_000)

  it('carries strings, booleans, integers, dates and string lists, and refuses anything else', () => {
    const at = new Date(Date.UTC(2026, 6, 5))
    const { text, args } = tenantReadText(
      Prisma.sql`SELECT ${'x'}, ${true}, ${7}, ${at}, ${['a', 'b']}, ${null}`,
    )
    expect(text).toBe(
      'SELECT ($1->>0), (($1->>1)::boolean), (($1->>2)::bigint), (($1->>3)::timestamp(3)), (ARRAY(SELECT jsonb_array_elements_text($1->4))), NULL',
    )
    expect(args).toEqual(['x', true, 7, at.toISOString(), ['a', 'b']])
    expect(() => tenantReadText(Prisma.sql`SELECT ${1.5}`)).toThrow(
      /does not carry/,
    )
  })
})
