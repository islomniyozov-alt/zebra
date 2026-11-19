import {
  Prisma,
  type ComplianceType,
  type DocumentType,
} from '@/generated/prisma/client'
import type { TxClient } from './tenancy'
import { daysUntil } from './compliance'
import { asDate } from './sql-json'
import { isReferralPayee } from './driver-kind'

// ---------------------------------------------------------------------------
// THE DRIVER QUALIFICATION FILE — ONE DEFINITION, IN ONE PLACE.
//
// Item 13. 49 CFR 391.51 lists what a motor carrier must keep for every driver
// it employs, and an FMCSA audit walks that list. Before this file, Zebra held
// two of the eight items in a hand-written array in `warnings.ts` and the
// other six nowhere at all.
//
// ── THIS IS THE ONLY DEFINITION OF "REQUIRED" ────────────────────────────
//
// `warnings.ts` no longer carries its own list: `REQUIRED_DRIVER_DOCUMENTS` is
// derived from `DQF_REQUIREMENTS` below. That is the whole point of the file
// and it is guarded by name — two lists is two chances to add a requirement to
// one of them, and the one that would not get updated is the one nobody is
// looking at when the auditor arrives.
//
// ── WHERE THE EVIDENCE LIVES, AND WHY IT IS TWO PLACES ───────────────────
//
// An item that EXPIRES is a `ComplianceItem`: it has a date, the date is the
// fact, and `statusFor` already derives current/expiring/expired from it. An
// item that does NOT expire is a `Document` on the driver: an employment
// application is filed once and stays filed.
//
// The split is forced rather than chosen. `ComplianceItem.expiresAt` is NOT
// NULL, so filing an application as a compliance record would mean inventing
// an expiry date for a thing that has none — and an invented date is a date
// that will eventually raise or suppress an alarm about nothing.
//
// ── AT HIRE, OR ANNUAL ───────────────────────────────────────────────────
//
// `at_hire` is once, at the start, and it never lapses. `annual` means at hire
// AND every twelve months after — §391.25 and §382.701 both read that way, and
// for those the renewal date is what the checklist actually watches.
//
// ── A TERMINATED DRIVER IS NOT AN INCOMPLETE FILE ────────────────────────
//
// §391.51(c) requires the file be kept for three years after the driver leaves
// — kept, not kept CURRENT. The Datatruck import brought 69 terminated drivers
// and 39 applicants who last drove in 2025; warning that each of them is
// missing an annual MVR would put 108 alarms on a screen about people nobody
// employs. `isQualifiable` is the filter, and item 9's closed-history posture
// is where it comes from.
// ---------------------------------------------------------------------------

/** Filed once at hire, or renewed every twelve months. */
export type DqfCadence = 'at_hire' | 'annual'

/**
 * The five rows (owner's ruling 2026-11-19, TMS v11.34). The keys are the
 * label keys; `application` is labelled "Contract", `mvr` "MVR" and
 * `medical_certificate` "Medical card".
 */
export type DqfKey =
  | 'application'
  | 'road_test'
  | 'cdl_copy'
  | 'mvr'
  | 'medical_certificate'

/**
 * Evidence is a dated compliance record, an undated document on file, or
 * EITHER of the two.
 *
 * `either` (queue item 20 (4)): the copy of the CDL is satisfied by the
 * `CDL_COPY` document OR by the live CDL compliance record the alerts already
 * watch — the licence itself, with its expiry. When only the record is there
 * the row reads by its date, the way the medical certificate does.
 *
 * The hire date was a `fact` row (2026-11-17) and is no longer in the file
 * (v11.34): it stays a field on Main.
 */
export type DqfEvidence =
  | { kind: 'compliance'; type: ComplianceType }
  | { kind: 'document'; type: DocumentType }
  | { kind: 'either'; document: DocumentType; compliance: ComplianceType }

export interface DqfRequirement {
  key: DqfKey
  /** The section an auditor will cite. Printed on the screen, not decoration. */
  cfr: string
  cadence: DqfCadence
  evidence: DqfEvidence
}

/**
 * THE FIVE, in the owner's order (ruling 2026-11-19, TMS v11.34): Contract,
 * Road test, Copy of the CDL, MVR, Medical card.
 *
 * REMOVED BY THE SAME RULING: hire date recorded, prior-employer inquiries,
 * the annual review of the driving record and the clearinghouse query. Every
 * reader — the checklist, its summary, the roster's totals, the readiness
 * badge and the compliance warnings (`DQF_COMPLIANCE_TYPES`) — reads this
 * list, so a row removed here is removed everywhere at once.
 */
