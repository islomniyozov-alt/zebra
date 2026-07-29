import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { Pool } from '@neondatabase/serverless'
import { createPrismaClient } from '@/lib/db'
import { runInOrg } from '@/lib/tenancy'
import {
  getAuditHealth,
  onAuditEvent,
  resetAuditHealth,
  type AuditContext,
  type AuditEvent,
} from '@/lib/audit'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// §8, against the real database and through the real extension.
//
// Everything runs as zebra_app. The audit row goes into the caller's own
// transaction, so it is subject to the same row-level security as the write it
// describes — which is exactly the property being checked.
// ---------------------------------------------------------------------------

let app: PrismaClient
let owner: PrismaClient

let organizationId: string
let companyId: string
let customerId: string
let userId: string
let audit: AuditContext

const RATE = 250000

beforeAll(async () => {
  app = createPrismaClient(process.env.DATABASE_URL!)
  owner = createPrismaClient(process.env.DIRECT_DATABASE_URL!)

  const nonce = Math.random().toString(36).slice(2, 10)

  const organization = await owner.organization.create({
    data: {
      name: `Audit ${nonce}`,
      slug: `audit-${nonce}`,
      companies: { create: { name: 'Authority' } },
    },
    include: { companies: true },
  })
  organizationId = organization.id
  companyId = organization.companies[0]!.id

  const user = await owner.user.create({
    data: { email: `audit-${nonce}@example.test`, name: 'Auditor' },
  })
  userId = user.id

  const customer = await owner.customer.create({
    data: { organizationId, name: 'Broker' },
  })
  customerId = customer.id

  audit = {
    userId,
    organizationId,
    ip: '203.0.113.7',
    userAgent: 'zebra-tests/1.0',
  }
})

afterEach(async () => {
  await owner.auditLog.deleteMany({ where: { organizationId } })
  resetAuditHealth()
  vi.restoreAllMocks()
})

afterAll(async () => {
  await owner.organization
    .delete({ where: { id: organizationId } })
    .catch(() => {})
  await owner.user.delete({ where: { id: userId } }).catch(() => {})
  await app.$disconnect()
  await owner.$disconnect()
})

let loadCounter = 0
const makeLoad = async (data: Record<string, unknown> = {}) =>
  owner.load.create({
    data: {
      organizationId,
      companyId,
      customerId,
      loadNumber: `L-${(loadCounter += 1)}-${Date.now()}`,
      linehaulCents: RATE,
      ...data,
    },
  })

const auditRows = () =>
  owner.auditLog.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'asc' },
  })

describe('the acceptance test', () => {
  it('records one row holding only the rate, with correct before and after', async () => {
    // §8, verbatim: change a load's rate, confirm one audit row containing
    // only the rate field with correct before and after.
    const load = await makeLoad()

    await runInOrg(
      app,
      organizationId,
      (tx) =>
        tx.load.update({
          where: { id: load.id },
          data: { linehaulCents: 275000 },
        }),
      { audit },
    )

    const rows = await auditRows()
    expect(rows).toHaveLength(1)

    const row = rows[0]!
    expect(row.action).toBe('UPDATE')
    expect(row.entityType).toBe('Load')
    expect(row.entityId).toBe(load.id)
    expect(row.changes).toEqual({ linehaulCents: { from: RATE, to: 275000 } })
  })

  it('stamps who, where from, and which tenant', async () => {
    const load = await makeLoad()
    await runInOrg(
      app,
      organizationId,
      (tx) =>
        tx.load.update({
          where: { id: load.id },
          data: { commodity: 'Steel' },
        }),
      { audit },
    )

    const row = (await auditRows())[0]!
    expect(row.userId).toBe(userId)
    expect(row.organizationId).toBe(organizationId)
    expect(row.companyId).toBe(companyId)
    expect(row.ip).toBe('203.0.113.7')
    expect(row.userAgent).toBe('zebra-tests/1.0')
  })
})

