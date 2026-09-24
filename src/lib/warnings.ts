import { Prisma } from '@/generated/prisma/client'
import { remittanceOutcome } from './settlement-week'
import {
  isQualifiable,
  dqfChecklist,
  dqfFactsForDrivers,
  DQF_COMPLIANCE_TYPES,
  type DqfFacts,
} from './dqf'

// ---------------------------------------------------------------------------
// WARNINGS ARE COMPUTED. THERE IS NO WARNING COLUMN AND THERE WILL NOT BE ONE.
//
// Item 9. Datatruck's exports carry a `Warnings` column on drivers, trucks and
// loads — a stored, precomputed verdict. Zebra derives the same thing from the
// facts it already has, every time it is asked.
//
// ── WHY STORED WARNINGS ARE THE WRONG SHAPE ──────────────────────────────
//
// A stored warning is a copy of a fact, and copies go stale. A medical card
// that expired last night does not send an event; a load whose driver was
// unassigned at 4pm does not know it became urgent. The system would need a
// sweeper, the sweeper would need a schedule, and the schedule would be the
// thing that was actually wrong when somebody asked why the list was stale.
//
// Derived, the worst case is that the answer is right and slow. Stored, the
// worst case is that it is fast and wrong, which is the failure nobody
// notices — `by-company.ts` refuses to store a billing outcome for the same
// reason, and `billingStatusFor` has a whole note about the one column that
// IS cached and what that costs.
//
// ── ONE QUERY PER LIST, NOT ONE PER ROW ──────────────────────────────────
//
// The loaders take an array of ids and return a Map. A list of 200 drivers
// costs ONE round trip, not 200. `warnings.test.ts` counts the statements and
// fails if the count moves with the size of the list — a fan-out is the way
// this feature quietly becomes the slowest page in the system.
//
// ── AND CLOSED HISTORY IS SILENT ─────────────────────────────────────────
//
// Freight Datatruck already closed cannot be acted on. Warning about a load
// from before the cutover asks somebody to fix something that is not broken
// and is not theirs, on 14,464 rows.
// ---------------------------------------------------------------------------

export type WarningName =
  | 'compliance_expired'
  | 'compliance_expiring'
  | 'document_missing'
  | 'pickup_soon_unassigned'
  | 'settlement_line_held'
  | 'settlement_net_negative'
  | 'cancelled_but_assigned'
  | 'dqf_incomplete'

export interface Warning {
  name: WarningName
  /** The specific fact: which document, which date. Never a sentence. */
  detail: string
}

/** Expiring, not yet expired — the window a person can still act in. */
export const EXPIRING_WITHIN_DAYS = 30

/** Urgency window for an unassigned load. */
export const PICKUP_SOON_HOURS = 24

/**
 * WHAT A DRIVER MUST HAVE ON FILE, and what a truck must.
 *
 * NEW POLICY, NOT A DERIVED FACT, and said so. Nothing in the schema declares
 * a compliance type "required" — `ComplianceType` is a list of fourteen kinds
 * with no obligation attached. These two lists are a judgement about which
 * absences are worth interrupting somebody over, and they are the one part of
 * this file that is an opinion rather than a reading.
 */
/**
 * THE ONE DEFINITION, IMPORTED (item 13).
 *
 * This was `['CDL', 'MEDICAL_CARD']`, written by hand, and it was the
 * second definition of "what a driver must have on file" — the first being
 * whatever anybody remembered about 49 CFR 391.51. Adding a requirement
 * meant remembering to add it twice, and the copy that would not get
 * updated is the one nobody is looking at when the auditor arrives.
 *
 * `dqf.ts` is now the only place a requirement is stated. The guard is
 * named "two definitions of required" and it fails if this file grows a
 * literal list again.
 *
 * CDL STAYS, AND IT IS NOT A DQF ITEM. The licence's own expiry is watched
 * by Phase 4; the DQF item is a COPY of it on file, which is a document.
 * Two different facts about one licence, both required, neither standing
 * in for the other.
 */
export const REQUIRED_DRIVER_DOCUMENTS = [
  'CDL',
  ...DQF_COMPLIANCE_TYPES,
] as const
export const REQUIRED_TRUCK_DOCUMENTS = [
  'REGISTRATION',
  'ANNUAL_INSPECTION',
  'INSURANCE_LIABILITY',
] as const

export interface ComplianceFact {
  type: string
  expiresAt: Date | null
}

export interface DriverFacts {
  compliance: readonly ComplianceFact[]
  /** How many of this driver's settlements ended below zero. */
  negativeNetCount: number
  /** When they started. What an at-hire requirement is overdue FROM. */
  hireDate: Date | null
  /** Document types filed against this driver — the undated DQF items. */
  documents: readonly string[]
  /**
   * Whether this driver's file has to be CURRENT. A terminated driver's
   * file is KEPT for three years (§391.51(c)), not kept up to date.
   */
  qualifiable: boolean
}