export const DQF_REQUIREMENTS: readonly DqfRequirement[] = [
  {
    key: 'application',
    cfr: '391.21',
    cadence: 'at_hire',
    evidence: { kind: 'document', type: 'EMPLOYMENT_APPLICATION' },
  },
  {
    key: 'road_test',
    cfr: '391.31 / 391.33',
    cadence: 'at_hire',
    evidence: { kind: 'document', type: 'ROAD_TEST_CERTIFICATE' },
  },
  {
    key: 'cdl_copy',
    cfr: '391.51(b)(8)',
    cadence: 'at_hire',
    // THE COPY, OR THE LICENCE RECORD ITSELF (queue item 20 (4)). A driver
    // whose licence is on file as the dated ComplianceItem the alerts watch
    // showed this row missing for want of a second upload of the same card.
    evidence: { kind: 'either', document: 'CDL_COPY', compliance: 'CDL' },
  },
  {
    key: 'mvr',
    cfr: '391.23(a)(1) / 391.25(a)',
    cadence: 'annual',
    evidence: { kind: 'compliance', type: 'MVR' },
  },
  {
    key: 'medical_certificate',
    cfr: '391.43',
    cadence: 'annual',
    evidence: { kind: 'compliance', type: 'MEDICAL_CARD' },
  },
]

/**
 * The compliance types the DQF requires — THE ONE SOURCE item 9 now reads.
 *
 * `warnings.ts` used to hold `['CDL', 'MEDICAL_CARD']` written by hand. It now
 * imports this, so adding a requirement below adds it to the warning at the
 * same moment. The guard is named "two definitions of required".
 *
 * CDL IS NOT HERE, and that is not an omission. The DQF item is a COPY of the
 * licence on file (§391.51(b)(8)), which is a document; the licence's own
 * expiry is tracked as a `ComplianceItem` of type CDL by Phase 4 and warns
 * through the same mechanism already. Two different facts, both watched.
 */
export const DQF_COMPLIANCE_TYPES: readonly ComplianceType[] =
  DQF_REQUIREMENTS.filter((r) => r.evidence.kind === 'compliance').map(
    (r) => (r.evidence as { kind: 'compliance'; type: ComplianceType }).type,
  )

/**
 * The document types a file can hold — the plain document rows AND the
 * document half of an `either`, because a CDL_COPY is still a document on
 * file. The compliance half of an `either` is deliberately NOT in
 * `DQF_COMPLIANCE_TYPES` above: the CDL record's expiry already warns through
 * Phase 4, and listing it there would warn twice for one date.
 */
export const DQF_DOCUMENT_TYPES: readonly DocumentType[] =
  DQF_REQUIREMENTS.flatMap((r) =>
    r.evidence.kind === 'document'
      ? [r.evidence.type]
      : r.evidence.kind === 'either'
        ? [r.evidence.document]
        : [],
  )

// ── the checklist ────────────────────────────────────────────────────────

/**
 * `due` is not `expired` and `missing` is not either.
 *
 *   present  — on file, and if it carries a date that date is comfortably ahead
 *   due      — on file, renewal inside the lead window. Still qualifying today.
 *   expired  — on file, the date has passed. NOT qualifying.
 *   missing  — nothing on file at all. Never qualified.
 *
 * `expired` and `missing` are both failures and they are DIFFERENT failures:
 * one has a record to renew and a person who knows where it came from, the
 * other has nothing and somebody has to go and obtain it.
 */
export type DqfStatus = 'present' | 'due' | 'expired' | 'missing'

export interface DqfEntry {
  key: DqfKey
  cfr: string
  cadence: DqfCadence
  status: DqfStatus
  /**
   * WHEN IT TURNED DUE — for a dated item that is `due` or `expired`, the
   * expiry itself: the day it lapses or lapsed.
   *
   * NULL FOR `missing` (v11.34): it was the hire date, so a file with no hire
   * date read "since no hire date recorded" on every row. "Since" no longer
   * depends on the hire date. Null for `present`.
   */
  dueSince: Date | null
}

/** The lead window a renewal shows up in. Matches the compliance panel's. */
export const DQF_LEAD_DAYS = 30