describe('coverage across operations', () => {
  it('records a create', async () => {
    const created = await runInOrg(
      app,
      organizationId,
      (tx) =>
        tx.customer.create({
          data: { organizationId, name: 'New Broker' },
        }),
      { audit },
    )

    const rows = await auditRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      action: 'CREATE',
      entityType: 'Customer',
      entityId: created.id,
    })
    // Org-level entity, so no authority to attribute it to.
    expect(rows[0]!.companyId).toBeNull()
    expect(rows[0]!.changes).toMatchObject({
      name: { from: null, to: 'New Broker' },
    })
  })

  it('records a hard delete with the row that went away', async () => {
    const load = await makeLoad({ commodity: 'Lumber' })

    await runInOrg(
      app,
      organizationId,
      (tx) => tx.load.delete({ where: { id: load.id } }),
      {
        audit,
      },
    )

    const rows = await auditRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.action).toBe('DELETE')
    expect(rows[0]!.changes).toMatchObject({
      commodity: { from: 'Lumber', to: null },
    })
  })

  it('calls a soft delete a DELETE, not an update', async () => {
    // §6 makes deletedAt the mechanism, so the shape is read rather than
    // asked of every caller.
    const load = await makeLoad()

    await runInOrg(
      app,
      organizationId,
      (tx) =>
        tx.load.update({
          where: { id: load.id },
          data: { deletedAt: new Date() },
        }),
      { audit },
    )

    expect((await auditRows())[0]!.action).toBe('DELETE')
  })

  it('calls clearing deletedAt a RESTORE', async () => {
    const load = await makeLoad({ deletedAt: new Date() })

    await runInOrg(
      app,
      organizationId,
      (tx) =>
        tx.load.update({ where: { id: load.id }, data: { deletedAt: null } }),
      { audit },
    )

    expect((await auditRows())[0]!.action).toBe('RESTORE')
  })

  it('writes one row per entity for updateMany, not one for the statement', async () => {
    const first = await makeLoad()
    const second = await makeLoad()

    await runInOrg(
      app,
      organizationId,
      (tx) =>
        tx.load.updateMany({
          where: { id: { in: [first.id, second.id] } },
          data: { linehaulCents: 300000 },
        }),
      { audit },
    )

    const rows = await auditRows()
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.entityId).sort()).toEqual(
      [first.id, second.id].sort(),
    )
    for (const row of rows) {
      expect(row.changes).toEqual({ linehaulCents: { from: RATE, to: 300000 } })
    }
  })

  it('audits whether or not the callback awaits', async () => {
    // Regression. A PrismaPromise is lazy — it executes when awaited, not when
    // built. The terse callback style below returns the thenable unawaited, so
    // if runInOrg does not hold the async context open across it, the query
    // runs after the context has closed and the write is never audited. That
    // failed silently, and every test that happened to await inside its
    // callback passed anyway.
    const terse = await makeLoad()
    const explicit = await makeLoad()

    await runInOrg(
      app,
      organizationId,
      (tx) =>
        tx.load.update({
          where: { id: terse.id },
          data: { commodity: 'Terse' },
        }),
      { audit },
    )
    await runInOrg(
      app,
      organizationId,
      async (tx) => {
        await tx.load.update({
          where: { id: explicit.id },
          data: { commodity: 'Explicit' },
        })
      },
      { audit },
    )

    const rows = await auditRows()
    expect(rows.map((r) => r.entityId).sort()).toEqual(
      [terse.id, explicit.id].sort(),
    )
  })

  it('writes nothing when an update changes nothing', async () => {
    const load = await makeLoad()

    await runInOrg(
      app,
      organizationId,
      (tx) =>
        tx.load.update({
          where: { id: load.id },
          data: { linehaulCents: RATE },
        }),
      { audit },
    )

    expect(await auditRows()).toHaveLength(0)
  })

  it('writes nothing for a read', async () => {
    await makeLoad()
    await runInOrg(app, organizationId, (tx) => tx.load.findMany(), { audit })
    expect(await auditRows()).toHaveLength(0)
  })
})

describe('what is deliberately not audited', () => {
  it('ignores Session, Notification and AuditLog itself', async () => {
    await runInOrg(
      app,
      organizationId,
      async (tx) => {
        await tx.notification.create({
          data: {
            organizationId,
            companyId,
            type: 'POD_MISSING',
            title: 'Missing POD',
          },
        })
        await tx.auditLog.create({
          data: {
            organizationId,
            companyId,
            action: 'EXPORT',
            entityType: 'Report',
            entityId: 'manual',
          },
        })
      },
      { audit },
    )

    // Only the hand-written row. Nothing about writing it, and nothing about
    // the notification.
    const rows = await auditRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.entityType).toBe('Report')
  })
})

describe('the audit row lives behind the same wall', () => {
  it('is invisible to another organization', async () => {
    const load = await makeLoad()
    await runInOrg(
      app,
      organizationId,
      (tx) =>
        tx.load.update({
          where: { id: load.id },
          data: { linehaulCents: 111 },
        }),
      { audit },
    )

    const other = await owner.organization.create({
      data: { name: 'Other', slug: `audit-other-${Date.now()}` },
    })
    try {
      const seen = await runInOrg(app, other.id, (tx) => tx.auditLog.findMany())
      expect(seen).toEqual([])
    } finally {
      await owner.organization.delete({ where: { id: other.id } })
    }
  })

  it('rolls back with the write it describes', async () => {
    // A rolled-back write must not leave an audit row claiming it happened.
    const load = await makeLoad()

    await expect(
      runInOrg(
        app,
        organizationId,
        async (tx) => {
          await tx.load.update({
            where: { id: load.id },
            data: { linehaulCents: 999999 },
          })
          throw new Error('caller changed their mind')
        },
        { audit },
      ),
    ).rejects.toThrow('caller changed their mind')

    expect(await auditRows()).toHaveLength(0)
    const unchanged = await owner.load.findUniqueOrThrow({
      where: { id: load.id },
    })
    expect(unchanged.linehaulCents).toBe(RATE)
  })
})

