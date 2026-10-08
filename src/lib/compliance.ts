import type {
  ComplianceType,
  DocumentType,
  Prisma,
} from '@/generated/prisma/client'
import {
  companyScopeFilter,
  type CompanyScopeFilter,
  type TxClient,
} from './tenancy'

// ---------------------------------------------------------------------------
// COMPLIANCE (Phase 4 §5 step 1).
//
// The owner runs a DOT-compliance business, so this is the part of Zebra he
// will judge hardest. What it has to get right is small and unforgiving: a
// truck whose annual inspection lapses is a truck that must not be dispatched,
// and the only thing standing between that and a roadside out-of-service order
// is whether a date appeared on somebody's screen in time.
//
// THE MODEL IS `ComplianceItem`, NOT A NEW TABLE. §3 step 1 asks for
// "migrations for ComplianceRecord"; the schema has carried exactly that shape
// since the init migration under the older name — nullable truck/trailer/driver
// subject, type, issuedAt/expiresAt, notes, documents, soft delete, and the two
// indexes this file's queries need. Flagged in PHASE-4-BRIEF.md §6 and built on
// rather than duplicated: a second model holding the same facts is the shape
// that produced the authority drift check in Phase 2.
//
// STATUS IS DERIVED AT READ TIME, NEVER STORED (§2.2). A stored status is a
// cache that goes stale at midnight — literally, on the night an item expires —
// and this is the one table where being a day out is the whole problem. There
// is no drift check here because there is nothing to drift: the date is the
// fact and the status is a function of it.
//
// SUPERSESSION IS DERIVED TOO. §2.1 wants a renewal to supersede rather than
// overwrite. For one subject and one type, the record with the latest
// `expiresAt` is current and the others are history. No `supersededById`
// column, for the same reason there is no stored status — see §6 flag 4.
// ---------------------------------------------------------------------------

/** Current, expiring within the lead time, or expired. Never stored. */
export type ComplianceStatus = 'current' | 'expiring' | 'expired'

/** The three things a compliance record can hang off. */
export type ComplianceSubject = 'company' | 'truck' | 'trailer' | 'driver'

export const COMPLIANCE_SUBJECTS: readonly ComplianceSubject[] = [
  'company',
  'truck',
  'trailer',
  'driver',
]

/**
 * Obligations that belong to the CARRIER, not to a vehicle.
 *
 * ── ONE POLICY, NOT ONE ROW PER TRUCK ─────────────────────────────────────
 *
 * Liability and cargo are written per authority and cover the fleet. The
 * Datatruck import stored them per truck because that is where the export put
 * the date, and production showed what that costs: 17 Dolphins trucks and 5
 * RAM trucks all carrying a liability expiry of 2025-10-21 — two fleet
 * policies stored twenty-two times. Renewing one meant editing twenty-two
 * rows, and a queue listing twenty-two identical alarms is a queue nobody
 * reads.
 *
 * PHYSICAL DAMAGE IS NOT HERE, deliberately. It insures a particular vehicle
 * for a particular value; it is per-truck by nature, and folding it in would
 * be tidiness overriding what the thing actually is.
 *
 * A FLEET POLICY IS A ComplianceItem WITH NO ASSET LINK. The schema already
 * allowed that — `companyId` is NOT NULL and every asset column is optional —
 * so no column was needed. What was needed is for such a row to MEAN
 * something: `shapeRecords` used to drop anything attached to nothing.
 */
export const FLEET_COMPLIANCE_TYPES: readonly ComplianceType[] = [
  'INSURANCE_LIABILITY',
  'INSURANCE_CARGO',
]

/**
 * The types this phase builds screens for (§1).
 *
 * `ComplianceType` carries more — `DRUG_TEST`, `MVR`, `IFTA_LICENSE`, `PERMIT`
 * and the rest — and they stay in the enum untouched. The owner named six, and
 * a filter offering fourteen where six are ever used is a filter nobody reads.
 * Records of another type are NOT hidden from the queue; they simply have no
 * chip of their own.
 */