export interface DqfFacts {
  /**
   * NOT READ BY THE CHECKLIST since v11.34 — no row is dated from it. Kept
   * because the roster and warning loaders share this shape and carry it.
   */
  hireDate: Date | null
  /**
   * Live compliance records for this driver. THE SAME LIST item 9's
   * `DriverFacts.compliance` carries, deliberately identical in shape so
   * one loader fills both — two arrays of the same rows in one object is
   * two sources of truth with extra steps, in the item whose subject is
   * not having two.
   *
   * `expiresAt` is nullable to match. The column is NOT NULL, so in
   * practice this is never null; a record that somehow has no date is
   * treated as ON FILE and undated rather than as expired, which is the
   * posture `truckWarnings` already takes for the same case.
   */
  compliance: readonly { type: string; expiresAt: Date | null }[]
  /** Live document types filed against this driver. */
  documents: readonly string[]
}

/**
 * One driver's file, walked in the order §391.51 lists it.
 *
 * NOTHING HERE IS STORED. The checklist is a function of records that already
 * exist, which is item 9's posture and for item 9's reason: a stored "DQF
 * complete" flag is true until the day a medical card lapses and then silently
 * wrong, with no event to tell it.
 */
export function dqfChecklist(facts: DqfFacts, now: Date): DqfEntry[] {
  return DQF_REQUIREMENTS.map((requirement) =>
    dqfEntryFor(requirement, facts, now),
  )
}

/**
 * ONE ROW OF THE FILE, from its own evidence. The checklist is this, five
 * times; `dqfRowSatisfied` is this, read as yes or no.
 */
export function dqfEntryFor(
  requirement: DqfRequirement,
  facts: DqfFacts,
  now: Date,
): DqfEntry {
  const base = {
    key: requirement.key,
    cfr: requirement.cfr,
    cadence: requirement.cadence,
  }

  if (requirement.evidence.kind === 'document') {
    const onFile = facts.documents.includes(requirement.evidence.type)
    return onFile
      ? { ...base, status: 'present' as const, dueSince: null }
      : { ...base, status: 'missing' as const, dueSince: null }
  }

  // EITHER: the document on file reads present and undated; failing that,
  // the compliance record alone reads by its date below.
  if (
    requirement.evidence.kind === 'either' &&
    facts.documents.includes(requirement.evidence.document)
  ) {
    return { ...base, status: 'present' as const, dueSince: null }
  }

  // THE LATEST RECORD WINS, which is `compliance.ts`'s supersession rule
  // stated again rather than imported: a renewal filed beside last year's
  // MVR is the one that says whether the file is current.
  const type =
    requirement.evidence.kind === 'either'
      ? requirement.evidence.compliance
      : requirement.evidence.type
  const held = facts.compliance.filter((item) => item.type === type)
  if (held.length === 0) {
    return { ...base, status: 'missing' as const, dueSince: null }
  }

  const dated = held
    .filter(
      (item): item is { type: string; expiresAt: Date } =>
        item.expiresAt !== null,
    )
    .sort((a, b) => b.expiresAt.getTime() - a.expiresAt.getTime())[0]

  // ON FILE BUT UNDATED. The column is NOT NULL so this is unreachable
  // through the application; a row that got there another way is filed
  // rather than lapsed, and inventing an expiry for it would raise an
  // alarm about a date nobody wrote.
  if (!dated) return { ...base, status: 'present' as const, dueSince: null }

  const days = daysUntil(dated.expiresAt, now)
  if (days < 0) {
    return { ...base, status: 'expired' as const, dueSince: dated.expiresAt }
  }
  if (days <= DQF_LEAD_DAYS) {
    return { ...base, status: 'due' as const, dueSince: dated.expiresAt }
  }
  return { ...base, status: 'present' as const, dueSince: null }
}

/**
 * THE ONE PREDICATE PER ROW (§6.4 part 2 v11.30): is this row satisfied — on
 * file, and if dated, not lapsed? `due` satisfies it (the driver is qualified
 * today); `missing` and `expired` do not. What satisfies each row is its
 * `evidence`, read by `dqfEntryFor` and nowhere else.
 */
export function dqfRowSatisfied(
  requirement: DqfRequirement,
  facts: DqfFacts,
  now: Date,
): boolean {
  const { status } = dqfEntryFor(requirement, facts, now)
  return status === 'present' || status === 'due'
}

// ── every row its action (§6.4 part 2 v11.30) ────────────────────────────

