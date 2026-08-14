import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { retryingClient } from '../retrying-client'
import { withOrg } from '@/lib/tenancy'
import { LOAD_WRITE_TIMEOUT_MS } from '@/lib/loads'
import { saveSettings, settingsForScope } from '@/lib/settings'
import { browseDocuments, entityOfDocument } from '@/lib/document-browser'
import type { AuthorizedSession } from '@/lib/permissions'
import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// Settings and the documents browser against real Postgres.
//
// What can only be asserted here:
//
//   * §4's box — "Settings edits are audited with field-level diffs". The diff
//     is written by the audit extension, so the only way to know it happened is
//     to save something and read `AuditLog.changes` back;
//   * that an UNCHANGED field is absent from that diff, which is what makes the
//     log readable a year later;
//   * that the browser's permission clause hides rows in SQL rather than after
//     fetching, proved by giving one session a document the other cannot see;
//   * that the download endpoint's helper agrees with the browser about which
//     entity a document hangs off.
// ---------------------------------------------------------------------------

let owner: PrismaClient
let organizationId = ''
let companyId = ''
let userId = ''
let loadDocumentId = ''
let settlementDocumentId = ''
const nonce = Math.random().toString(36).slice(2, 8)

const inOrg = <T>(fn: Parameters<typeof withOrg<T>>[1]): Promise<T> =>
  withOrg(organizationId, fn, {
    attribution: { userId, ip: null, userAgent: 'settings.test' },
    maxWaitMs: 20_000,
    // Prisma's 5s default cannot be met from here — see the note in
    // tests/transaction-budget.test.ts. One dial for all nineteen suites.
    timeoutMs: LOAD_WRITE_TIMEOUT_MS,
  })

const as = (role: AuthorizedSession['role']): AuthorizedSession => ({
  userId,
  organizationId,
  role,
  companyScopes: [],
})

const INPUT = {
  invoiceNumberPrefix: 'RAM-',
  invoiceTermsDays: '30',
  invoiceNotes: '',
  remitToText: '',
  defaultFuelCostPerMile: '0.55',
  defaultMpg: '6.5',
  factoringFeePercent: '3',
  dispatchFeePercent: '0',
  complianceWarnDays: '30',
  podMissingAlertDays: '3',
  invoiceOverdueDays: '1',
  settlementWeekEndsOn: '0',
}

beforeAll(async () => {
  owner = retryingClient(process.env.DIRECT_DATABASE_URL!)

  const organization = await owner.organization.create({
    data: {
      name: `Settings ${nonce}`,
      slug: `settings-${nonce}`,
      maxCompanies: 5,
      companies: { create: [{ name: `Alpha ${nonce}` }] },
    },
    include: { companies: true },
  })
  organizationId = organization.id
  companyId = organization.companies[0]!.id

  const user = await owner.user.create({
    data: { email: `settings-${nonce}@example.test`, name: 'Settings Tester' },
  })
  userId = user.id
  await owner.membership.create({
    data: { userId, organizationId, role: 'OWNER' },
  })

  // Two documents on two different kinds of thing — the whole point of the
  // browser's third wall.
  const customer = await owner.customer.create({
    data: { organizationId, name: `Broker ${nonce}` },
  })
  const load = await owner.load.create({
    data: {
      organizationId,
      companyId,
      customerId: customer.id,
      loadNumber: `L-${nonce}`,
    },
  })
  const driver = await owner.driver.create({
    data: {
      organizationId,
      companyId,
      firstName: 'Ahmad',
      lastName: `Karimov-${nonce}`,
    },
  })
  const settlement = await owner.settlement.create({
    data: {
      organizationId,
      companyId,
      driverId: driver.id,
      settlementNumber: `S-${nonce}`,
      periodStart: new Date('2026-07-27T00:00:00Z'),
      periodEnd: new Date('2026-08-02T00:00:00Z'),
    },
  })

  loadDocumentId = (
    await owner.document.create({
      data: {
        organizationId,
        companyId,
        type: 'POD',
        filename: `pod-${nonce}.pdf`,
        r2Key: `${organizationId}/load/${load.id}/${nonce}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        loadId: load.id,
      },
    })
  ).id
  settlementDocumentId = (
    await owner.document.create({
      data: {
        organizationId,
        companyId,
        type: 'SETTLEMENT_PDF',
        filename: `settlement-${nonce}.pdf`,
        r2Key: `${organizationId}/settlement/${settlement.id}/${nonce}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        settlementId: settlement.id,
      },
    })
  ).id
}, 300_000)