export const TRACKED_TYPES: readonly ComplianceType[] = [
  'ANNUAL_INSPECTION',
  'DOT_INSPECTION',
  'REGISTRATION',
  'INSURANCE_LIABILITY',
  'INSURANCE_CARGO',
  'CDL',
  'MEDICAL_CARD',
]

/** Whole days from `from` to `to`. Negative once `to` is in the past. */
export function daysUntil(to: Date, from: Date): number {
  // Both floored to UTC midnight first. Without that, an item expiring later
  // today reads as 0 days at 9am and -0.4 days at 6pm, and "expires today"
  // would flip to "expired" over lunch.
  const day = 24 * 60 * 60 * 1000
  const a = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate())
  const b = Date.UTC(
    from.getUTCFullYear(),
    from.getUTCMonth(),
    from.getUTCDate(),
  )
  return Math.round((a - b) / day)
}

/**
 * The one derivation. The queue, the dashboard row and the asset panels all
 * call this, so the three cannot disagree — which is exactly what §4's first
 * acceptance box asks for.
 *
 * EXPIRES TODAY IS EXPIRING, NOT EXPIRED. A registration valid through the 31st
 * is valid ON the 31st; calling it expired that morning would ground a truck a
 * day early, and a compliance screen that cries wolf gets ignored.
 */
export function statusFor(
  expiresAt: Date,
  leadDays: number,
  now: Date = new Date(),
): ComplianceStatus {
  const days = daysUntil(expiresAt, now)
  if (days < 0) return 'expired'
  if (days <= leadDays) return 'expiring'
  return 'current'
}

export interface ComplianceRow {
  id: string
  companyId: string
  companyName: string
  type: ComplianceType
  subject: ComplianceSubject
  subjectId: string
  /** Unit number or driver name — what a person calls the thing. */
  subjectLabel: string
  identifier: string | null
  issuer: string | null
  issuedAt: Date | null
  expiresAt: Date
  daysLeft: number
  status: ComplianceStatus
  /** A newer record of the same type covers this subject. History, not alarm. */
  isSuperseded: boolean
  notes: string | null
  documentCount: number
}

const SELECT = {
  id: true,
  companyId: true,
  type: true,
  identifier: true,
  issuer: true,
  issuedAt: true,
  expiresAt: true,
  notes: true,
  company: { select: { name: true } },
  truck: { select: { id: true, unitNumber: true } },
  trailer: { select: { id: true, unitNumber: true } },
  driver: { select: { id: true, firstName: true, lastName: true } },
  _count: { select: { documents: true } },
} satisfies Prisma.ComplianceItemSelect

/**
 * Turn stored rows into read rows: derive the status, the days left, and which
 * ones a newer record has taken over from.
 *
 * Exported so the same shaping runs over a whole fleet's queue and over one
 * asset's panel, from one function.
 */