/**
 * The act that satisfies a row, DERIVED FROM ITS EVIDENCE so the button and
 * the predicate cannot disagree: a document is uploaded, a dated record is
 * recorded. An `either` row is offered its
 * document — the record half is filed through the CDL reader or the
 * compliance panel, which already exist for it.
 */
export type DqfRowAction =
  | { kind: 'upload'; documentType: DocumentType }
  | { kind: 'record'; complianceType: ComplianceType }

export function dqfRowAction(requirement: DqfRequirement): DqfRowAction {
  const evidence = requirement.evidence
  switch (evidence.kind) {
    case 'document':
      return { kind: 'upload', documentType: evidence.type }
    case 'either':
      return { kind: 'upload', documentType: evidence.document }
    case 'compliance':
      return { kind: 'record', complianceType: evidence.type }
  }
}

/** How far ahead the Record form's expiry is prefilled for an annual row. */
export const DQF_RECORD_DEFAULT_DAYS = 365

/**
 * The facts once the action has done its work: what it FILES, stated as the
 * evidence the predicate reads. The agreement test applies this to every
 * unsatisfied row and asks the predicate again; the integration test does it
 * for real, through the writers.
 */
export function dqfFactsAfter(
  action: DqfRowAction,
  facts: DqfFacts,
  now: Date,
): DqfFacts {
  switch (action.kind) {
    case 'upload':
      return { ...facts, documents: [...facts.documents, action.documentType] }
    case 'record':
      return {
        ...facts,
        compliance: [
          ...facts.compliance,
          {
            type: action.complianceType,
            expiresAt: new Date(
              now.getTime() + DQF_RECORD_DEFAULT_DAYS * 86_400_000,
            ),
          },
        ],
      }
  }
}

/** A document on the driver, as the on-file link needs it. */
export interface DqfFiledDocument {
  id: string
  filename: string
  type: string
  uploadedAt: Date | null
}

/** A live compliance record, with the documents attached to it. */
export interface DqfFiledRecord {
  id: string
  type: string
  expiresAt: Date
  isSuperseded: boolean
  documents: readonly { id: string; filename: string }[]
}

/**
 * THE DOCUMENT AN ON-FILE ROW LINKS TO: the newest document of the row's kind
 * on the driver, else one attached to the newest live record of the row's
 * type. Null when the row is satisfied by a record with nothing
 * attached — that row offers Attach instead (`dqfOnFileRecord`).
 */
export function dqfOnFileDocument(
  requirement: DqfRequirement,
  documents: readonly DqfFiledDocument[],
  records: readonly DqfFiledRecord[],
): { id: string; filename: string } | null {
  const evidence = requirement.evidence
  const documentType =
    evidence.kind === 'document'
      ? evidence.type
      : evidence.kind === 'either'
        ? evidence.document
        : null
  if (documentType !== null) {
    const newest = documents
      .filter((document) => document.type === documentType)
      .sort(
        (a, b) =>
          (b.uploadedAt?.getTime() ?? 0) - (a.uploadedAt?.getTime() ?? 0),
      )[0]
    if (newest) return { id: newest.id, filename: newest.filename }
  }
  const record = dqfOnFileRecord(requirement, records)
  return record?.documents[0] ?? null
}

/** The newest live record that satisfies a dated row, or null. */
export function dqfOnFileRecord(
  requirement: DqfRequirement,
  records: readonly DqfFiledRecord[],
): DqfFiledRecord | null {
  const evidence = requirement.evidence
  const type =
    evidence.kind === 'compliance'
      ? evidence.type
      : evidence.kind === 'either'
        ? evidence.compliance
        : null
  if (type === null) return null
  return (
    records
      .filter((record) => record.type === type && !record.isSuperseded)
      .sort((a, b) => b.expiresAt.getTime() - a.expiresAt.getTime())[0] ?? null
  )
}

/**
 * How many entries are not on file and current.
 *
 * `due` DOES NOT COUNT. A medical card that expires in three weeks is on file
 * and the driver is qualified today; counting it as incomplete would put a
 * number on the roster screen that never reaches zero, and a number that never
 * reaches zero is a number nobody chases.
 */
export function dqfIncompleteCount(entries: readonly DqfEntry[]): number {
  return entries.filter(
    (entry) => entry.status === 'missing' || entry.status === 'expired',
  ).length
}

