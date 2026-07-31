import type { PrismaClient } from '@/generated/prisma/client'

// ---------------------------------------------------------------------------
// One row in every table that carries a tenant, for one organization.
//
// The isolation test needs both organizations fully populated. A table left
// empty is a table where "sees no rows from the other tenant" is true for the
// boring reason, and the coverage assertion in the test exists to make that
// impossible to do by accident.
//
// Written through the owner connection, which bypasses row-level security —
// that is the point: the data has to exist before we can prove the
// application cannot see it.
// ---------------------------------------------------------------------------

/** Model name (as Prisma delegates spell it) to the ids created for it. */
export type CreatedIds = Record<string, string[]>

export interface OrgFixture {
  organizationId: string
  companyId: string
  userId: string
  ids: CreatedIds
}

export async function seedOrganization(
  db: PrismaClient,
  label: string,
  nonce: string,
): Promise<OrgFixture> {
  const ids: CreatedIds = {}
  const record = <T extends { id: string }>(model: string, row: T): T => {
    ;(ids[model] ??= []).push(row.id)
    return row
  }

  const tag = `${label}-${nonce}`

  const organization = record(
    'organization',
    await db.organization.create({
      data: { name: `Isolation ${label}`, slug: `iso-${tag}`, maxCompanies: 5 },
    }),
  )
  const organizationId = organization.id

  const company = record(
    'company',
    await db.company.create({
      data: {
        organizationId,
        name: `Authority ${label}`,
        dotNumber: `DOT-${tag}`,
      },
    }),
  )
  const companyId = company.id

  record(
    'companySettings',
    await db.companySettings.create({ data: { companyId, organizationId } }),
  )

  const user = record(
    'user',
    await db.user.create({
      data: { email: `owner-${tag}@example.test`, name: `Owner ${label}` },
    }),
  )
  const membership = record(
    'membership',
    await db.membership.create({
      data: { userId: user.id, organizationId, role: 'OWNER' },
    }),
  )
  record(
    'membershipCompany',
    await db.membershipCompany.create({
      data: { membershipId: membership.id, companyId, organizationId },
    }),
  )

  record(
    'counter',
    await db.counter.create({
      data: { organizationId, companyId, key: 'LOAD_NUMBER' },
    }),
  )
  record(
    'integration',
    await db.integration.create({
      data: { organizationId, companyId, provider: 'ELD_GPS' },
    }),
  )

  const truck = record(
    'truck',
    await db.truck.create({
      data: { organizationId, companyId, unitNumber: `T-${tag}` },
    }),
  )
  const trailer = record(
    'trailer',
    await db.trailer.create({
      data: { organizationId, companyId, unitNumber: `R-${tag}` },
    }),
  )
  const driver = record(
    'driver',
    await db.driver.create({
      data: { organizationId, companyId, firstName: 'Test', lastName: label },
    }),
  )
  record(
    'driverPayRule',
    await db.driverPayRule.create({
      data: {
        driverId: driver.id,
        organizationId,
        type: 'PERCENT_GROSS',
        percentBps: 3000,
        effectiveFrom: new Date('2026-01-01'),
      },
    }),
  )
  record(
    'complianceItem',
    await db.complianceItem.create({
      data: {
        organizationId,
        companyId,
        type: 'INSURANCE_LIABILITY',
        expiresAt: new Date('2027-01-01'),
      },
    }),
  )
  record(
    'assetAssignment',
    await db.assetAssignment.create({
      data: { organizationId, companyId, truckId: truck.id },
    }),
  )

  const customer = record(
    'customer',
    await db.customer.create({
      data: { organizationId, name: `Broker ${label}` },
    }),
  )
  record(
    'customerContact',
    await db.customerContact.create({
      data: {
        customerId: customer.id,
        organizationId,
        name: `Contact ${label}`,
      },
    }),
  )
  record(
    'location',
    await db.location.create({
      data: { organizationId, name: `Facility ${label}` },
    }),
  )
  record(
    'factoringCompany',
    await db.factoringCompany.create({
      data: { organizationId, name: `Factor ${label}` },
    }),
  )

  const load = record(
    'load',
    await db.load.create({
      data: {
        organizationId,
        companyId,
        loadNumber: `L-${tag}`,
        customerId: customer.id,
        truckId: truck.id,
        trailerId: trailer.id,
        driverId: driver.id,
        linehaulCents: 250000,
        totalRevenueCents: 250000,
      },
    }),
  )
  record(
    'loadStop',
    await db.loadStop.create({
      data: { loadId: load.id, organizationId, sequence: 1, type: 'PICKUP' },
    }),
  )
  record(
    'loadAccessorial',
    await db.loadAccessorial.create({
      data: {
        loadId: load.id,
        organizationId,
        type: 'DETENTION',
        amountCents: 15000,
      },
    }),
  )
  record(
    'loadStatusEvent',
    await db.loadStatusEvent.create({
      data: {
        loadId: load.id,
        organizationId,
        axis: 'OPERATIONAL',
        toStatus: 'BOOKED',
      },
    }),
  )
  record(
    'loadAssignment',
    await db.loadAssignment.create({
      data: {
        loadId: load.id,
        organizationId,
        truckId: truck.id,
        driverId: driver.id,
      },
    }),
  )
  record(
    'claim',
    await db.claim.create({
      data: {
        organizationId,
        companyId,
        type: 'CARGO_DAMAGE',
        loadId: load.id,
      },
    }),
  )
  record(
    'document',
    await db.document.create({
      data: {
        organizationId,
        companyId,
        r2Key: `${organizationId}/load/${load.id}/${tag}-ratecon.pdf`,
        filename: 'ratecon.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        type: 'RATE_CONFIRMATION',
        loadId: load.id,
      },
    }),
  )

  record(
    'pendingUpload',
    await db.pendingUpload.create({
      data: {
        organizationId,
        companyId,
        r2Key: `${organizationId}/load/${load.id}/${tag}-pending.pdf`,
        filename: 'pending.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        sha256: 'x'.repeat(43) + '=',
        type: 'POD',
        targetEntity: 'load',
        targetId: load.id,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    }),
  )

  const invoice = record(
    'invoice',
    await db.invoice.create({
      data: {
        organizationId,
        companyId,
        invoiceNumber: `INV-${tag}`,
        customerId: customer.id,
        totalCents: 250000,
        balanceCents: 250000,
      },
    }),
  )
  record(
    'invoiceLine',
    await db.invoiceLine.create({
      data: {
        invoiceId: invoice.id,
        organizationId,
        loadId: load.id,
        description: 'Linehaul',
        unitCents: 250000,
        amountCents: 250000,
      },
    }),
  )
  const payment = record(
    'payment',
    await db.payment.create({
      data: {
        organizationId,
        companyId,
        customerId: customer.id,
        method: 'ACH',
        receivedAt: new Date('2026-07-01'),
        amountCents: 250000,
      },
    }),
  )
  record(
    'paymentApplication',
    await db.paymentApplication.create({
      data: {
        paymentId: payment.id,
        invoiceId: invoice.id,
        organizationId,
        amountCents: 250000,
      },
    }),
  )

  const settlement = record(
    'settlement',
    await db.settlement.create({
      data: {
        organizationId,
        companyId,
        settlementNumber: `STL-${tag}`,
        driverId: driver.id,
        periodStart: new Date('2026-07-01'),
        periodEnd: new Date('2026-07-07'),
      },
    }),
  )
  record(
    'settlementLine',
    await db.settlementLine.create({
      data: {
        settlementId: settlement.id,
        organizationId,
        loadId: load.id,
        type: 'LOAD_PAY',
        description: 'Load pay',
        amountCents: 75000,
      },
    }),
  )

  record(
    'expense',
    await db.expense.create({
      data: {
        organizationId,
        companyId,
        incurredAt: new Date('2026-07-02'),
        category: 'TOLLS',
        amountCents: 4200,
      },
    }),
  )
  record(
    'fuelTransaction',
    await db.fuelTransaction.create({
      data: {
        organizationId,
        companyId,
        purchasedAt: new Date('2026-07-02'),
        truckId: truck.id,
        gallons: 120.5,
        totalCents: 48000,
        state: 'IL',
      },
    }),
  )
  record(
    'maintenanceRecord',
    await db.maintenanceRecord.create({
      data: {
        organizationId,
        companyId,
        truckId: truck.id,
        servicedAt: new Date('2026-06-15'),
        category: 'OIL_CHANGE',
      },
    }),
  )
  record(
    'iftaMileage',
    await db.iftaMileage.create({
      data: {
        organizationId,
        companyId,
        truckId: truck.id,
        periodYear: 2026,
        periodQuarter: 2,
        jurisdiction: 'IL',
        totalMiles: 1200,
      },
    }),
  )

  record(
    'communication',
    await db.communication.create({
      data: {
        organizationId,
        companyId,
        loadId: load.id,
        type: 'NOTE',
        body: 'Booked.',
      },
    }),
  )
  record(
    'notification',
    await db.notification.create({
      data: {
        organizationId,
        companyId,
        type: 'POD_MISSING',
        title: 'POD missing',
        dedupeKey: `pod-${tag}`,
      },
    }),
  )
  record(
    'calendarEvent',
    await db.calendarEvent.create({
      data: {
        organizationId,
        companyId,
        title: 'Annual inspection',
        startsAt: new Date('2026-08-01'),
      },
    }),
  )
  record(
    'userPreference',
    await db.userPreference.create({
      data: {
        organizationId,
        userId: user.id,
        key: 'view.loads',
        value: [
          { slug: 'mine', name: 'My trucks today', query: 'status=BOOKED' },
        ],
      },
    }),
  )
  record(
    'auditLog',
    await db.auditLog.create({
      data: {
        organizationId,
        companyId,
        userId: user.id,
        action: 'CREATE',
        entityType: 'Load',
        entityId: load.id,
      },
    }),
  )

  return { organizationId, companyId, userId: user.id, ids }
}

/**
 * Remove a fixture. Organization cascades to everything that hangs off it;
 * User does not, having no organization to hang from.
 *
 * Errors are not swallowed. A teardown that fails quietly leaves rows behind
 * and the next run inherits them — which is exactly how the cascade defect
 * fixed in 20260728233000 stayed invisible for a while.
 */
export async function dropOrganization(
  db: PrismaClient,
  fixture: OrgFixture,
): Promise<void> {
  await db.organization.delete({ where: { id: fixture.organizationId } })
  await db.user.delete({ where: { id: fixture.userId } })
}