describe('failures are loud and countable, and never fail the write', () => {
  it('lets the parent write commit, then counts and reports the failure', async () => {
    // The only honest way to test this is to actually break the audit table.
    // Revoking INSERT leaves everything else working, which is precisely the
    // situation §8 is written for.
    const load = await makeLoad()
    const events: AuditEvent[] = []
    const unsubscribe = onAuditEvent((event) => events.push(event))
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    const control = new Pool({
      connectionString: process.env.DIRECT_DATABASE_URL,
    })
    try {
      await control.query('REVOKE INSERT ON "AuditLog" FROM zebra_app')

      // The write itself must succeed.
      const updated = await runInOrg(
        app,
        organizationId,
        (tx) =>
          tx.load.update({
            where: { id: load.id },
            data: { linehaulCents: 424242 },
          }),
        { audit },
      )
      expect(updated.linehaulCents).toBe(424242)

      // ...and it must really have committed, not merely been returned.
      const persisted = await owner.load.findUniqueOrThrow({
        where: { id: load.id },
      })
      expect(persisted.linehaulCents).toBe(424242)

      // Loud.
      expect(logged).toHaveBeenCalled()
      expect(logged.mock.calls[0]?.[0]).toBe('[zebra.audit.failure]')

      // Countable.
      const healthNow = getAuditHealth()
      expect(healthNow.failures).toBe(1)
      expect(healthNow.lastFailure).toMatchObject({
        model: 'Load',
        operation: 'update',
        entityIds: [load.id],
      })
      expect(healthNow.lastFailure?.message).toBeTruthy()

      // Reportable.
      expect(events.filter((e) => e.type === 'failure')).toHaveLength(1)

      // And no audit row, because there could not be one.
      expect(await auditRows()).toHaveLength(0)
    } finally {
      await control.query('GRANT INSERT ON "AuditLog" TO zebra_app')
      await control.end()
      unsubscribe()
      logged.mockRestore()
    }
  })

  it('recovers completely once the table works again', async () => {
    const load = await makeLoad()
    await runInOrg(
      app,
      organizationId,
      (tx) =>
        tx.load.update({
          where: { id: load.id },
          data: { commodity: 'Paper' },
        }),
      { audit },
    )

    expect(getAuditHealth().failures).toBe(0)
    expect(getAuditHealth().written).toBe(1)
    expect(await auditRows()).toHaveLength(1)
  })
})

describe('gaps are counted separately from failures', () => {
  it('counts a write with no audit context', async () => {
    const load = await makeLoad()
    // The fixture above is itself an uncontexted write, and counting it here
    // would measure the test rather than the thing under test.
    resetAuditHealth()

    // runInOrg without an acting user: the tenancy guarantee holds, but there
    // is nobody to attribute the change to.
    await runInOrg(app, organizationId, (tx) =>
      tx.load.update({ where: { id: load.id }, data: { commodity: 'Grain' } }),
    )

    const healthNow = getAuditHealth()
    expect(healthNow.gaps.noContext).toBe(1)
    // A gap is not a failure. Conflating them would make the failure counter
    // useless as an alert.
    expect(healthNow.failures).toBe(0)
    expect(await auditRows()).toHaveLength(0)
  })

  it('counts createMany, which returns no ids to point at', async () => {
    const events: AuditEvent[] = []
    const unsubscribe = onAuditEvent((event) => events.push(event))
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      await runInOrg(
        app,
        organizationId,
        (tx) =>
          tx.customer.createMany({
            data: [
              { organizationId, name: 'Bulk A' },
              { organizationId, name: 'Bulk B' },
            ],
          }),
        { audit },
      )

      expect(getAuditHealth().gaps.unfollowableOperation).toBe(1)
      expect(getAuditHealth().failures).toBe(0)
      expect(events.filter((e) => e.type === 'gap')).toHaveLength(1)
    } finally {
      unsubscribe()
      await owner.customer.deleteMany({
        where: { name: { startsWith: 'Bulk ' } },
      })
    }
  })

  it('follows createManyAndReturn, which does give ids', async () => {
    try {
      const created = await runInOrg(
        app,
        organizationId,
        (tx) =>
          tx.customer.createManyAndReturn({
            data: [
              { organizationId, name: 'Traceable A' },
              { organizationId, name: 'Traceable B' },
            ],
          }),
        { audit },
      )

      const rows = await auditRows()
      expect(rows).toHaveLength(2)
      expect(rows.every((r) => r.action === 'CREATE')).toBe(true)
      expect(rows.map((r) => r.entityId).sort()).toEqual(
        created.map((c) => c.id).sort(),
      )
      expect(getAuditHealth().gaps.unfollowableOperation).toBe(0)
    } finally {
      await owner.customer.deleteMany({
        where: { name: { startsWith: 'Traceable ' } },
      })
    }
  })
})