/**
 * Is this a driver whose file has to be CURRENT?
 *
 * §391.51(c) says the file is kept for three years after a driver leaves —
 * kept, not kept current. A terminated driver with no annual MVR is a correct
 * record of somebody who stopped driving here, not a finding.
 *
 * VACATION IS NOT TERMINATED. Somebody on holiday comes back on Monday and
 * their medical card has to be valid when they do.
 */
export function isQualifiable(driver: {
  status: string
  deletedAt: Date | null
  kind: string
}): boolean {
  // A REFERRAL PAYEE HAS NO QUALIFICATION FILE. `7 Star` is a commission, not
  // somebody who will ever produce a medical certificate or a road test, so a
  // DQF for it would be permanently incomplete and correctly so — and a
  // checklist that can never reach complete is the kind of permanent red that
  // teaches people to stop reading the reds that matter.
  //
  // HERE RATHER THAN IN THE ROSTER QUERY, because this is the one predicate
  // that decides whose file is expected. The roster view, the driver page and
  // the warning all ask it, and a payee excluded in only two of the three
  // would show a clean driver page with a warning beside it.
  if (isReferralPayee(driver)) return false
  return driver.deletedAt === null && driver.status !== 'INACTIVE'
}

/** One driver of the scope's roster, with the facts the checklist needs. */
export interface DqfRosterRow {
  id: string
  hireDate: Date | null
  status: string
  deletedAt: Date | null
  kind: string
  facts: DqfFacts
}

/**
 * THE SCOPE'S ROSTER WITH ITS FACTS, IN ONE STATEMENT (§6.1.1 v10.95; owner's
 * instruction 2026-11-13: one statement per card).
 *
 * `dqfSplit` read the roster, filtered it with `isQualifiable`, and then asked
 * `dqfFactsForDrivers` for the facts in two more statements. Here the facts
 * ride along as array subselects on the roster rows — the same three
 * subqueries `dqfFactsForDrivers` runs, per driver, in the one SELECT — and
 * the SCOPE IS STILL THE ONLY PREDICATE: `isQualifiable` stays the whole
 * rule, applied in TypeScript over the rows, for the reason written on
 * `dqfSplit` (a filter written twice, once in SQL and once in TypeScript, over
 * DOT data). The cost is the facts of the drivers the rule then discards —
 * three empty-ish subselects per terminated driver or payee.
 *
 * `tests/integration/dashboard.test.ts` holds `dqfSplit` through this equal
 * to the roster-plus-facts path it replaces, which stays exported.
 */
export async function dqfRoster(
  tx: TxClient,
  companyIds: readonly string[],
): Promise<DqfRosterRow[]> {
  return dqfRosterFrom(
    await tx.$queryRaw<DqfRosterSqlRow[]>(dqfRosterSql(companyIds)),
  )
}

/** One driver's row, from either transport (sql-json.ts). */
export interface DqfRosterSqlRow {
  id: string
  hire_date: Date | string | null
  status: string
  deleted_at: Date | string | null
  kind: string
  types: string[] | null
  expiries: (Date | string)[] | null
  documents: string[] | null
}

/** The roster's SQL — ONE TEXT, two readers (§6.1.1 v10.97). */
export function dqfRosterSql(companyIds: readonly string[]): Prisma.Sql {
  const ids = [...companyIds]
  return Prisma.sql`
    SELECT d."id",
           d."hireDate" AS hire_date,
           d."status"::text AS status,
           d."deletedAt" AS deleted_at,
           d."kind" AS kind,
           ARRAY(
             SELECT ci."type"::text FROM "ComplianceItem" ci
              WHERE ci."driverId" = d."id" AND ci."deletedAt" IS NULL
              ORDER BY ci."expiresAt" DESC
           ) AS types,
           ARRAY(
             SELECT ci."expiresAt" FROM "ComplianceItem" ci
              WHERE ci."driverId" = d."id" AND ci."deletedAt" IS NULL
              ORDER BY ci."expiresAt" DESC
           ) AS expiries,
           ARRAY(
             SELECT DISTINCT doc."type"::text FROM "Document" doc
              WHERE doc."driverId" = d."id" AND doc."deletedAt" IS NULL
           ) AS documents
      FROM "Driver" d
     WHERE ${ids.length > 0 ? Prisma.sql`d."companyId" = ANY(${ids})` : Prisma.sql`TRUE`}
  `
}

