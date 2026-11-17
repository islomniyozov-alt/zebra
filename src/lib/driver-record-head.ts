import {
  Prisma,
  type Driver,
  type DriverOpeningBalance,
  type RecurringDeduction,
} from '@/generated/prisma/client'
import type { TenantReader } from './tenancy'
import { asDate, asNumber } from './sql-json'
import { shapeRecords, type ComplianceRow } from './compliance'
import { shapeInspections, type InspectionRow } from './inspections'
import { ruleInForce, type PayRuleRow } from './driver-pay'
import {
  dispatchFactsFrom,
  dispatchFactsSql,
  dispatchStatusFrom,
  FINISHED,
  onTimeFrom,
  onTimeRateFrom,
  type DispatchFactsSqlRow,
  type DispatchStatus,
  type OnTimeRate,
} from './dispatch-fields'
import { DISPATCHER_ROLES } from './driver-main'
import {
  dqfDocumentsSql,
  dqfDriversSql,
  dqfFactsFrom,
  type DqfDocumentSqlRow,
  type DqfDriverSqlRow,
  type DqfFacts,
} from './dqf'
import { TRUCK_SEATS, teamMateOf, type TeamMate } from './team'
import type { SignInLinkView } from './driver-link'

// ---------------------------------------------------------------------------
// /drivers/[id] IN ONE STATEMENT (§6.4 part 2 v11.07; owner's ruling
// 2026-11-15, the one-call reads).
//
// Measured on dev before: 23 statements as the owner (page 1,128 ms), 21 as a
// dispatcher — the record, the authorities, trucks, trailers, pay rules,
// deductions, opening balances, the on-time rate, the DQF, the open authority,
// the compliance records with their files and the warning lead, inspections,
// documents, the timezone, the team mate and the sign-in link, each its own
// read inside one transaction. Here they are ONE SELECT with a named CTE each,
// sent through a `TenantReader` (`zebra_tenant_read`, §6.2.9 v11.03), and no
// transaction.
//
// EACH CTE IS A SECOND SPELLING OF A HELPER that other pages still call
// (`recordsForSubject`, `inspectionsForSubject`, `payRulesFor`,
// `teamMateFor`, `signInLinkFor` …), so the enforcer is named:
// `tests/integration/driver-record-head.test.ts` holds every field here equal to
// what those helpers return, on a driver with something in every one.
//
// THE TABS THAT READ MORE (assets, safety, statistics, log) read it in a
// transaction of their own; the record's main tab is this call alone.
// ---------------------------------------------------------------------------

/** Every DateTime column of the three models read whole, by name. */
export const DATE_FIELDS = {
  Driver: [
    'offDutyUntil',
    'hireDate',
    'birthDate',
    'terminationDate',
    'deletedAt',
    'createdAt',
    'updatedAt',
  ],
  RecurringDeduction: ['effectiveFrom', 'effectiveTo', 'createdAt'],
  DriverOpeningBalance: ['asOf', 'createdAt', 'updatedAt'],
} as const

function withDates<T>(
  row: Record<string, unknown>,
  fields: readonly string[],
): T {
  const out: Record<string, unknown> = { ...row }
  for (const field of fields) out[field] = asDate(row[field])
  return out as T
}

export interface DriverRecordInput {
  driverId: string
  organizationId: string
  companyScopes: readonly string[]
  /** Whether to read the sign-in link (the role may update users). */
  withSignIn: boolean
  now: Date
}

export interface DriverRecordHead {
  driver: Driver
  companies: { id: string; name: string }[]
  trucks: { id: string; unitNumber: string; company: { name: string } }[]
  trailers: { id: string; unitNumber: string }[]
  payRules: PayRuleRow[]
  deductions: RecurringDeduction[]
  openingBalances: DriverOpeningBalance[]
  onTimeRate: OnTimeRate
  dqf: DqfFacts
  authority: { companyId: string; since: Date } | null
  compliance: ComplianceRow[]
  complianceDocuments: Map<string, { id: string; filename: string }[]>
  inspections: InspectionRow[]
  documents: {
    id: string
    filename: string
    type: string
    uploadedAt: Date
    ocrStatus: string | null
    supersededByDocumentId: string | null
  }[]
  timezone: string | null
  teamMate: TeamMate | null
  signIn: SignInLinkView | null
  /**
   * §6.4 part 2 v11.22 — who may be this driver's assigned dispatcher: the
   * organization's members in `DISPATCHER_ROLES`, plus whoever already holds
   * the field, so the select never drops the value it is showing.
   */
  dispatchers: { id: string; name: string }[]
  /** §6.4 part 2 v11.22 — the derived dispatch status, never stored. */
  driverStatus: DispatchStatus
}