export function shapeRecords(
  rows: readonly {
    id: string
    companyId: string
    type: ComplianceType
    identifier: string | null
    issuer: string | null
    issuedAt: Date | null
    expiresAt: Date
    notes: string | null
    company: { name: string }
    truck: { id: string; unitNumber: string } | null
    trailer: { id: string; unitNumber: string } | null
    driver: { id: string; firstName: string; lastName: string } | null
    _count: { documents: number }
  }[],
  leadDays: number,
  now: Date = new Date(),
  /**
   * Latest expiry per `subjectId:type`, where the caller knows more than the
   * rows it is passing.
   *
   * THE QUEUE MUST PASS THIS. Its rows are limited to the expiry horizon, so
   * the renewal that supersedes a lapsed record — a year out, by definition —
   * is not among them. Computing supersession from the rows alone left every
   * renewed-but-lapsed registration sitting in the queue as a red row for a
   * truck that was entirely legal. Caught by the integration test, which is
   * the only place the two queries meet.
   *
   * `recordsForSubject` passes nothing, and correctly: its rows ARE the whole
   * history for that asset.
   */
  latestByKey?: ReadonlyMap<string, number>,
): ComplianceRow[] {
  const keyOf = (row: (typeof rows)[number]) => {
    // A FLEET POLICY IS KEYED BY ITS COMPANY. Without this every unattached
    // liability row shared the key `:INSURANCE_LIABILITY`, so one carrier's
    // renewal would mark another carrier's live policy as superseded.
    const subjectId =
      row.truck?.id ??
      row.trailer?.id ??
      row.driver?.id ??
      (FLEET_COMPLIANCE_TYPES.includes(row.type) ? row.companyId : '')
    return `${subjectId}:${row.type}`
  }

  // For each (subject, type) the latest `expiresAt` is the live one; every
  // older record of that pair is history. Ties keep both — two records with the
  // same expiry is a data problem, and silently picking one would hide it.
  const latest = new Map<string, number>(latestByKey ?? [])
  if (!latestByKey) {
    for (const row of rows) {
      const key = keyOf(row)
      const at = row.expiresAt.getTime()
      if (!latest.has(key) || at > latest.get(key)!) latest.set(key, at)
    }
  }

  return rows.flatMap((row) => {
    const subject: ComplianceSubject | null = row.truck
      ? 'truck'
      : row.trailer
        ? 'trailer'
        : row.driver
          ? 'driver'
          : // ── ATTACHED TO NOTHING MEANS ONE OF TWO THINGS ────────────────
            //
            // A fleet policy — liability or cargo, written per authority and
            // covering every vehicle — or a row somebody failed to attach.
            // The TYPE tells them apart, which is why this is not simply
            // "unattached = company": an unattached CDL is malformed and is
            // still dropped, exactly as before.
            FLEET_COMPLIANCE_TYPES.includes(row.type)
            ? 'company'
            : null

    // A record attached to nothing and not a fleet obligation cannot be shown
    // against an asset, because there is no asset. Dropped rather than
    // displayed as "—".
    if (!subject) return []

    const subjectId =
      subject === 'company'
        ? row.companyId
        : (row.truck ?? row.trailer ?? row.driver)!.id
    const subjectLabel =
      subject === 'company'
        ? row.company.name
        : row.driver
          ? `${row.driver.firstName} ${row.driver.lastName}`
          : (row.truck ?? row.trailer)!.unitNumber

    return [
      {
        id: row.id,
        companyId: row.companyId,
        companyName: row.company.name,
        type: row.type,
        subject,
        subjectId,
        subjectLabel,
        identifier: row.identifier,
        issuer: row.issuer,
        issuedAt: row.issuedAt,
        expiresAt: row.expiresAt,
        daysLeft: daysUntil(row.expiresAt, now),
        status: statusFor(row.expiresAt, leadDays, now),
        isSuperseded: row.expiresAt.getTime() < (latest.get(keyOf(row)) ?? 0),
        notes: row.notes,
        documentCount: row._count.documents,
      },
    ]
  })
}

export interface ComplianceQuery {
  subject?: ComplianceSubject
  type?: ComplianceType
  /** Include records a newer one has replaced. Off by default. */
  includeSuperseded?: boolean
  /**
   * A FIXED horizon in days, in place of the authority's own warning days.
   *
   * For a question like "expiring within 90 days" (§6.1.1's panel). Nothing
   * else changes: the same actionable subjects, the same superseded rule, the
   * same `statusFor` — so the answer is what the Needs-you row would list if
   * its warning days were this number, and not a second reader.
   */
  horizonDays?: number
}

/**
 * The lead time, per authority, from the settings that have existed since
 * Phase 1 with nothing reading them (§2.3).
 *
 * One number for the whole read rather than one per row: the queue spans
 * authorities and the horizon is a business policy, so the SHORTEST lead time
 * in scope wins. A carrier that wants thirty days' warning and one that wants
 * sixty should both be warned at sixty — warning early is free, warning late
 * is a truck at a scale house.
 */
export async function leadDaysFor(
  tx: TxClient,
  scope: CompanyScopeFilter = {},
): Promise<number> {
  const settings = await tx.companySettings.findMany({
    where: scope,
    select: { complianceWarnDays: true },
  })
  if (settings.length === 0) return 30
  return Math.max(...settings.map((row) => row.complianceWarnDays))
}