/** The roster rows as the ring reads them, from either transport. */
export function dqfRosterFrom(
  rows: readonly DqfRosterSqlRow[],
): DqfRosterRow[] {
  return rows.map((row) => {
    const types = row.types ?? []
    const expiries = row.expiries ?? []
    const hireDate = asDate(row.hire_date)
    return {
      id: row.id,
      hireDate,
      status: row.status,
      deletedAt: asDate(row.deleted_at),
      kind: row.kind,
      facts: {
        hireDate,
        // ORDERED IDENTICALLY — same subquery, same ORDER BY — so index i of
        // one belongs with index i of the other, as in `dqfFactsForDrivers`.
        compliance: types.map((type, index) => ({
          type,
          expiresAt: asDate(expiries[index])!,
        })),
        documents: row.documents ?? [],
      },
    }
  })
}

// ── the loaders, one query each ──────────────────────────────────────────

/**
 * DQF facts for many drivers, in TWO statements — one per evidence store.
 *
 * Two rather than one because the evidence genuinely lives in two tables and a
 * UNION of a dated row with an undated one would need a null column and a
 * discriminator to put it back together. Two is a constant; what must never
 * happen is a number that grows with the length of the list, and the
 * integration suite counts it against twenty drivers.
 */
/** One driver's compliance evidence, as `dqfDriversSql` returns it. */
export interface DqfDriverSqlRow {
  id: string
  hire_date: Date | string | null
  types: string[] | null
  expiries: (Date | string)[] | null
}

/** One driver's filed document types, as `dqfDocumentsSql` returns them. */
export interface DqfDocumentSqlRow {
  id: string
  types: string[] | null
}

/**
 * THE TWO TEXTS `dqfFactsForDrivers` SENDS, as builders, so `/drivers`' facts
 * statement reads the same SQL as a CTE each (§6.4 part 1 v11.02).
 */
export function dqfDriversSql(ids: readonly string[]): Prisma.Sql {
  return Prisma.sql`
      SELECT d."id",
             d."hireDate" AS hire_date,
             ARRAY(
               SELECT ci."type"::text FROM "ComplianceItem" ci
                WHERE ci."driverId" = d."id" AND ci."deletedAt" IS NULL
                ORDER BY ci."expiresAt" DESC
             ) AS types,
             ARRAY(
               SELECT ci."expiresAt" FROM "ComplianceItem" ci
                WHERE ci."driverId" = d."id" AND ci."deletedAt" IS NULL
                ORDER BY ci."expiresAt" DESC
             ) AS expiries
        FROM "Driver" d
       WHERE d."id" = ANY(${[...ids]})
    `
}

export function dqfDocumentsSql(ids: readonly string[]): Prisma.Sql {
  return Prisma.sql`
      SELECT doc."driverId" AS id,
             ARRAY_AGG(DISTINCT doc."type"::text) AS types
        FROM "Document" doc
       WHERE doc."driverId" = ANY(${[...ids]}) AND doc."deletedAt" IS NULL
       GROUP BY doc."driverId"
    `
}

/** The two texts' rows, from either transport, as the facts per driver. */
export function dqfFactsFrom(
  drivers: readonly DqfDriverSqlRow[],
  documents: readonly DqfDocumentSqlRow[],
): Map<string, DqfFacts> {
  const out = new Map<string, DqfFacts>()
  const filed = new Map<string, string[]>()
  for (const row of documents) filed.set(row.id, row.types ?? [])

  for (const row of drivers) {
    const types = row.types ?? []
    const expiries = row.expiries ?? []
    out.set(row.id, {
      hireDate: asDate(row.hire_date),
      // THE TWO ARRAYS ARE ORDERED IDENTICALLY — same subquery, same ORDER BY
      // — so index `i` of one belongs with index `i` of the other. Zipping
      // them here rather than returning a composite type keeps the row shape
      // something the driver can decode without a custom parser.
      compliance: types.map((type, index) => ({
        type,
        expiresAt: asDate(expiries[index])!,
      })),
      documents: filed.get(row.id) ?? [],
    })
  }

  return out
}

export async function dqfFactsForDrivers(
  tx: TxClient,
  driverIds: readonly string[],
): Promise<Map<string, DqfFacts>> {
  if (driverIds.length === 0) return new Map()

  const [drivers, documents] = await Promise.all([
    tx.$queryRaw<DqfDriverSqlRow[]>(dqfDriversSql(driverIds)),
    tx.$queryRaw<DqfDocumentSqlRow[]>(dqfDocumentsSql(driverIds)),
  ])
  return dqfFactsFrom(drivers, documents)
}