/**
 * These facts, as the DQF checklist reads them.
 *
 * A PROJECTION, NOT A COPY. `compliance` is the same array item 9 walks —
 * the whole point of item 13 is that one set of rows answers both
 * questions, so this hands the list over rather than fetching it twice.
 */
export function dqfFactsOf(facts: DriverFacts): DqfFacts {
  return {
    hireDate: facts.hireDate,
    compliance: facts.compliance,
    documents: facts.documents,
  }
}

/** What a driver with nothing on file looks like. Exported so callers do
 * not each invent their own empty. */
export const NO_DRIVER_FACTS: DriverFacts = {
  compliance: [],
  negativeNetCount: 0,
  hireDate: null,
  documents: [],
  qualifiable: true,
}

export interface TruckFacts {
  compliance: readonly ComplianceFact[]
}

export interface LoadFacts {
  pickupAt: Date | null
  hasDriver: boolean
  hasTruck: boolean
  isCancelled: boolean
  /** Datatruck's. Silent by ruling — see the header. */
  closedHistory: boolean
  directSettled: boolean
  rateCents: number
  remittedCents: number
  hasRemittance: boolean
  confirmedCents: number | null
}

const DAY_MS = 86_400_000

function complianceWarnings(
  compliance: readonly ComplianceFact[],
  required: readonly string[],
  now: Date,
): Warning[] {
  const found: Warning[] = []

  for (const item of compliance) {
    if (item.expiresAt === null) continue
    // NO TYPE IS EXCLUDED HERE, and one briefly was. Item 15 first wrote a
    // DRUG_TEST record for every completed random test, whose only honest
    // expiry was the test date — so the type had to be skipped or every
    // driver tested this quarter read "expired" the same evening.
    //
    // THE OWNER'S RULING OF 2026-09-22 removed the cause instead of the
    // symptom: a random test is an event recorded ON THE SELECTION, and
    // DRUG_TEST goes back to meaning the pre-employment credential under
    // §382.301 — which has a real expiry and should warn like any other.
    // An exclusion list here would have been a second vocabulary of
    // compliance types, quietly divided into ones that mean something and
    // ones that do not.
    const days = Math.floor((item.expiresAt.getTime() - now.getTime()) / DAY_MS)
    if (days < 0) {
      found.push({ name: 'compliance_expired', detail: item.type })
    } else if (days <= EXPIRING_WITHIN_DAYS) {
      found.push({ name: 'compliance_expiring', detail: item.type })
    }
  }

  // MISSING IS NOT EXPIRED. A driver with no medical card on file at all is a
  // different problem from one whose card lapsed: the second has a document to
  // renew, the first has nothing to renew and somebody has to go and get it.
  const present = new Set(compliance.map((item) => item.type))
  for (const type of required) {
    if (!present.has(type)) {
      found.push({ name: 'document_missing', detail: type })
    }
  }

  return found
}

/**
 * What still raises `document_missing` on a DRIVER: the licence record,
 * and nothing else (owner's ruling, 2026-09-22).
 *
 * ── WHY THE LIST IS SUBTRACTED RATHER THAN EMPTIED ───────────────────
 *
 * The ruling is that `dqf_incomplete` REPLACES `document_missing` on
 * drivers, and for every requirement the DQF covers it does. `CDL` is the
 * one required type that is NOT a DQF requirement — §391.51(b)(8) asks for
 * a COPY of the licence, which is a document, while this record is the
 * licence itself and its expiry.
 *
 * Emptying the list outright would make a driver with no licence record at
 * all silent, which is a hole rather than a tidier row. So the subtraction
 * is written as a subtraction: add a compliance-backed DQF requirement and
 * it leaves here automatically, and nothing else does.
 */
const DRIVER_MISSING_TYPES = REQUIRED_DRIVER_DOCUMENTS.filter(
  (type) => !(DQF_COMPLIANCE_TYPES as readonly string[]).includes(type),
)