type Json = Record<string, unknown>

interface HeadRow {
  driver: Json | null
  companies: Json[]
  trucks: Json[]
  trailers: Json[]
  pay_rules: Json[]
  deductions: Json[]
  opening: Json[]
  on_time: Json[]
  dqf_drivers: DqfDriverSqlRow[]
  dqf_documents: DqfDocumentSqlRow[]
  authority: Json | null
  compliance: Json[]
  compliance_lead: number | null
  compliance_documents: Json[]
  inspections: Json[]
  documents: Json[]
  timezone: string | null
  crew: Json[]
  linked_user: Json | null
  candidates: Json[] | null
  dispatchers: Json[]
  dispatch: DispatchFactsSqlRow[]
}

const agg = (name: string, order: string) =>
  Prisma.raw(
    `(SELECT COALESCE(json_agg(x ORDER BY ${order}), '[]'::json) FROM ${name} x) AS ${name}`,
  )

export async function readDriverRecordHead(
  reader: TenantReader,
  input: DriverRecordInput,
): Promise<DriverRecordHead | null> {
  const id = input.driverId
  const scopes = [...input.companyScopes]
  const rows = await reader.read<HeadRow>(Prisma.sql`
    WITH me AS (SELECT * FROM "Driver" WHERE id = ${id}),
    companies AS (
      SELECT c.id, c.name FROM "Company" c
       WHERE c."isActive" AND NOT c.retired
         AND (${scopes.length === 0} OR c.id = ANY(${scopes}::text[]))
    ),
    trucks AS (
      SELECT t.id, t."unitNumber", c.name AS company_name
        FROM "Truck" t JOIN "Company" c ON c.id = t."companyId"
       WHERE t."companyId" = (SELECT "companyId" FROM me)
         AND t."deletedAt" IS NULL AND t.status::text <> 'SOLD'
    ),
    trailers AS (
      SELECT t.id, t."unitNumber" FROM "Trailer" t
       WHERE t."companyId" = (SELECT "companyId" FROM me)
         AND t."deletedAt" IS NULL AND t.status::text <> 'SOLD'
    ),
    pay_rules AS (
      SELECT r.id, r.type::text AS type, r."percentBps", r."perMileCents",
             r."flatCents", r."effectiveFrom", r."effectiveTo", r.notes
        FROM "DriverPayRule" r WHERE r."driverId" = ${id}
    ),
    deductions AS (
      SELECT r.*, r.type AS type_order FROM "RecurringDeduction" r
       WHERE r."driverId" = ${id}
    ),
    opening AS (
      SELECT o.*, o.category AS category_order FROM "DriverOpeningBalance" o
       WHERE o."driverId" = ${id}
    ),
    on_time AS (
      SELECT s."arrivedAt" AS arrived_at, s."windowEnd" AS window_end,
             s."scheduledAt" AS scheduled_at
        FROM "Load" l
        CROSS JOIN LATERAL (
          SELECT st."arrivedAt", st."windowEnd", st."scheduledAt"
            FROM "LoadStop" st
           WHERE st."loadId" = l."id" AND st."type" = 'DELIVERY'
           ORDER BY st."sequence" DESC
           LIMIT 1
        ) s
       WHERE (l."driverId" = ${id} OR l."coDriverId" = ${id})
         AND l."deletedAt" IS NULL
         AND l."isCancelled" = false
         AND l."operationalStatus"::text = ANY(${[...FINISHED]}::text[])
    ),
    dqf_drivers AS (${dqfDriversSql([id])}),
    dqf_documents AS (${dqfDocumentsSql([id])}),
    authority AS (
      SELECT a."companyId", a."effectiveFrom" FROM "AssetAssignment" a
       WHERE a."driverId" = ${id} AND a."effectiveTo" IS NULL
       LIMIT 1
    ),
    compliance AS (
      SELECT ci.id, ci."companyId", ci.type::text AS type, ci.identifier,
             ci.issuer, ci."issuedAt", ci."expiresAt", ci.notes,
             co.name AS company_name,
             tr.id AS truck_id, tr."unitNumber" AS truck_unit,
             tl.id AS trailer_id, tl."unitNumber" AS trailer_unit,
             dr.id AS driver_id, dr."firstName" AS driver_first,
             dr."lastName" AS driver_last,
             (SELECT COUNT(*) FROM "Document" doc
               WHERE doc."complianceItemId" = ci.id)::int AS document_count
        FROM "ComplianceItem" ci
        JOIN "Company" co ON co.id = ci."companyId"
        LEFT JOIN "Truck" tr ON tr.id = ci."truckId"
        LEFT JOIN "Trailer" tl ON tl.id = ci."trailerId"
        LEFT JOIN "Driver" dr ON dr.id = ci."driverId"
       WHERE ci."deletedAt" IS NULL AND ci."driverId" = ${id}
    ),
    compliance_documents AS (
      SELECT doc.id, doc.filename, doc."complianceItemId", doc."uploadedAt"
        FROM "Document" doc
       WHERE doc."complianceItemId" IN (SELECT id FROM compliance)
         AND doc."deletedAt" IS NULL
    ),
    inspections AS (
      SELECT ri.id, ri."companyId", ri."inspectedAt", ri.level::text AS level,
             ri.state, ri."reportNumber", ri.location, ri."inspectorName",
             ri.notes, co.name AS company_name,
             tr.id AS truck_id, tr."unitNumber" AS truck_unit,
             tl.id AS trailer_id, tl."unitNumber" AS trailer_unit,
             dr.id AS driver_id, dr."firstName" AS driver_first,
             dr."lastName" AS driver_last,
             (SELECT COUNT(*) FROM "Document" doc
               WHERE doc."inspectionId" = ri.id)::int AS document_count,
             (SELECT COALESCE(json_agg(json_build_object(
                       'id', v.id, 'code', v.code, 'description', v.description,
                       'unit', v.unit::text, 'outOfService', v."outOfService",
                       'severityWeight', v."severityWeight")
                     ORDER BY v."outOfService" DESC, v.code ASC), '[]'::json)
                FROM "InspectionViolation" v
               WHERE v."inspectionId" = ri.id AND v."deletedAt" IS NULL) AS violations
        FROM "RoadsideInspection" ri
        JOIN "Company" co ON co.id = ri."companyId"
        LEFT JOIN "Truck" tr ON tr.id = ri."truckId"
        LEFT JOIN "Trailer" tl ON tl.id = ri."trailerId"
        LEFT JOIN "Driver" dr ON dr.id = ri."driverId"
       WHERE ri."deletedAt" IS NULL AND ri."driverId" = ${id}
       ORDER BY ri."inspectedAt" DESC
       LIMIT 200
    ),
    documents AS (
      SELECT doc.id, doc.filename, doc.type::text AS type, doc."uploadedAt",
             doc."ocrStatus"::text AS "ocrStatus", doc."supersededByDocumentId"
        FROM "Document" doc
       WHERE doc."driverId" = ${id} AND doc."deletedAt" IS NULL
       ORDER BY doc."uploadedAt" DESC
       LIMIT 50
    ),
    crew AS (
      SELECT d.id, d."firstName", d."lastName", d.kind, d."updatedAt",
             t."unitNumber" AS truck_unit
        FROM me
        JOIN "Truck" t ON t.id = me."assignedTruckId"
        JOIN "Driver" d ON d."assignedTruckId" = me."assignedTruckId"
       WHERE d."deletedAt" IS NULL AND d.status::text <> 'INACTIVE'
       ORDER BY d."updatedAt" ASC
       LIMIT ${TRUCK_SEATS + 1}
    ),
    -- §6.4 part 2 v11.22: the dispatcher picker — the members whose role
    -- dispatches, and whoever already holds the field.
    dispatchers AS (
      SELECT u.id, u.name FROM "Membership" m JOIN "User" u ON u.id = m."userId"
       WHERE m."organizationId" = ${input.organizationId}
         AND m.role::text = ANY(${[...DISPATCHER_ROLES]}::text[])
      UNION
      SELECT u.id, u.name FROM me JOIN "User" u ON u.id = me."dispatcherUserId"
    ),
    -- …and the facts the derived driver status reads, the list's own text.
    dispatch AS (${dispatchFactsSql([id])})
    SELECT
      (SELECT row_to_json(x) FROM me x) AS driver,
      ${agg('companies', 'x.name, x.id')},
      ${agg('trucks', 'x."unitNumber", x.id')},
      ${agg('trailers', 'x."unitNumber", x.id')},
      ${agg('pay_rules', 'x."effectiveFrom" DESC, x.id')},
      ${agg('deductions', 'x."effectiveFrom" DESC, x.type_order, x.id')},
      ${agg('opening', 'x.year DESC, x.category_order, x.id')},
      ${agg('on_time', 'x.arrived_at, x.window_end, x.scheduled_at')},
      ${agg('dqf_drivers', 'x.id')},
      ${agg('dqf_documents', 'x.id')},
      (SELECT row_to_json(x) FROM authority x) AS authority,
      ${agg('compliance', 'x."expiresAt" DESC, x.id')},
      (SELECT COALESCE(MAX(cs."complianceWarnDays"), 30)::int
         FROM "CompanySettings" cs
        WHERE NOT EXISTS (SELECT 1 FROM compliance)
           OR cs."companyId" = (SELECT "companyId" FROM compliance
                                 ORDER BY "expiresAt" DESC, id LIMIT 1)) AS compliance_lead,
      ${agg('compliance_documents', 'x."uploadedAt" DESC, x.id')},
      ${agg('inspections', 'x."inspectedAt" DESC, x.id')},
      ${agg('documents', 'x."uploadedAt" DESC, x.id')},
      (SELECT c.timezone FROM "Company" c
        WHERE c.id = (SELECT "companyId" FROM me)) AS timezone,
      ${agg('crew', 'x."updatedAt", x.id')},
      ${agg('dispatchers', 'x.name, x.id')},
      ${agg('dispatch', 'x.id')},
      ${
        input.withSignIn
          ? Prisma.sql`(SELECT json_build_object('id', u.id, 'name', u.name,
                         'email', u.email, 'isActive', u."isActive",
                         'lastLoginAt', u."lastLoginAt")
                          FROM me JOIN "User" u ON u.id = me."userId") AS linked_user,
            (SELECT COALESCE(json_agg(json_build_object('id', u.id, 'name', u.name,
                      'email', u.email, 'isActive', u."isActive",
                      'lastLoginAt', u."lastLoginAt") ORDER BY u.name, u.id), '[]'::json)
               FROM "Membership" m JOIN "User" u ON u.id = m."userId"
              WHERE m."organizationId" = ${input.organizationId}
                AND m.role::text = 'DRIVER'
                AND NOT EXISTS (
                  SELECT 1 FROM "Driver" p
                   WHERE p."userId" = u.id
                     AND p."organizationId" = ${input.organizationId}
                     AND p."deletedAt" IS NULL)) AS candidates`
          : Prisma.sql`NULL::json AS linked_user, NULL::json AS candidates`
      }
  `)
  const row = rows[0]
  if (!row?.driver) return null

  const driver = withDates<Driver>(row.driver, DATE_FIELDS.Driver)

  const rules = row.pay_rules.map((rule) =>
    withDates<Omit<PayRuleRow, 'isCurrent'>>(rule, [
      'effectiveFrom',
      'effectiveTo',
    ]),
  )
  const current = ruleInForce(rules, input.now)

  const strip = (value: Json, ...keys: string[]) => {
    const out = { ...value }
    for (const key of keys) delete out[key]
    return out
  }

  const compliance = shapeRecords(
    row.compliance.map((r) => ({
      id: r.id as string,
      companyId: r.companyId as string,
      type: r.type as ComplianceRow['type'],
      identifier: r.identifier as string | null,
      issuer: r.issuer as string | null,
      issuedAt: asDate(r.issuedAt),
      expiresAt: asDate(r.expiresAt) as Date,
      notes: r.notes as string | null,
      company: { name: r.company_name as string },
      truck: r.truck_id
        ? { id: r.truck_id as string, unitNumber: r.truck_unit as string }
        : null,
      trailer: r.trailer_id
        ? { id: r.trailer_id as string, unitNumber: r.trailer_unit as string }
        : null,
      driver: r.driver_id
        ? {
            id: r.driver_id as string,
            firstName: r.driver_first as string,
            lastName: r.driver_last as string,
          }
        : null,
      _count: { documents: asNumber(r.document_count) },
    })),
    row.compliance_lead ?? 30,
    input.now,
  )
  const complianceDocuments = new Map<
    string,
    { id: string; filename: string }[]
  >()
  for (const doc of row.compliance_documents) {
    const key = doc.complianceItemId as string
    const list = complianceDocuments.get(key) ?? []
    list.push({ id: doc.id as string, filename: doc.filename as string })
    complianceDocuments.set(key, list)
  }

  type Stored = Parameters<typeof shapeInspections>[0][number]
  const inspections = shapeInspections(
    row.inspections.map(
      (r) =>
        ({
          id: r.id,
          companyId: r.companyId,
          inspectedAt: asDate(r.inspectedAt),
          level: r.level,
          state: r.state,
          reportNumber: r.reportNumber,
          location: r.location,
          inspectorName: r.inspectorName,
          notes: r.notes,
          company: { name: r.company_name },
          truck: r.truck_id
            ? { id: r.truck_id, unitNumber: r.truck_unit }
            : null,
          trailer: r.trailer_id
            ? { id: r.trailer_id, unitNumber: r.trailer_unit }
            : null,
          driver: r.driver_id
            ? {
                id: r.driver_id,
                firstName: r.driver_first,
                lastName: r.driver_last,
              }
            : null,
          violations: r.violations,
          _count: { documents: asNumber(r.document_count) },
        }) as unknown as Stored,
    ),
  )

  const crew = row.crew as unknown as {
    id: string
    firstName: string
    lastName: string
    kind: string
    truck_unit: string
  }[]
  const mate = teamMateOf(crew, id)
  const user = (u: Json | null) =>
    u
      ? {
          userId: u.id as string,
          name: u.name as string,
          email: u.email as string,
          isActive: u.isActive as boolean,
          lastLoginAt: asDate(u.lastLoginAt),
        }
      : null

  return {
    driver,
    companies: row.companies as unknown as { id: string; name: string }[],
    trucks: row.trucks.map((t) => ({
      id: t.id as string,
      unitNumber: t.unitNumber as string,
      company: { name: t.company_name as string },
    })),
    trailers: row.trailers as unknown as { id: string; unitNumber: string }[],
    payRules: rules.map((rule) => ({
      ...rule,
      isCurrent: rule.id === current?.id,
    })),
    deductions: row.deductions.map((d) =>
      withDates<RecurringDeduction>(
        strip(d, 'type_order'),
        DATE_FIELDS.RecurringDeduction,
      ),
    ),
    openingBalances: row.opening.map((o) =>
      withDates<DriverOpeningBalance>(
        strip(o, 'category_order'),
        DATE_FIELDS.DriverOpeningBalance,
      ),
    ),
    onTimeRate: onTimeRateFrom(
      row.on_time.map((r) =>
        onTimeFrom({
          arrivedAt: asDate(r.arrived_at),
          windowEnd: asDate(r.window_end),
          scheduledAt: asDate(r.scheduled_at),
        }),
      ),
    ),
    dqf: dqfFactsFrom(row.dqf_drivers, row.dqf_documents).get(id) ?? {
      hireDate: null,
      compliance: [],
      documents: [],
    },
    authority: row.authority
      ? {
          companyId: row.authority.companyId as string,
          since: asDate(row.authority.effectiveFrom) as Date,
        }
      : null,
    compliance,
    complianceDocuments,
    inspections,
    documents: row.documents.map((d) => ({
      id: d.id as string,
      filename: d.filename as string,
      type: d.type as string,
      uploadedAt: asDate(d.uploadedAt) as Date,
      ocrStatus: d.ocrStatus as string | null,
      supersededByDocumentId: d.supersededByDocumentId as string | null,
    })),
    timezone: row.timezone,
    teamMate: mate
      ? {
          id: mate.id,
          firstName: mate.firstName,
          lastName: mate.lastName,
          truckUnit: mate.truck_unit,
        }
      : null,
    signIn: input.withSignIn
      ? row.linked_user
        ? { linked: user(row.linked_user)!, candidates: [] }
        : {
            linked: null,
            candidates: (row.candidates ?? []).map((u) => user(u)!),
          }
      : null,
    dispatchers: row.dispatchers as unknown as { id: string; name: string }[],
    driverStatus: dispatchStatusFrom(
      dispatchFactsFrom(row.dispatch).get(id) ?? {
        rosterStatus: driver.status,
        isOffDuty: driver.isOffDuty,
        offDutyUntil: driver.offDutyUntil,
        activeStatuses: [],
      },
      input.now,
    ),
  }
}