/**
 * Everything expiring or already expired, worst first.
 *
 * Current records are excluded — this is a QUEUE, and a queue that lists the
 * things needing nothing is a list nobody works from. The asset panels (step 2)
 * show the full history.
 */
export async function complianceQueue(
  tx: TxClient,
  scope: CompanyScopeFilter = {},
  query: ComplianceQuery = {},
  now: Date = new Date(),
): Promise<{ rows: ComplianceRow[]; leadDays: number }> {
  // THE HORIZON IS THE CALLER'S WHEN IT SAYS SO, and the authorities' own
  // otherwise. One variable from here down, so a fixed horizon cannot read the
  // table at 90 days and then call a 45-day card "current" at 30.
  const leadDays = query.horizonDays ?? (await leadDaysFor(tx, scope))

  // The horizon in SQL, so the queue does not read the whole table to throw
  // most of it away. The boundary is generous by a day at each end and the
  // exact call is made by `statusFor` afterwards — one derivation, per §4.
  const horizon = new Date(now.getTime())
  horizon.setUTCDate(horizon.getUTCDate() + leadDays + 1)

  const rows = await tx.complianceItem.findMany({
    where: {
      ...scope,
      deletedAt: null,
      expiresAt: { lte: horizon },
      ...ACTIONABLE_SUBJECT,
      ...(query.type ? { type: query.type } : {}),
      ...subjectWhere(query.subject),
    },
    orderBy: { expiresAt: 'asc' },
    take: 500,
    select: SELECT,
  })

  // THE LATEST EXPIRY PER SUBJECT AND TYPE, over EVERY record — not just the
  // ones inside the horizon. A renewal is by definition outside it, so without
  // this a lapsed-but-renewed registration stays in the queue forever.
  //
  // Scoped to the subjects actually on screen, so it stays one cheap grouped
  // query rather than a read of the whole table.
  const subjectIds = [...new Set(rows.map((row) => subjectIdOf(row)))].filter(
    Boolean,
  )
  const latestByKey = new Map<string, number>()
  if (subjectIds.length > 0) {
    const all = await tx.complianceItem.findMany({
      where: {
        ...scope,
        deletedAt: null,
        OR: [
          { truckId: { in: subjectIds } },
          { trailerId: { in: subjectIds } },
          { driverId: { in: subjectIds } },
        ],
      },
      select: {
        type: true,
        expiresAt: true,
        truckId: true,
        trailerId: true,
        driverId: true,
      },
    })
    for (const row of all) {
      const subjectId = row.truckId ?? row.trailerId ?? row.driverId ?? ''
      const key = `${subjectId}:${row.type}`
      const at = row.expiresAt.getTime()
      if (!latestByKey.has(key) || at > latestByKey.get(key)!) {
        latestByKey.set(key, at)
      }
    }
  }

  const shaped = shapeRecords(rows, leadDays, now, latestByKey).filter(
    (row) => row.status !== 'current',
  )

  return {
    rows: query.includeSuperseded
      ? shaped
      : // A lapsed registration that has already been renewed is history, not
        // work. Showing it would put a red row on the screen for a truck that
        // is entirely legal, and the queue would train people to ignore red.
        shaped.filter((row) => !row.isSuperseded),
    leadDays,
  }
}

/** Whichever of the three subject columns is set. */
function subjectIdOf(row: {
  truck: { id: string } | null
  trailer: { id: string } | null
  driver: { id: string } | null
}): string {
  return row.truck?.id ?? row.trailer?.id ?? row.driver?.id ?? ''
}