afterAll(async () => {
  await owner.organization
    .delete({ where: { id: organizationId } })
    .catch(() => {})
  await owner.user.delete({ where: { id: userId } }).catch(() => {})
  await owner.$disconnect()
})

describe('reading settings', () => {
  it('creates the row for an authority that has none', async () => {
    // The seed writes one; nothing else ever has. An authority added by hand
    // would otherwise show the settings screen nothing to edit.
    expect(
      await owner.companySettings.findUnique({ where: { companyId } }),
    ).toBeNull()

    const rows = await inOrg((tx) => settingsForScope(tx))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      companyId,
      invoiceNumberPrefix: 'INV-',
      settlementWeekEndsOn: 0,
    })
  }, 300_000)
})

describe('§4: settings edits are audited with field-level diffs', () => {
  it('records exactly what moved, and nothing that did not', async () => {
    const before = await owner.auditLog.count({
      where: { entityType: 'CompanySettings' },
    })

    const outcome = await inOrg((tx) =>
      saveSettings(tx, companyId, {
        ...INPUT,
        // Two fields differ from the defaults; every other value in INPUT is
        // exactly what the row already holds.
        invoiceNumberPrefix: 'RAM-',
        settlementWeekEndsOn: '5',
      }),
    )
    expect(outcome).toMatchObject({ ok: true })
    expect(outcome.ok && outcome.changed.sort()).toEqual([
      'invoiceNumberPrefix',
      'settlementWeekEndsOn',
    ])

    const rows = await owner.auditLog.findMany({
      where: { entityType: 'CompanySettings' },
      orderBy: { createdAt: 'desc' },
      take: 1,
      select: { action: true, changes: true, userId: true, companyId: true },
    })
    expect(
      await owner.auditLog.count({
        where: { entityType: 'CompanySettings' },
      }),
    ).toBe(before + 1)

    const changes = rows[0]?.changes as Record<
      string,
      { from: unknown; to: unknown }
    >
    expect(rows[0]?.action).toBe('UPDATE')
    expect(rows[0]?.userId).toBe(userId)

    // THE DIFF ITSELF. From and to, per field.
    expect(changes['invoiceNumberPrefix']).toEqual({
      from: 'INV-',
      to: 'RAM-',
    })
    expect(changes['settlementWeekEndsOn']).toEqual({ from: 0, to: 5 })

    // AND THE FIELDS THAT DID NOT MOVE ARE ABSENT. This is what makes the log
    // readable a year later: a row that listed all twelve fields every time
    // would bury the one that changed.
    expect(changes['invoiceTermsDays']).toBeUndefined()
    expect(changes['complianceWarnDays']).toBeUndefined()
    expect(changes['defaultMpg']).toBeUndefined()
  }, 300_000)

  it('writes ONE audit row per save, not one per field', async () => {
    const before = await owner.auditLog.count({
      where: { entityType: 'CompanySettings' },
    })

    await inOrg((tx) =>
      saveSettings(tx, companyId, {
        ...INPUT,
        invoiceNumberPrefix: 'RAM-',
        settlementWeekEndsOn: '5',
        complianceWarnDays: '14',
        podMissingAlertDays: '5',
        invoiceOverdueDays: '2',
      }),
    )

    expect(
      await owner.auditLog.count({ where: { entityType: 'CompanySettings' } }),
    ).toBe(before + 1)
  }, 300_000)

  it('refuses a bad value without writing anything', async () => {
    const before = await owner.auditLog.count({
      where: { entityType: 'CompanySettings' },
    })
    const settings = await owner.companySettings.findUniqueOrThrow({
      where: { companyId },
      select: { invoiceNumberPrefix: true, updatedAt: true },
    })

    const outcome = await inOrg((tx) =>
      saveSettings(tx, companyId, {
        ...INPUT,
        invoiceNumberPrefix: 'has spaces',
      }),
    )
    expect(outcome).toEqual({
      ok: false,
      reason: 'bad_prefix',
      field: 'invoiceNumberPrefix',
    })

    const after = await owner.companySettings.findUniqueOrThrow({
      where: { companyId },
      select: { invoiceNumberPrefix: true, updatedAt: true },
    })
    // `updatedAt` unchanged is the strongest available proof that nothing was
    // written — a rejected save that still touched the row would move it.
    expect(after.updatedAt.getTime()).toBe(settings.updatedAt.getTime())
    expect(
      await owner.auditLog.count({ where: { entityType: 'CompanySettings' } }),
    ).toBe(before)
  }, 300_000)

  it('and the CHECK refuses a week boundary that is not a day', async () => {
    // The backstop under the service's own refusal, asserted by going around
    // it. A period computed from day 9 would shift every driver's week.
    await expect(
      owner.companySettings.update({
        where: { companyId },
        data: { settlementWeekEndsOn: 9 },
      }),
    ).rejects.toThrow(/settlement_week_ends_on_a_day/)
  }, 300_000)
})

