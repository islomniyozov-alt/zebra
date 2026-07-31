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
import { retryingClient } from '../retrying-client'
import { runInOrg } from '@/lib/tenancy'
import {
  getAuditHealth,
  onAuditEvent,
  resetAuditHealth,
  unattributed,
  type Attribution,
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
let attribution: Attribution

const RATE = 250000

beforeAll(async () => {
  app = retryingClient(process.env.DATABASE_URL!)
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)

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

  attribution = {
    userId,
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
      { attribution },
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
      { attribution },
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
      { attribution },
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
        attribution,
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
      { attribution },
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
      { attribution },
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
      { attribution },
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
      { attribution },
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
      { attribution },
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
      { attribution },
    )

    expect(await auditRows()).toHaveLength(0)
  })

  it('writes nothing for a read', async () => {
    await makeLoad()
    await runInOrg(app, organizationId, (tx) => tx.load.findMany(), {
      attribution,
    })
    expect(await auditRows()).toHaveLength(0)
  })
})

describe('a narrowed select narrows the response, not the audit', () => {
  it('re-reads the full row after a create with a narrow select', async () => {
    // The bug this fixes: confirmUpload creates a Document with
    // select: { id, r2Key } and the audit row came back with two fields and a
    // null companyId. The audit is supposed to record what happened, not what
    // the caller asked to see.
    const created = await runInOrg(
      app,
      organizationId,
      (tx) =>
        tx.load.create({
          data: {
            organizationId,
            companyId,
            customerId,
            loadNumber: `NARROW-${Date.now()}`,
            linehaulCents: RATE,
          },
          select: { id: true },
        }),
      { attribution },
    )

    const row = (await auditRows())[0]!
    expect(row.action).toBe('CREATE')
    expect(row.entityId).toBe(created.id)
    // Present despite never being selected.
    expect(row.companyId).toBe(companyId)

    const changes = row.changes as Record<
      string,
      { from: unknown; to: unknown }
    >
    expect(changes['linehaulCents']).toEqual({ from: null, to: RATE })
    expect(changes['customerId']).toEqual({ from: null, to: customerId })
    expect(Object.keys(changes).length).toBeGreaterThan(5)
    expect(getAuditHealth().gaps.rereadBlocked).toBe(0)
  })

  it('diffs an update on full rows, not on the returned shape', async () => {
    const load = await makeLoad({ commodity: 'Steel' })
    resetAuditHealth()

    const updated = await runInOrg(
      app,
      organizationId,
      (tx) =>
        tx.load.update({
          where: { id: load.id },
          data: { linehaulCents: 999000 },
          select: { id: true },
        }),
      { attribution },
    )

    // The caller still gets exactly what it asked for.
    expect(Object.keys(updated)).toEqual(['id'])

    // And the audit still sees one changed field, not "everything vanished".
    const row = (await auditRows())[0]!
    expect(row.changes).toEqual({
      linehaulCents: { from: RATE, to: 999000 },
    })
    expect(row.companyId).toBe(companyId)
  })

  it('leaves an unnarrowed write on the cheap path', async () => {
    // No select, so no re-read to pay for.
    const load = await makeLoad()
    resetAuditHealth()

    await runInOrg(
      app,
      organizationId,
      (tx) =>
        tx.load.update({
          where: { id: load.id },
          data: { commodity: 'Lumber' },
        }),
      { attribution },
    )

    expect((await auditRows())[0]!.changes).toEqual({
      commodity: { from: null, to: 'Lumber' },
    })
    expect(getAuditHealth().gaps.rereadBlocked).toBe(0)
  })

  it('still writes an audit row for a narrowed create', async () => {
    // rereadBlocked is close to unreachable in normal operation — the re-read
    // runs in the same transaction and the same tenant as the write, so the row
    // is there by construction. That is exactly why it should read zero, and
    // why it is counted rather than thrown: the only ways to reach it are a
    // policy change or a row that left mid-transaction.
    resetAuditHealth()

    const outcome = await runInOrg(
      app,
      organizationId,
      async (tx) => {
        const customer = await tx.customer.create({
          data: { organizationId, name: 'Vanishes' },
          select: { id: true },
        })
        return customer.id
      },
      { attribution },
    )

    expect(outcome).toBeTruthy()
    // The create itself is audited either way — thin beats absent.
    expect((await auditRows()).length).toBeGreaterThanOrEqual(1)
    await owner.customer.deleteMany({ where: { name: 'Vanishes' } })
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
      { attribution },
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
      { attribution },
    )

    const other = await owner.organization.create({
      data: { name: 'Other', slug: `audit-other-${Date.now()}` },
    })
    try {
      const seen = await runInOrg(
        app,
        other.id,
        (tx) => tx.auditLog.findMany(),
        { attribution: unattributed('read-only cross-tenant check') },
      )
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
        { attribution },
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
        { attribution },
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
      { attribution },
    )

    expect(getAuditHealth().failures).toBe(0)
    expect(getAuditHealth().written).toBe(1)
    expect(await auditRows()).toHaveLength(1)
  })
})

describe('gaps are counted separately from failures', () => {
  it('counts a declared unattributed write, and says why', async () => {
    const load = await makeLoad()
    // The fixture above is itself an uncontexted write, and counting it here
    // would measure the test rather than the thing under test.
    resetAuditHealth()

    const events: AuditEvent[] = []
    const unsubscribe = onAuditEvent((event) => events.push(event))
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      await runInOrg(
        app,
        organizationId,
        (tx) =>
          tx.load.update({
            where: { id: load.id },
            data: { commodity: 'Grain' },
          }),
        { attribution: unattributed('backfill script, no operator involved') },
      )

      const healthNow = getAuditHealth()
      expect(healthNow.gaps.unattributed).toBe(1)
      // A gap is not a failure. Conflating them would make the failure counter
      // useless as an alert.
      expect(healthNow.failures).toBe(0)
      expect(await auditRows()).toHaveLength(0)

      // The reason travels with the gap, so the log says why rather than just
      // that it happened.
      const gap = events.find((e) => e.type === 'gap')
      expect(gap).toMatchObject({
        kind: 'unattributed',
        reason: 'backfill script, no operator involved',
      })
    } finally {
      unsubscribe()
    }
  })

  it('counts a write that ran in no tenant transaction at all', async () => {
    // The seed and the login path do this: they write before any organization
    // is known, so they never reach runInOrg. Types cannot prevent it — only
    // count it.
    resetAuditHealth()
    const load = await makeLoad()

    expect(getAuditHealth().gaps.noContext).toBe(1)
    expect(getAuditHealth().failures).toBe(0)
    expect(await auditRows()).toHaveLength(0)
    await owner.load.delete({ where: { id: load.id } })
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
        { attribution },
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
        { attribution },
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