/** `{ truckId: { not: null } }` and friends — the subject filter. */
/**
 * The queue is only what somebody can act on.
 *
 * ── A SOLD TRUCK'S EXPIRED REGISTRATION IS HISTORY, NOT A TASK ────────────
 *
 * The all-trucks import writes compliance rows from the registration, annual
 * inspection and insurance dates on EVERY truck, live or not — the owner's
 * ruling, because a lapsed registration on a truck that left the fleet is
 * worth having. 67 of 87 registrations and all 25 insurance dates in that
 * import are already expired.
 *
 * Every one of those would otherwise land in this queue, which exists to tell
 * a safety manager what to renew. Nobody can renew the registration on a truck
 * the company no longer owns, and a queue whose rows cannot be acted on stops
 * being read — which costs the rows that CAN be acted on their only audience.
 *
 * THE ROWS ARE NOT HIDDEN, ONLY THE QUEUE IS NARROWED. A compliance item still
 * renders on its own truck's or driver's page, where it is what it is: the
 * record of a vehicle this carrier ran. `complianceQueue` is the work list;
 * the asset page is the history.
 *
 * IT LIVES HERE RATHER THAN ON THE SCREEN because the Safety page derives its
 * chip counts from this same function — a filter applied in the page would
 * make every count disagree with the list beneath it.
 *
 * MAINTENANCE IS NOT EXCLUDED, matching `ASSIGNABLE_TRUCK`: a truck in the shop
 * is coming back and its registration still has to be current.
 */
const ACTIONABLE_SUBJECT: Prisma.ComplianceItemWhereInput = {
  OR: [
    { truck: { status: { notIn: ['OUT_OF_SERVICE', 'SOLD'] } } },
    { driver: { status: { not: 'INACTIVE' } } },
    // A trailer has no such status, and an item attached to none of the three
    // is an organization-level document — neither is excluded by this.
    { trailerId: { not: null } },
    { truckId: null, driverId: null, trailerId: null },
  ],
}

function subjectWhere(
  subject: ComplianceSubject | undefined,
): Prisma.ComplianceItemWhereInput {
  if (subject === 'truck') return { truckId: { not: null } }
  if (subject === 'trailer') return { trailerId: { not: null } }
  if (subject === 'driver') return { driverId: { not: null } }
  if (subject === 'company') {
    return {
      truckId: null,
      trailerId: null,
      driverId: null,
      type: { in: [...FLEET_COMPLIANCE_TYPES] },
    }
  }
  return {}
}

/** How many need attention, for the dashboard row. Same predicate, counted. */
export async function complianceCount(
  tx: TxClient,
  scope: CompanyScopeFilter = {},
  now: Date = new Date(),
): Promise<{ count: number; expired: number }> {
  const { rows } = await complianceQueue(tx, scope, {}, now)
  return {
    count: rows.length,
    expired: rows.filter((row) => row.status === 'expired').length,
  }
}

/** The dashboard panel's three figures. Cumulative; expired in all three. */
export interface ComplianceHorizons {
  d30: number
  d60: number
  d90: number
}

/** The panel's one read: the queue at its longest horizon, bucketed after. */
export const PANEL_HORIZON_DAYS = [30, 60, 90] as const

/**
 * Expiring within 30 / 60 / 90 days, for the dashboard's compliance panel.
 *
 * ── ONE READER, TWO HORIZONS (§6.1.1, queue item 20 (8)) ─────────────────
 *
 * These were three COUNT(*) subqueries over every live ComplianceItem inside
 * each horizon, beside a Needs-you row that is `complianceQueue`. On
 * production the row said 54 and the panel said 96, and the 42 were sold
 * trucks' lapsed registrations and renewed-then-superseded records — rows the
 * queue drops because nobody can act on them, and the SQL counted because it
 * knew nothing of subjects. The office read the two as one number disagreeing
 * with itself, which it was.
 *
 * So this is the queue, read ONCE at the longest horizon, and the three
 * figures are counts over its rows by days left. Every rule the row applies —
 * actionable subjects, superseded dropped, expired included, `statusFor` —
 * applies here by construction, because it is the same function. The one
 * difference left is the horizon: a card at 45 days is in the 60 figure and
 * not in a 30-day row, and the panel's note says so.
 *
 * CUMULATIVE, NOT BANDED. "Within 60 days" includes the ones within 30 — that
 * is what the phrase means, and three disjoint bands would make the 90-day
 * figure read as a comfortable quarter away when it is the one somebody
 * glances at. ALREADY EXPIRED COUNTS IN ALL THREE, because an expired medical
 * card is not less urgent than one expiring on Friday; `daysLeft` is negative
 * for those and so under every bound.
 */
