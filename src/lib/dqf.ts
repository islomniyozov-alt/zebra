import type { ComplianceType, DocumentType } from '@/generated/prisma/client'
import type { TxClient } from './tenancy'
import { daysUntil } from './compliance'
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

export type DqfKey =
  | 'hire_date'
  | 'application'
  | 'mvr'
  | 'road_test'
  | 'medical_certificate'
  | 'cdl_copy'
  | 'annual_review'
  | 'prior_employers'
  | 'clearinghouse'

/**
 * Evidence is a dated compliance record, an undated document on file, EITHER
 * of the two, or a fact on the driver row.
 *
 * `either` (queue item 20 (4)): the copy of the CDL is satisfied by the
 * `CDL_COPY` document OR by the live CDL compliance record the alerts already
 * watch — the licence itself, with its expiry. When only the record is there
 * the row reads by its date, the way the medical certificate does.
 *
 * `fact`: the hire date. Not a document and not a record — a column on the
 * driver, and the date every at-hire row is dated from. Missing is a row of
 * its own, not a reason the rest of the file reads "since a day nobody wrote".
 */
export type DqfEvidence =
  | { kind: 'compliance'; type: ComplianceType }
  | { kind: 'document'; type: DocumentType }
  | { kind: 'either'; document: DocumentType; compliance: ComplianceType }
  | { kind: 'fact'; fact: 'hireDate' }

export interface DqfRequirement {
  key: DqfKey
  /** The section an auditor will cite. Printed on the screen, not decoration. */
  cfr: string
  cadence: DqfCadence
  evidence: DqfEvidence
}

/**
 * The eight, in the order an auditor walks them.
 *
 * MVR AND THE ANNUAL REVIEW ARE TWO ITEMS, not one said twice. §391.25(a)
 * requires the carrier to OBTAIN a motor vehicle record each year; §391.25(b)
 * requires somebody at the carrier to REVIEW it and record that they did. A
 * carrier that pulls the MVR and never reviews it has one of the two, and an
 * audit finds exactly that.
 */
export const DQF_REQUIREMENTS: readonly DqfRequirement[] = [
  // THE DATE THE FILE IS DATED FROM, FIRST (queue item 20 (4)). A file with no
  // hire date showed every at-hire row "missing — no hire date recorded" and
  // a summary counting the file against a date nobody typed. The date is a
  // row of its own: the office fixes it where it is missing, and the other
  // rows date themselves from it.
  {
    key: 'hire_date',
    cfr: '391.51',
    cadence: 'at_hire',
    evidence: { kind: 'fact', fact: 'hireDate' },
  },
  {
    key: 'application',
    cfr: '391.21',
    cadence: 'at_hire',
    evidence: { kind: 'document', type: 'EMPLOYMENT_APPLICATION' },
  },
  {
    key: 'prior_employers',
    cfr: '391.23(a)(2)',
    cadence: 'at_hire',
    evidence: { kind: 'document', type: 'EMPLOYMENT_VERIFICATION' },
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
    key: 'annual_review',
    cfr: '391.25(b)',
    cadence: 'annual',
    evidence: { kind: 'compliance', type: 'ANNUAL_REVIEW' },
  },
  {
    key: 'medical_certificate',
    cfr: '391.43',
    cadence: 'annual',
    evidence: { kind: 'compliance', type: 'MEDICAL_CARD' },
  },
  {
    key: 'clearinghouse',
    cfr: '382.701',
    cadence: 'annual',
    evidence: { kind: 'compliance', type: 'CLEARINGHOUSE_QUERY' },
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
   * WHEN IT TURNED DUE — the date this entry started needing attention.
   *
   * For a dated item that is `due` or `expired`, the expiry itself: the day it
   * lapses or lapsed. For a `missing` item, the driver's hire date, because
   * that is when it was first required — null when nobody recorded one, which
   * is an absence rather than a licence to ignore it.
   *
   * Null for `present`. There is nothing to date about a thing that is fine.
   */
  dueSince: Date | null
}

/** The lead window a renewal shows up in. Matches the compliance panel's. */
export const DQF_LEAD_DAYS = 30

export interface DqfFacts {
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
  return DQF_REQUIREMENTS.map((requirement) => {
    const base = {
      key: requirement.key,
      cfr: requirement.cfr,
      cadence: requirement.cadence,
    }

    // THE HIRE DATE IS A ROW (queue item 20 (4)): present when recorded,
    // missing when not. It has no date of its own to be "since".
    if (requirement.evidence.kind === 'fact') {
      return facts.hireDate !== null
        ? { ...base, status: 'present' as const, dueSince: null }
        : { ...base, status: 'missing' as const, dueSince: null }
    }

    if (requirement.evidence.kind === 'document') {
      const onFile = facts.documents.includes(requirement.evidence.type)
      return onFile
        ? { ...base, status: 'present' as const, dueSince: null }
        : { ...base, status: 'missing' as const, dueSince: facts.hireDate }
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
      return { ...base, status: 'missing' as const, dueSince: facts.hireDate }
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
  })
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
export async function dqfFactsForDrivers(
  tx: TxClient,
  driverIds: readonly string[],
): Promise<Map<string, DqfFacts>> {
  const out = new Map<string, DqfFacts>()
  if (driverIds.length === 0) return out

  const ids = [...driverIds]

  const [drivers, documents] = await Promise.all([
    tx.$queryRaw<
      {
        id: string
        hire_date: Date | null
        types: string[] | null
        expiries: Date[] | null
      }[]
    >`
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
       WHERE d."id" = ANY(${ids})
    `,
    tx.$queryRaw<{ id: string; types: string[] | null }[]>`
      SELECT doc."driverId" AS id,
             ARRAY_AGG(DISTINCT doc."type"::text) AS types
        FROM "Document" doc
       WHERE doc."driverId" = ANY(${ids}) AND doc."deletedAt" IS NULL
       GROUP BY doc."driverId"
    `,
  ])

  const filed = new Map<string, string[]>()
  for (const row of documents) filed.set(row.id, row.types ?? [])

  for (const row of drivers) {
    const types = row.types ?? []
    const expiries = row.expiries ?? []
    out.set(row.id, {
      hireDate: row.hire_date,
      // THE TWO ARRAYS ARE ORDERED IDENTICALLY — same subquery, same ORDER BY
      // — so index `i` of one belongs with index `i` of the other. Zipping
      // them here rather than returning a composite type keeps the row shape
      // something the driver can decode without a custom parser.
      compliance: types.map((type, index) => ({
        type,
        expiresAt: expiries[index]!,
      })),
      documents: filed.get(row.id) ?? [],
    })
  }

  return out
}