export function driverWarnings(facts: DriverFacts, now: Date): Warning[] {
  // EXPIRY STILL WARNS PER RECORD. A medical card that lapsed names
  // itself; only the ABSENCE of a DQF-covered record is now carried by the
  // one warning below, because five chips saying one thing is a column
  // nobody reads. See PHASE-5-BRIEF §7 flag 14.
  const found = complianceWarnings(facts.compliance, DRIVER_MISSING_TYPES, now)

  if (facts.negativeNetCount > 0) {
    found.push({
      name: 'settlement_net_negative',
      detail: String(facts.negativeNetCount),
    })
  }

  // ── THE FILE, AS ONE WARNING ─────────────────────────────────────────
  //
  // A COUNT RATHER THAN EIGHT WARNINGS. The per-item detail is on the
  // driver page and on the roster view; a list row needs to know that the
  // file is not audit-ready and how far off it is.
  //
  // A TERMINATED DRIVER IS SILENT, which is item 9's closed-history rule
  // applied to people: §391.51(c) keeps the file for three years after
  // they leave, it does not keep it current. 69 terminated drivers and 39
  // applicants came over in the import, and warning on each would be 108
  // alarms about nobody.
  if (facts.qualifiable) {
    // THE KEYS, NOT A COUNT AND NOT A SENTENCE. `Warning.detail` is the
    // specific fact; turning these into words is the interface's job, the
    // same division `DispatchConflict` uses for its `values`. The drivers
    // list maps them through `dqf.key.*`.
    const gaps = dqfChecklist(dqfFactsOf(facts), now).filter(
      (entry) => entry.status === 'missing' || entry.status === 'expired',
    )
    if (gaps.length > 0) {
      found.push({
        name: 'dqf_incomplete',
        detail: gaps.map((entry) => entry.key).join(','),
      })
    }
  }

  return found
}

export function truckWarnings(facts: TruckFacts, now: Date): Warning[] {
  return complianceWarnings(facts.compliance, REQUIRED_TRUCK_DOCUMENTS, now)
}

export function loadWarnings(facts: LoadFacts, now: Date): Warning[] {
  // CLOSED HISTORY IS SILENT, and it is the first thing checked so that no
  // rule below can accidentally speak for it.
  if (facts.closedHistory) return []

  const found: Warning[] = []

  // A CANCELLED LOAD STILL HOLDING EQUIPMENT. The truck and the driver are
  // spoken for on a job that is not happening, which is how a unit sits idle
  // while the board says it is working.
  if (facts.isCancelled) {
    if (facts.hasDriver || facts.hasTruck) {
      found.push({
        name: 'cancelled_but_assigned',
        detail: [
          facts.hasDriver ? 'driver' : null,
          facts.hasTruck ? 'truck' : null,
        ]
          .filter(Boolean)
          .join('+'),
      })
    }
    // Nothing else applies to a cancelled load: it has no pickup to be late
    // for and it will never be settled.
    return found
  }

  if (facts.pickupAt !== null && (!facts.hasDriver || !facts.hasTruck)) {
    const hours = (facts.pickupAt.getTime() - now.getTime()) / 3_600_000
    // PAST COUNTS TOO. A pickup that was due yesterday and still has nobody on
    // it is more urgent than one due tomorrow, not less.
    if (hours <= PICKUP_SOON_HOURS) {
      found.push({
        name: 'pickup_soon_unassigned',
        detail:
          !facts.hasDriver && !facts.hasTruck
            ? 'neither'
            : !facts.hasDriver
              ? 'driver'
              : 'truck',
      })
    }
  }

  // HELD IS THE ENGINE'S OWN REFUSAL, not a second opinion about it.
  // `grossFor` settles a direct load on the confirmed figure, or on a
  // remittance that matched exactly, and refuses everything else until a
  // person looks. That refusal is the warning.
  if (facts.directSettled && facts.confirmedCents === null) {
    const outcome = remittanceOutcome(
      facts.remittedCents,
      facts.hasRemittance,
      facts.rateCents,
    )
    if (outcome !== 'matched_exact') {
      found.push({ name: 'settlement_line_held', detail: outcome })
    }
  }

  return found
}

// ── the facts, one query per list ────────────────────────────────────────

type TxClient = Prisma.TransactionClient

/**
 * Compliance and settlement facts for many drivers, in ONE statement.
 *
 * A `UNION ALL` rather than two queries, because the ruling is one query and
 * because two would still be a fixed cost that somebody would later turn into
 * three. The shape is deliberately flat — id, kind, label, date — so adding a
 * fact source is a third arm and not a new round trip.
 */