export async function complianceHorizons(
  tx: TxClient,
  companyIds: readonly string[],
  now: Date = new Date(),
): Promise<ComplianceHorizons> {
  const { rows } = await complianceQueue(
    tx,
    companyScopeFilter(companyIds),
    { horizonDays: PANEL_HORIZON_DAYS[2] },
    now,
  )
  const within = (days: number) =>
    rows.filter((row) => row.daysLeft <= days).length
  return {
    d30: within(PANEL_HORIZON_DAYS[0]),
    d60: within(PANEL_HORIZON_DAYS[1]),
    d90: within(PANEL_HORIZON_DAYS[2]),
  }
}

/**
 * Every record for one asset, newest expiry first, history included.
 *
 * The panel counterpart to the queue (step 2 renders it). Superseded records
 * are kept and marked, because §2.1's whole point is that the old registration
 * stays visible.
 */
export async function recordsForSubject(
  tx: TxClient,
  subject: ComplianceSubject,
  subjectId: string,
  now: Date = new Date(),
): Promise<ComplianceRow[]> {
  // ── A VEHICLE INHERITS ITS CARRIER'S FLEET POLICIES ───────────────────
  //
  // Liability and cargo are not stored on the truck any more, and a truck's
  // page must still answer "is this vehicle insured". So the panel shows the
  // truck's own records PLUS the policies its authority carries — which is
  // what "inherit" means here: one row, read from several places, rather than
  // one copy per vehicle.
  const carrier =
    subject === 'truck' || subject === 'trailer'
      ? await (subject === 'truck'
          ? tx.truck.findUnique({
              where: { id: subjectId },
              select: { companyId: true },
            })
          : tx.trailer.findUnique({
              where: { id: subjectId },
              select: { companyId: true },
            }))
      : null

  const rows = await tx.complianceItem.findMany({
    where: {
      deletedAt: null,
      ...(subject === 'company'
        ? {
            companyId: subjectId,
            truckId: null,
            trailerId: null,
            driverId: null,
            type: { in: [...FLEET_COMPLIANCE_TYPES] },
          }
        : {}),
      ...(subject === 'driver' ? { driverId: subjectId } : {}),
      ...(subject === 'truck' || subject === 'trailer'
        ? {
            OR: [
              subject === 'truck'
                ? { truckId: subjectId }
                : { trailerId: subjectId },
              ...(carrier
                ? [
                    {
                      companyId: carrier.companyId,
                      truckId: null,
                      trailerId: null,
                      driverId: null,
                      type: { in: [...FLEET_COMPLIANCE_TYPES] },
                    },
                  ]
                : []),
            ],
          }
        : {}),
    },
    orderBy: { expiresAt: 'desc' },
    select: SELECT,
  })

  const leadDays = await leadDaysFor(
    tx,
    rows[0] ? { companyId: { in: [rows[0].companyId] } } : {},
  )
  return shapeRecords(rows, leadDays, now)
}

// --- renewing (step 2) --------------------------------------------------------

/**
 * The document type each compliance type files under.
 *
 * `DocumentType` is a separate vocabulary from `ComplianceType` and always has
 * been — one describes the FILE, the other the OBLIGATION. Mapping them here
 * means the upload control on a registration row offers "Registration" rather
 * than making somebody choose from eighteen.
 */
export const DOCUMENT_TYPE_FOR: Record<string, DocumentType> = {
  ANNUAL_INSPECTION: 'INSPECTION_REPORT',
  DOT_INSPECTION: 'INSPECTION_REPORT',
  REGISTRATION: 'REGISTRATION',
  INSURANCE_LIABILITY: 'INSURANCE_CERT',
  INSURANCE_CARGO: 'INSURANCE_CERT',
  INSURANCE_PHYSICAL_DAMAGE: 'INSURANCE_CERT',
  CDL: 'CDL_COPY',
  MEDICAL_CARD: 'MEDICAL_CARD',
}

export function documentTypeFor(type: ComplianceType): DocumentType {
  return DOCUMENT_TYPE_FOR[type] ?? 'OTHER'
}