describe('the documents browser', () => {
  it('shows an owner both documents', async () => {
    const rows = await inOrg((tx) => browseDocuments(tx, as('OWNER')))
    const ids = rows.map((row) => row.id)
    expect(ids).toContain(loadDocumentId)
    expect(ids).toContain(settlementDocumentId)
  }, 300_000)

  it('and a dispatcher only the one hanging off something they can open', async () => {
    // THE PAIR, against real rows. A settlement PDF is driver pay in a
    // wrapper; the POD beside it is their own work.
    const rows = await inOrg((tx) => browseDocuments(tx, as('DISPATCHER')))
    const ids = rows.map((row) => row.id)
    expect(ids).toContain(loadDocumentId)
    expect(ids).not.toContain(settlementDocumentId)
  }, 300_000)

  it('names what each one hangs off, with a link where there is a screen', async () => {
    const rows = await inOrg((tx) => browseDocuments(tx, as('OWNER')))
    const pod = rows.find((row) => row.id === loadDocumentId)
    expect(pod?.entity).toBe('load')
    expect(pod?.entityHref).toMatch(/^\/loads\//)
    expect(pod?.uploadedByName).toBeNull()
  }, 300_000)

  it('filters by type and by date window', async () => {
    const pods = await inOrg((tx) =>
      browseDocuments(tx, as('OWNER'), {}, { type: 'POD' }),
    )
    expect(pods.map((row) => row.id)).toEqual([loadDocumentId])

    // A window that ends before anything was filed.
    const none = await inOrg((tx) =>
      browseDocuments(tx, as('OWNER'), {}, { to: '2020-01-01' }),
    )
    expect(none).toEqual([])

    // A window that ends TODAY includes what was filed today — the inclusive
    // end is the difference between "to the 8th" as a person means it and as
    // Postgres would read it.
    const today = new Date().toISOString().slice(0, 10)
    const included = await inOrg((tx) =>
      browseDocuments(tx, as('OWNER'), {}, { from: today, to: today }),
    )
    expect(included.map((row) => row.id)).toContain(loadDocumentId)
  }, 300_000)

  it('ignores an entity filter naming a kind the session cannot read', async () => {
    // Not an error and not an empty list: the permission clause already
    // excludes those rows, so applying the filter would answer the same thing
    // twice. What matters is that it does not somehow widen the result.
    const rows = await inOrg((tx) =>
      browseDocuments(tx, as('DISPATCHER'), {}, { entity: 'settlement' }),
    )
    expect(rows.map((row) => row.id)).not.toContain(settlementDocumentId)
  }, 300_000)
})

describe('the download endpoint asks the same question', () => {
  it('finds the entity a document hangs off', async () => {
    // The listing and the download must agree, or hiding a row from the
    // browser hides nothing at all.
    expect(await inOrg((tx) => entityOfDocument(tx, loadDocumentId))).toBe(
      'load',
    )
    expect(
      await inOrg((tx) => entityOfDocument(tx, settlementDocumentId)),
    ).toBe('settlement')
  }, 300_000)

  it('and answers null for a document that is not there', async () => {
    expect(
      await inOrg((tx) => entityOfDocument(tx, 'ckdoesnotexist000000000')),
    ).toBeNull()
  }, 300_000)
})