export async function driverWarningFacts(
  tx: TxClient,
  driverIds: readonly string[],
): Promise<Map<string, DriverFacts>> {
  const facts = new Map<string, DriverFacts>()
  for (const id of driverIds) facts.set(id, { ...NO_DRIVER_FACTS })
  if (driverIds.length === 0) return facts

  const ids = [...driverIds]
  const [rows, dqf, roster] = await Promise.all([
    // ONLY THE SETTLEMENTS. The compliance rows used to be the other arm
    // of a UNION here and are now read once, by the DQF loader below.
    tx.$queryRaw<{ id: string }[]>`
      SELECT s."driverId" AS id
        FROM "Settlement" s
       WHERE s."driverId" = ANY(${ids}) AND s."netCents" < 0
    `,
    // The DQF evidence, from `dqf.ts` — the one loader, so the drivers
    // list and the roster view cannot disagree about what is on file.
    dqfFactsForDrivers(tx, ids),
    // And whether each driver is somebody whose file must be current.
    tx.driver.findMany({
      where: { id: { in: ids } },
      // `kind` BECAUSE A PAYEE HAS NO FILE. `isQualifiable` reads it, and
      // leaving it out of this select is a type error rather than a silent
      // false — which is the whole reason the predicate takes the row.
      select: { id: true, status: true, deletedAt: true, kind: true },
    }),
  ])

  for (const driver of roster) {
    const entry = facts.get(driver.id)
    if (!entry) continue
    const evidence = dqf.get(driver.id)
    facts.set(driver.id, {
      ...entry,
      qualifiable: isQualifiable(driver),
      hireDate: evidence?.hireDate ?? null,
      documents: evidence?.documents ?? [],
      // THE COMPLIANCE ROWS COME FROM THE DQF LOADER, not from a second
      // query below. They are the same rows; fetching them twice is how
      // two answers to one question start.
      compliance: evidence?.compliance ?? [],
    })
  }

  for (const row of rows) {
    const entry = facts.get(row.id)
    if (!entry) continue
    facts.set(row.id, {
      ...entry,
      negativeNetCount: entry.negativeNetCount + 1,
    })
  }

  return facts
}

/** The same, for trucks. */
export async function truckWarningFacts(
  tx: TxClient,
  truckIds: readonly string[],
): Promise<Map<string, TruckFacts>> {
  const facts = new Map<string, TruckFacts>()
  for (const id of truckIds) facts.set(id, { compliance: [] })
  if (truckIds.length === 0) return facts

  const ids = [...truckIds]
  const rows = await tx.$queryRaw<
    { id: string; label: string | null; at: Date | null }[]
  >`
    SELECT ci."truckId" AS id, ci."type"::text AS label, ci."expiresAt" AS at
      FROM "ComplianceItem" ci
     WHERE ci."truckId" = ANY(${ids}) AND ci."deletedAt" IS NULL
  `

  for (const row of rows) {
    const entry = facts.get(row.id)
    if (!entry) continue
    facts.set(row.id, {
      compliance: [
        ...entry.compliance,
        { type: row.label ?? '', expiresAt: row.at },
      ],
    })
  }

  return facts
}

/**
 * Load facts for many loads, in ONE statement.
 *
 * The pickup is the FIRST stop by sequence, and the remittance is summed in
 * the same pass — a correlated subquery rather than a second query, so the
 * cost stays one round trip however long the list is.
 */
export async function loadWarningFacts(
  tx: TxClient,
  loadIds: readonly string[],
): Promise<Map<string, LoadFacts>> {
  const facts = new Map<string, LoadFacts>()
  if (loadIds.length === 0) return facts

  const ids = [...loadIds]
  const rows = await tx.$queryRaw<
    {
      id: string
      pickup_at: Date | null
      has_driver: boolean
      has_truck: boolean
      is_cancelled: boolean
      closed_history: boolean
      direct_settled: boolean
      rate_cents: number
      remitted_cents: number
      remittance_count: number
      confirmed_cents: number | null
    }[]
  >`
    SELECT
      l."id",
      (SELECT st."scheduledAt" FROM "LoadStop" st
        WHERE st."loadId" = l."id" AND st."type" = 'PICKUP'
        ORDER BY st."sequence" ASC LIMIT 1) AS pickup_at,
      (l."driverId" IS NOT NULL) AS has_driver,
      (l."truckId" IS NOT NULL) AS has_truck,
      l."isCancelled" AS is_cancelled,
      (l."billingStatus" = 'CLOSED_IN_DATATRUCK') AS closed_history,
      l."directSettled" AS direct_settled,
      l."totalRevenueCents" AS rate_cents,
      COALESCE((SELECT SUM(pla."amountCents")::int FROM "PaymentLoadApplication" pla
                 WHERE pla."loadId" = l."id"), 0) AS remitted_cents,
      COALESCE((SELECT COUNT(*)::int FROM "PaymentLoadApplication" pla
                 WHERE pla."loadId" = l."id"), 0) AS remittance_count,
      l."settledGrossCents" AS confirmed_cents
    FROM "Load" l
    WHERE l."id" = ANY(${ids}) AND l."deletedAt" IS NULL
  `

  for (const row of rows) {
    facts.set(row.id, {
      pickupAt: row.pickup_at,
      hasDriver: row.has_driver,
      hasTruck: row.has_truck,
      isCancelled: row.is_cancelled,
      closedHistory: row.closed_history,
      directSettled: row.direct_settled,
      rateCents: row.rate_cents,
      remittedCents: row.remitted_cents,
      hasRemittance: row.remittance_count > 0,
      confirmedCents: row.confirmed_cents,
    })
  }

  return facts
}