export type RenewalFailure =
  | 'subject_not_found'
  | 'bad_dates'
  | 'no_expiry'
  | 'duplicate'

export type RenewalResult =
  | { ok: true; recordId: string }
  | { ok: false; reason: RenewalFailure }

export interface RenewalInput {
  subject: ComplianceSubject
  subjectId: string
  type: ComplianceType
  issuedAt?: Date | null
  expiresAt: Date
  identifier?: string | null
  issuer?: string | null
  notes?: string | null
}

/**
 * Record a renewal. ALWAYS A CREATE, NEVER AN UPDATE (§2.1).
 *
 * There is no `updateComplianceRecord` in this module and there should not be
 * one. The old registration is the evidence that the truck was legal last
 * March; editing it in place destroys that, and a carrier asked to prove a
 * date to an auditor has nothing left to show. A renewal is a new row and the
 * old one becomes history — which `shapeRecords` marks and the panel renders.
 */
export async function recordRenewal(
  tx: TxClient,
  input: RenewalInput,
): Promise<RenewalResult> {
  if (Number.isNaN(input.expiresAt.getTime())) {
    return { ok: false, reason: 'no_expiry' }
  }
  if (
    input.issuedAt &&
    !Number.isNaN(input.issuedAt.getTime()) &&
    input.issuedAt.getTime() > input.expiresAt.getTime()
  ) {
    return { ok: false, reason: 'bad_dates' }
  }

  // The subject decides the tenant and the authority — read from the asset
  // rather than taken from the caller, so a forged id lands on nothing.
  const subject =
    input.subject === 'company'
      ? // ── A FLEET POLICY'S SUBJECT IS THE CARRIER ITSELF ────────────────
        //
        // Liability and cargo are written per authority, so the row carries a
        // companyId and no asset link. The company is still READ rather than
        // taken from the caller — the same reason every other branch does: an
        // id from a browser is a claim, and row-level security is what turns
        // one from another tenant into a `subject_not_found`.
        await tx.company
          .findFirst({
            where: { id: input.subjectId },
            select: { id: true, organizationId: true },
          })
          .then((row) =>
            row
              ? {
                  id: row.id,
                  organizationId: row.organizationId,
                  companyId: row.id,
                }
              : null,
          )
      : input.subject === 'truck'
        ? await tx.truck.findFirst({
            where: { id: input.subjectId, deletedAt: null },
            select: { id: true, organizationId: true, companyId: true },
          })
        : input.subject === 'trailer'
          ? await tx.trailer.findFirst({
              where: { id: input.subjectId, deletedAt: null },
              select: { id: true, organizationId: true, companyId: true },
            })
          : await tx.driver.findFirst({
              where: { id: input.subjectId, deletedAt: null },
              select: { id: true, organizationId: true, companyId: true },
            })

  if (!subject) return { ok: false, reason: 'subject_not_found' }

  // A SECOND RECORD WITH THE SAME EXPIRY is refused. Two live registrations
  // for one truck is a data problem `shapeRecords` deliberately shows rather
  // than resolves — better to refuse the double-submit that causes it than to
  // render the confusion afterwards.
  const clash = await tx.complianceItem.findFirst({
    where: {
      deletedAt: null,
      type: input.type,
      expiresAt: input.expiresAt,
      // A FLEET POLICY IS IDENTIFIED BY ITS CARRIER AND THE ABSENCE OF AN
      // ASSET. Without the three nulls this would also match a per-truck row
      // of the same type and date, and refuse a legitimate policy as a
      // duplicate of a vehicle's own record.
      ...(input.subject === 'company'
        ? {
            companyId: subject.id,
            truckId: null,
            trailerId: null,
            driverId: null,
          }
        : {}),
      ...(input.subject === 'truck' ? { truckId: subject.id } : {}),
      ...(input.subject === 'trailer' ? { trailerId: subject.id } : {}),
      ...(input.subject === 'driver' ? { driverId: subject.id } : {}),
    },
    select: { id: true },
  })
  if (clash) return { ok: false, reason: 'duplicate' }

  const created = await tx.complianceItem.create({
    data: {
      organizationId: subject.organizationId,
      companyId: subject.companyId,
      type: input.type,
      ...(input.subject === 'truck' ? { truckId: subject.id } : {}),
      ...(input.subject === 'trailer' ? { trailerId: subject.id } : {}),
      ...(input.subject === 'driver' ? { driverId: subject.id } : {}),
      issuedAt: input.issuedAt ?? null,
      expiresAt: input.expiresAt,
      identifier: input.identifier?.trim() || null,
      issuer: input.issuer?.trim() || null,
      notes: input.notes?.trim() || null,
    },
    select: { id: true },
  })

  return { ok: true, recordId: created.id }
}

