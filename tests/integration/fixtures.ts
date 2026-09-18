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
  const claim = record(
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

  // Mail that arrived at this tenant's load inbox (Phase 6 §4 step 4). The one
  // table freight enters through with no dispatcher present — nobody chose the
  // tenant, a mail server did — so proving the policy hides it from the other
  // organization is the whole point of seeding it here.
  record(
    'inboundEmail',
    await db.inboundEmail.create({
      data: {
        organizationId,
        messageId: `<${tag}@zebratms.test>`,
        fromAddress: 'relay-noreply@amazon.test',
        toAddress: `loads+${tag}@zebratms.test`,
        subject: `Load Board - Trip ${tag} booked`,
        bodyText: `Trip ${tag} booked. AAA1 SPRINGFIELD, OH > BBB2 FRANKLIN, IL`,
        state: 'REVIEW',
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
  // The other application path — a payment against a LOAD, which is how
  // direct-settled freight is paid. It carries a tenant, so the wall has to
  // hold for it too, and this suite only proves what the fixture populates.
  record(
    'paymentLoadApplication',
    await db.paymentLoadApplication.create({
      data: {
        paymentId: payment.id,
        loadId: load.id,
        organizationId,
        amountCents: 1,
      },
    }),
  )

  // ONE OPENING BALANCE, so the isolation proof has a row to hide. Stated and
  // dated like a real one — the figure is transcribed from a statement and the
  // source names which, because a balance nobody can recompute has to be
  // checkable against the paper it came from.
  record(
    'driverOpeningBalance',
    await db.driverOpeningBalance.create({
      data: {
        organizationId,
        driverId: driver.id,
        year: 2026,
        category: 'EARNINGS',
        amountCents: 14672164,
        asOf: new Date('2026-08-15'),
        source: `ST-${tag}`,
      },
    }),
  )

  record(
    'recurringDeduction',
    await db.recurringDeduction.create({
      data: {
        organizationId,
        driverId: driver.id,
        type: 'Insurance',
        description: 'Insurance (GL, AL, Cargo, TI) for {month} {split}',
        amountCents: 45000,
        cadence: 'MONTHLY_SPLIT_WEEKLY',
        monthlyTotalCents: 180000,
        effectiveFrom: new Date('2026-08-01'),
      },
    }),
  )
  record(
    'settlementCharge',
    await db.settlementCharge.create({
      data: {
        organizationId,
        driverId: driver.id,
        type: 'Other',
        description: 'Charge for late Del',
        amountCents: -25000,
        appliesOn: new Date('2026-08-18'),
      },
    }),
  )
  record(
    'driverEscrowEntry',
    await db.driverEscrowEntry.create({
      data: {
        organizationId,
        driverId: driver.id,
        amountCents: 25000,
        occurredAt: new Date('2026-08-18'),
      },
    }),
  )

  // The SB-/ST- series. ORGANIZATION-SCOPED, so isolation matters more here
  // than on a per-company counter: two tenants sharing a series would let one
  // infer the other's settlement volume from the gaps in its own numbers.
  record(
    'seriesCounter',
    await db.seriesCounter.create({
      data: { organizationId, key: `SETTLEMENT_BATCH-${tag}`, value: 5000 },
    }),
  )

  // MONEY-DESIGN item 3 — the batch, and the two line tables under it.
  //
  // SEEDED HERE IN THE SAME COMMIT AS THE MIGRATION, because "sees no rows from
  // the other organization" is trivially true of a table with nothing in it,
  // which is the most comfortable way to be wrong.
  const batch = record(
    'settlementBatch',
    await db.settlementBatch.create({
      data: {
        organizationId,
        periodStart: new Date('2026-07-01'),
        periodEnd: new Date('2026-07-07'),
        statementDate: new Date('2026-07-08'),
        checkDate: new Date('2026-07-10'),
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
        batchId: batch.id,
        periodStart: new Date('2026-07-01'),
        periodEnd: new Date('2026-07-07'),
      },
    }),
  )
  record(
    'settlementLoadLine',
    await db.settlementLoadLine.create({
      data: {
        settlementId: settlement.id,
        organizationId,
        // Whose line it is. Half the uniqueness key since team driving.
        driverId: driver.id,
        loadId: load.id,
        loadNumber: `L-${tag}`,
        companyId,
        companyName: `Co ${tag}`,
        puPlace: 'Whiteland,IN',
        delPlace: 'Gastonia,NC',
        puDate: new Date('2026-07-02'),
        delDate: new Date('2026-07-03'),
        grossCents: 100000,
        milesHundredths: 25000,
        amountCents: 30000,
        settledBasis: 'rate',
      },
    }),
  )
  record(
    'settlementDeductionLine',
    await db.settlementDeductionLine.create({
      data: {
        settlementId: settlement.id,
        organizationId,
        type: 'Escrow',
        description: 'Security Deposit $2500/$250',
        rateCents: 25000,
        totalCents: -25000,
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
  // PHASE 4's FIVE. Added when the full integration suite failed this
  // fixture's own coverage check — `roadsideInspection`, `inspectionViolation`,
  // `dataQsChallenge`, `claimParty` and `claimNote` all carry a tenant, all
  // have an `org_isolation` policy, and none of them had a row here. The
  // coverage test's comment had already named the failure: "sees no rows from
  // the other organization" passes for any table the fixture forgot, which is
  // the most comfortable way to be wrong.
  const inspection = record(
    'roadsideInspection',
    await db.roadsideInspection.create({
      data: {
        organizationId,
        companyId,
        truckId: truck.id,
        inspectedAt: new Date('2026-06-20'),
        level: 'LEVEL_1',
        state: 'IN',
        reportNumber: `${tag}-IN26`,
      },
    }),
  )
  const violation = record(
    'inspectionViolation',
    await db.inspectionViolation.create({
      data: {
        // Written by the set_org trigger from the inspection; passed only
        // because Prisma requires the field.
        organizationId: '',
        inspectionId: inspection.id,
        code: '393.75A3',
        unit: 'VEHICLE',
        outOfService: true,
      },
    }),
  )
  record(
    'dataQsChallenge',
    await db.dataQsChallenge.create({
      data: {
        organizationId,
        companyId,
        inspectionId: inspection.id,
        violationId: violation.id,
        basis: 'The tire was on a trailer we had already dropped.',
      },
    }),
  )
  record(
    'claimParty',
    await db.claimParty.create({
      data: {
        // Derived by set_org from the claim, like the violation above.
        organizationId: '',
        claimId: claim.id,
        role: 'ADJUSTER',
        name: `${tag} Adjuster`,
      },
    }),
  )
  record(
    'claimNote',
    await db.claimNote.create({
      data: {
        organizationId: '',
        claimId: claim.id,
        body: 'Photographs requested.',
        toStatus: 'OPEN',
      },
    }),
  )
  // PHASE 5's TWO. `tests/isolation-coverage.test.ts` named them by the time
  // the migration had finished applying, which is the whole point of writing
  // that guard — five Phase 4 tables went two phases without one.
  record(
    'customerAlias',
    await db.customerAlias.create({
      data: {
        organizationId,
        customerId: customer.id,
        alias: `${tag} Freight Partners`,
        normalized: `${tag.toUpperCase()} FREIGHT PARTNERS`,
      },
    }),
  )
  record(
    'extractionCorrection',
    await db.extractionCorrection.create({
      data: {
        organizationId,
        loadId: load.id,
        field: 'brokerName',
        extractedValue: 'Mispelled Logistics',
        correctedValue: `${tag} Freight Partners`,
        confidence: 'medium',
      },
    }),
  )
  // THE COST LEDGER. It carries a tenant and therefore needs a row here in the
  // same commit — `tests/isolation-coverage.test.ts` fails by name otherwise,
  // and "sees no rows from the other organization" is trivially true of an
  // empty table, which is the most comfortable way to be wrong.
  //
  // This one is worth seeding properly rather than minimally: a leak here does
  // not show a wrong load, it shows one carrier what another carrier costs to
  // serve, which is commercial information about a third party.
  record(
    'extractionUsage',
    await db.extractionUsage.create({
      data: {
        organizationId,
        documentType: 'MEDICAL_CARD',
        model: 'gemini-3.6-flash',
        inputTokens: 4_593,
        outputTokens: 1_076,
        milliCents: 1_496,
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