/** The documents filed against one compliance record, for its panel row. */
export async function documentsForRecords(
  tx: TxClient,
  recordIds: readonly string[],
): Promise<Map<string, { id: string; filename: string }[]>> {
  if (recordIds.length === 0) return new Map()

  const documents = await tx.document.findMany({
    where: { complianceItemId: { in: [...recordIds] }, deletedAt: null },
    orderBy: { uploadedAt: 'desc' },
    select: { id: true, filename: true, complianceItemId: true },
  })

  const byRecord = new Map<string, { id: string; filename: string }[]>()
  for (const document of documents) {
    const key = document.complianceItemId
    if (!key) continue
    const list = byRecord.get(key) ?? []
    list.push({ id: document.id, filename: document.filename })
    byRecord.set(key, list)
  }
  return byRecord
}

// --- the dispatch warning (§2.4) ---------------------------------------------

export interface DispatchWarning {
  subject: ComplianceSubject
  /** The unit number or the driver's name — what a dispatcher recognises. */
  subjectLabel: string
  type: ComplianceType
  status: 'expiring' | 'expired'
  /** Negative once past. Same number the queue and the panels print. */
  daysLeft: number
  expiresAt: Date
}

/**
 * What is wrong with the paperwork on a truck and driver about to be dispatched.
 *
 * §2.4: "An expired truck/driver warns at dispatch, doesn't block. The
 * assignment flow surfaces the expiry in words next to the confirm; the
 * dispatcher proceeds if the business says so. Refusing outright turns a
 * paperwork lag into a stranded load; the audit row records that the warning
 * was shown."
 *
 * So this RETURNS rather than throws, and the caller decides. Only records that
 * are current-and-live are ignored: an expiring one is worth saying out loud
 * because the load may still be under way when it lapses, and a superseded one
 * is history and says nothing about today.
 *
 * The same derivation as the queue and the panels — `shapeRecords` — so a truck
 * flagged here is a truck flagged on /safety, and the three cannot disagree.
 */
export async function dispatchWarnings(
  tx: TxClient,
  pair: { truckId?: string | null; driverId?: string | null },
  now: Date = new Date(),
): Promise<DispatchWarning[]> {
  const warnings: DispatchWarning[] = []

  const look = async (subject: ComplianceSubject, id: string) => {
    const rows = await recordsForSubject(tx, subject, id, now)
    for (const row of rows) {
      if (row.isSuperseded || row.status === 'current') continue
      warnings.push({
        subject,
        subjectLabel: row.subjectLabel,
        type: row.type,
        status: row.status,
        daysLeft: row.daysLeft,
        expiresAt: row.expiresAt,
      })
    }
  }

  if (pair.truckId) await look('truck', pair.truckId)
  if (pair.driverId) await look('driver', pair.driverId)

  // Worst first: expired before expiring, and within each the one that has
  // been wrong longest. A dispatcher reads the first line and acts on it.
  return warnings.sort((a, b) => a.daysLeft - b.daysLeft)
}

/** One line per warning, for the audit row. Never shown to a user. */
export function describeWarnings(warnings: readonly DispatchWarning[]): string {
  return warnings
    .map(
      (warning) =>
        `${warning.subject} ${warning.subjectLabel} ${warning.type} ${
          warning.status
        } ${warning.expiresAt.toISOString().slice(0, 10)}`,
    )
    .join('; ')
}
